import { CONFIG } from './config.js';
import { debugLog } from './utils.js';

// Lee duración y resolución con un <video>. Solo es informativo: si el navegador
// no sabe decodificar el formato devuelve ceros, y el escalado lo decide ffmpeg igualmente.
export function extractMetadata(file) {
  debugLog('[extractMetadata] Extrayendo metadata de:', file.name);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const src = URL.createObjectURL(file);
    let settled = false;

    const finish = (metadata) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(src);
      resolve(metadata);
    };

    const fallback = (reason) => {
      console.warn(`[extractMetadata] ${reason}, usando valores por defecto`);
      finish({ duration: 0, width: 0, height: 0, codec: file.type });
    };

    const timer = setTimeout(() => fallback('Timeout extrayendo metadata'), CONFIG.METADATA_TIMEOUT_MS);

    video.onloadedmetadata = () => {
      const metadata = {
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight,
        codec: file.type
      };
      debugLog('[extractMetadata] Metadata extraída:', metadata);
      finish(metadata);
    };

    video.onerror = () => fallback('Error extrayendo metadata');

    video.src = src;
  });
}
