import { CONFIG } from './config.js';
import { state, findVideo, createVideoData } from './state.js';
import { debugLog, isVideoFile } from './utils.js';
import { loadFFmpeg, terminateFFmpeg } from './ffmpeg-loader.js';
import { convertVideo } from './converter.js';
import { extractMetadata } from './metadata.js';
import { logVideo, removeVideoCard, renderVideoCard, updateVideoCard, updateVideosContainer } from './ui/cards.js';
import { showNotification } from './ui/notifications.js';

// Añade videos ya creados al estado, a la UI y a la cola
export function enqueueVideos(videos) {
  for (const video of videos) {
    state.videos.push(video);
    renderVideoCard(video);
  }
  updateVideosContainer();
  state.pendingQueue.push(...videos.map(v => v.id));
  processQueue();
}

// Valida los archivos recibidos (input, drop o pegar) y los encola con el preset activo.
// Devuelve cuántos videos se han añadido.
export async function addFiles(files) {
  const videoFiles = Array.from(files || []).filter(isVideoFile);
  debugLog('[addFiles] Archivos de video válidos:', videoFiles.length);

  if (videoFiles.length === 0) {
    showNotification('por favor, selecciona archivos de video válidos', 'error');
    return 0;
  }

  const largeFiles = videoFiles.filter(f => f.size > CONFIG.MAX_SAFE_SIZE);
  if (largeFiles.length > 0) {
    const names = largeFiles.map(f => f.name).join(', ');
    showNotification(`archivos grandes detectados (${names}). puede fallar por memoria del navegador.`, 'warning');
  }

  // Los metadatos se leen en paralelo; extractMetadata nunca se queda colgado (timeout)
  const metadataList = await Promise.all(videoFiles.map(extractMetadata));
  enqueueVideos(videoFiles.map((file, i) => createVideoData(file, metadataList[i])));
  return videoFiles.length;
}

// Cola secuencial: una sola conversión a la vez sobre la instancia de ffmpeg.
// Solo puede haber un bucle vivo (isConverting); cancelar no lo reinicia,
// simplemente termina ffmpeg y el bucle espera a que se recargue para seguir.
async function processQueue() {
  if (state.isConverting) return;
  state.isConverting = true;

  try {
    while (state.pendingQueue.length > 0) {
      const video = findVideo(state.pendingQueue.shift());
      if (!video || video.status !== 'pending') continue;

      const ready = await loadFFmpeg();
      if (video.status !== 'pending') continue; // eliminado mientras cargaba
      if (!ready) {
        video.status = 'error';
        video.errorMessage = 'ffmpeg no pudo cargarse';
        updateVideoCard(video);
        continue;
      }

      await convertVideo(video);
    }
  } finally {
    state.isConverting = false;
    debugLog('[processQueue] ✓ Cola de conversión vacía');
  }
}

function discardVideo(video) {
  state.pendingQueue = state.pendingQueue.filter(id => id !== video.id);
  if (video.webmUrl) URL.revokeObjectURL(video.webmUrl);
  state.videos.splice(state.videos.indexOf(video), 1);
  removeVideoCard(video.id);
  updateVideosContainer();
}

export function cancelVideo(id) {
  const video = findVideo(id);
  if (!video || video.status !== 'converting') return;

  video.status = 'cancelled';
  video.progress = 0;
  logVideo(video, 'Conversión cancelada');
  updateVideoCard(video);
  showNotification(`conversión cancelada: ${video.originalFile.name}`, 'info');

  // Rechaza el exec en curso; convertVideo lo detecta por status === 'cancelled'
  // y processQueue recargará ffmpeg antes del siguiente video.
  terminateFFmpeg();
  // Precarga en segundo plano para que esté listo cuanto antes (promesa compartida)
  loadFFmpeg();
}

// Botón de la tarjeta: cancela si está convirtiendo, si no elimina
export function removeVideo(id) {
  const video = findVideo(id);
  if (!video) return;
  if (video.status === 'converting') {
    cancelVideo(id);
  } else {
    discardVideo(video);
  }
}

// Reordena state.videos según el orden actual de las tarjetas en el DOM
export function syncOrderFromDom(container) {
  const order = Array.from(container.children, card => card.dataset.videoId);
  state.videos.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
