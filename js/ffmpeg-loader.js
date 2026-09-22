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

async function doLoadFFmpeg() {
  setUploadAreaLoading(true);

  try {
    // coi-serviceworker necesita un reload inicial para activar SharedArrayBuffer
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer no disponible. Recarga la página (coi-serviceworker necesita un reload inicial).');
    }

    debugLog('[loadFFmpeg] Descargando core desde:', CONFIG.CORE_MT_BASE);
    const { FFmpeg } = window.FFmpegWASM;
    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => debugLog('[FFmpeg log]', message));

    const base = CONFIG.CORE_MT_BASE;
    const [coreURL, wasmURL, workerURL] = await Promise.all([
      toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript')
    ]);
    await ffmpeg.load({ coreURL, wasmURL, workerURL });

    state.ffmpeg = ffmpeg;
    state.ffmpegLoaded = true;
    debugLog('[loadFFmpeg] ✓ ffmpeg.wasm cargado y listo');
    showNotification('ffmpeg cargado correctamente', 'success');
  } catch (error) {
    console.error('[loadFFmpeg] ✗ Error cargando FFmpeg:', error);
    showNotification('error al cargar ffmpeg. por favor, recarga la página.', 'error');
    state.ffmpeg = null;
    state.ffmpegLoaded = false;
  } finally {
    setUploadAreaLoading(false);
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
