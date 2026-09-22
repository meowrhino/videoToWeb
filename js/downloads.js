import { CONFIG, getPreset } from './config.js';
import { state, findVideo } from './state.js';
import { debugLog, formatDuration, formatMB, formatReduction, loadScript, stripExtension, triggerDownload } from './utils.js';
import { showNotification } from './ui/notifications.js';

function getOutputBaseName(video) {
  return `${stripExtension(video.originalFile.name)}${getPreset(video.presetId).suffix}`;
}

function buildLogText(video) {
  const preset = getPreset(video.presetId);
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

  const baseName = getOutputBaseName(video);
  triggerDownload(video.webmUrl, `${baseName}.webm`);

  // El log solo se descarga en modo debug
  if (CONFIG.DEBUG_LOGS) {
    const logUrl = URL.createObjectURL(new Blob([buildLogText(video)], { type: 'text/plain' }));
    setTimeout(() => triggerDownload(logUrl, `${baseName}_log.txt`, { revoke: true }), 100);
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
    const nameCounts = {};

    for (const video of completed) {
      const baseName = getOutputBaseName(video);
      const count = (nameCounts[baseName] || 0) + 1;
      nameCounts[baseName] = count;
      const name = count === 1 ? baseName : `${baseName}-${count}`;
      zip.file(`${name}.webm`, video.webmBlob);
      if (CONFIG.DEBUG_LOGS) {
        zip.file(`${name}_log.txt`, buildLogText(video));
      }
    }

    // WebM ya está comprimido: STORE es mucho más rápido y el ZIP pesa prácticamente lo mismo
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    triggerDownload(URL.createObjectURL(zipBlob), `videos_convertidos_${Date.now()}.zip`, { revoke: true });

    showNotification(`${completed.length} videos descargados en zip`, 'success');
  } catch (error) {
    console.error('[downloadAll] Error creando ZIP:', error);
    showNotification('error al crear el archivo zip', 'error');
  }
}
