import { CONFIG } from './config.js';
import { state } from './state.js';
import { debugLog } from './utils.js';
import { setUploadAreaLoading } from './ui/dom.js';
import { showNotification } from './ui/notifications.js';

// Descarga un archivo remoto y lo convierte a Blob URL (necesario para el worker del core-mt)
async function toBlobURL(url, mimeType) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

// Sin SharedArrayBuffer no hay ffmpeg. La primera visita ya la recarga coi-serviceworker
// (main.js no llama antes); si sigue sin haber, el navegador no deja usar el service
// worker (una ventana privada, por ejemplo).
const NO_SAB_MESSAGE = 'este navegador no deja convertir aquí: abre la página en una ventana normal de chrome o firefox';
const LOAD_ERROR_MESSAGE = 'no se pudo descargar ffmpeg: revisa la conexión y recarga la página';

// El core (~33 MB) se descarga una vez por visita: cancelar termina la instancia,
// pero la nueva usa las mismas blob URLs (por eso no se revocan). Si falla, se vacía
// para que el siguiente intento vuelva a descargarlo.
let coreURLs = null;
function getCoreURLs() {
  const base = CONFIG.CORE_MT_BASE;
  coreURLs ||= Promise.all([
    toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript')
  ]).catch((error) => {
    coreURLs = null;
    throw error;
  });
  return coreURLs;
}

let loadedOnce = false;

async function doLoadFFmpeg() {
  // Tras cancelar se recarga sin descargar nada: el área de subida no cambia
  if (!loadedOnce) setUploadAreaLoading(true);
  let errorMessage = null;

  try {
    if (typeof SharedArrayBuffer === 'undefined') {
      errorMessage = NO_SAB_MESSAGE;
      throw new Error('SharedArrayBuffer no disponible');
    }

    debugLog('[loadFFmpeg] Descargando core desde:', CONFIG.CORE_MT_BASE);
    const { FFmpeg } = window.FFmpegWASM;
    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => debugLog('[FFmpeg log]', message));

    const [coreURL, wasmURL, workerURL] = await getCoreURLs();
    await ffmpeg.load({ coreURL, wasmURL, workerURL });

    state.ffmpeg = ffmpeg;
    state.ffmpegLoaded = true;
    loadedOnce = true;
    debugLog('[loadFFmpeg] ✓ ffmpeg.wasm cargado y listo');
  } catch (error) {
    console.error('[loadFFmpeg] ✗ Error cargando FFmpeg:', error);
    errorMessage ||= LOAD_ERROR_MESSAGE;
    showNotification(errorMessage, 'error');
    state.ffmpeg = null;
    state.ffmpegLoaded = false;
  } finally {
    // El aviso se va a los 3 s: el error se queda también en el área de subida
    setUploadAreaLoading(false, errorMessage);
  }
}

// Devuelve siempre la misma promesa mientras se carga, para que cualquiera que
// llame pueda esperar a que termine (en vez de seguir con ffmpeg sin cargar).
// Resuelve a true si ffmpeg queda listo.
export function loadFFmpeg() {
  if (state.ffmpegLoaded) return Promise.resolve(true);
  if (!state.loadPromise) {
    state.loadPromise = doLoadFFmpeg().finally(() => {
      state.loadPromise = null;
    });
  }
  return state.loadPromise.then(() => state.ffmpegLoaded);
}

// ffmpeg.wasm no tiene cancelación nativa: se mata la instancia y habrá que recargarla.
// Las promesas pendientes (exec, readFile...) se rechazan al terminar.
export function terminateFFmpeg() {
  if (state.ffmpeg) {
    try { state.ffmpeg.terminate(); } catch (_) {}
  }
  state.ffmpeg = null;
  state.ffmpegLoaded = false;
}
