import { CONFIG, getPreset, settingsFor } from './config.js';
import { state, findVideo } from './state.js';
import { debugLog, formatDuration, formatMB, formatReduction, loadScript, stripExtension, triggerDownload } from './utils.js';
import { showNotification } from './ui/notifications.js';

// El nombre con que sale cada vídeo, el mismo en la descarga suelta y en el ZIP
// (y el que enseña la tarjeta). Con "numerar", 1, 2, 3… desde "empezar en", en el
// orden de las tarjetas, como las fotos de imgToWeb; si no, el nombre original.
// Los que fallan o se cancelan no cuentan. Si un nombre se repite, -2, -3…
export function outputNames() {
  const names = new Map();
  const counts = {};
  let n = state.options.start;
  for (const video of state.videos) {
    if (video.status === 'error' || video.status === 'cancelled') continue;
    const base = state.options.number
      ? String(n++)
      : `${stripExtension(video.originalFile.name)}${getPreset(video.presetId).suffix}`;
    counts[base] = (counts[base] || 0) + 1;
    names.set(video, counts[base] === 1 ? base : `${base}-${counts[base]}`);
  }
  return names;
}

// El fotograma se llama como el vídeo + .poster: 1.webm y 1.poster.webp
export const posterName = baseName => `${baseName}.poster.webp`;

function buildLogText(video) {
  const preset = settingsFor(video.presetId, video.originalFile, video);
  const { width, height, duration } = video.metadata;

  const lines = [
    '=== Log de conversión ===',
    `Archivo original: ${video.originalFile.name}`,
    `Tamaño original: ${formatMB(video.originalSize)}`,
    `Resolución original: ${width || '?'}x${height || '?'}`,
    `Duración: ${duration > 0 ? formatDuration(duration) : 'desconocida'}`,
    '',
    '--- Configuración ---',
    `Preset: ${preset.label}`,
    `Codec video: ${CONFIG.VIDEO_CODEC}`,
    `Codec audio: ${CONFIG.AUDIO_CODEC}`,
    `CRF: ${video.crf}`,
    `Bitrate techo: ${preset.videoBitrate}`,
    `Audio bitrate: ${preset.audioBitrate}`,
    `cpu-used: ${preset.cpuUsed}`,
    video.scaledResolution ? `Resolución de salida: ${video.scaledResolution}` : null,
    video.ffmpegArgsUsed ? `Comando: ffmpeg ${video.ffmpegArgsUsed.join(' ')}` : null,
    '',
    '--- Resultado ---',
    `Tamaño WebM: ${formatMB(video.webmSize)}`,
    `Reducción: ${formatReduction(video.originalSize, video.webmSize)}`,
    '',
    '--- Logs de FFmpeg ---',
    ...video.logs
  ];

  return lines.filter(l => l !== null).join('\n');
}

export function downloadVideo(id) {
  const video = findVideo(id);
  if (!video?.webmUrl) return;

  const baseName = outputNames().get(video);
  triggerDownload(video.webmUrl, `${baseName}.webm`);
  video.downloaded = true;
  // Si el navegador bloquea la segunda descarga, el fotograma se baja desde su miniatura
  if (video.posterUrl) {
    setTimeout(() => triggerDownload(video.posterUrl, posterName(baseName)), 100);
  }

  // El log solo se descarga en modo debug
  if (CONFIG.DEBUG_LOGS) {
    const logUrl = URL.createObjectURL(new Blob([buildLogText(video)], { type: 'text/plain' }));
    setTimeout(() => triggerDownload(logUrl, `${baseName}_log.txt`, { revoke: true }), 200);
  }
  debugLog('[downloadVideo] Descarga iniciada:', `${baseName}.webm`);
}

// Descarga todos los completados en un ZIP, en el orden actual de las tarjetas
export async function downloadAll() {
  const completed = state.videos.filter(v => v.status === 'completed');
  if (completed.length === 0) {
    showNotification('no hay videos completados para descargar', 'error');
    return;
  }

  try {
    if (typeof window.JSZip === 'undefined') {
      await loadScript(CONFIG.JSZIP_URL);
    }

    showNotification('creando archivo zip...', 'info');

    const zip = new window.JSZip();
    const names = outputNames();

    for (const video of completed) {
      const name = names.get(video);
      zip.file(`${name}.webm`, video.webmBlob);
      if (video.posterBlob) zip.file(posterName(name), video.posterBlob);
      if (CONFIG.DEBUG_LOGS) {
        zip.file(`${name}_log.txt`, buildLogText(video));
      }
    }

    // WebM ya está comprimido: STORE es mucho más rápido y el ZIP pesa prácticamente lo mismo
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    triggerDownload(URL.createObjectURL(zipBlob), `videos_convertidos_${Date.now()}.zip`, { revoke: true });
    completed.forEach(v => { v.downloaded = true; });

    showNotification(`${completed.length} videos descargados en zip`, 'success');
  } catch (error) {
    console.error('[downloadAll] Error creando ZIP:', error);
    showNotification('error al crear el archivo zip', 'error');
  }
}
