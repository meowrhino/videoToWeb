import { CONFIG, getPreset } from './config.js';
import { state } from './state.js';
import { debugLog, formatMB, formatReduction, getExtension } from './utils.js';
import { logVideo, updateVideoCard, updateVideosContainer } from './ui/cards.js';
import { showNotification } from './ui/notifications.js';

const MOUNT_POINT = '/mounted';
const OUTPUT_NAME = 'output.webm';

// Escalado hecho por ffmpeg con las dimensiones reales del stream, así funciona
// aunque el navegador no haya podido leer los metadatos. Solo reduce (nunca amplía),
// mantiene el aspecto y deja dimensiones pares (VP8 lo requiere).
function buildScaleFilter({ maxWidth, maxHeight }) {
  return `scale='min(${maxWidth},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
}

// Resolución que saldrá, solo para mostrarla en la UI. null si no hace falta escalar
// o si no conocemos los metadatos.
function expectedScaledResolution({ width, height }, { maxWidth, maxHeight }) {
  if (!width || !height || (width <= maxWidth && height <= maxHeight)) return null;
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  const even = n => Math.max(2, Math.floor(n / 2) * 2);
  return `${even(width * ratio)}x${even(height * ratio)}`;
}

export function buildFfmpegArgs(inputName, preset) {
  const args = [
    '-i', inputName,
    '-c:v', CONFIG.VIDEO_CODEC,          // libvpx (VP8)
    '-crf', String(preset.crf),
    '-b:v', preset.videoBitrate,          // Techo de bitrate (VBR limitado)
    '-cpu-used', String(preset.cpuUsed),  // 0-16 (más alto = más rápido)
    '-lag-in-frames', '16',               // Lookahead frames (max efectivo 16)
    '-auto-alt-ref', '1',                 // Mejora calidad con frames alternativos
    '-c:a', CONFIG.AUDIO_CODEC,           // libvorbis
    '-b:a', preset.audioBitrate,
    '-threads', '2',
    '-vf', buildScaleFilter(preset)
  ];
  if (preset.fps) {
    args.push('-r', String(preset.fps));
  }
  args.push(OUTPUT_NAME);
  return args;
}

// Copia el archivo al FS virtual de ffmpeg. Los grandes se montan con WORKERFS
// (lectura directa, sin copiarlos a la memoria WASM). Devuelve la ruta de entrada.
async function writeInput(ffmpeg, video) {
  const file = video.originalFile;

  if (file.size >= CONFIG.WORKERFS_THRESHOLD) {
    try { await ffmpeg.unmount(MOUNT_POINT); } catch (_) {} // por si quedó montado
    try { await ffmpeg.createDir(MOUNT_POINT); } catch (_) {} // puede existir ya
    await ffmpeg.mount('WORKERFS', { files: [file] }, MOUNT_POINT);
    logVideo(video, 'Usando lectura directa (WORKERFS) para archivo grande');
    return { inputName: `${MOUNT_POINT}/${file.name}`, mounted: true };
  }

  const buffer = await file.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('No se pudo leer el archivo (0 bytes).');
  }
  const inputName = `input.${getExtension(file.name) || 'bin'}`;
  await ffmpeg.writeFile(inputName, new Uint8Array(buffer));
  return { inputName, mounted: false };
}

async function cleanupFS(ffmpeg, { inputName, mounted }) {
  try {
    if (mounted) {
      await ffmpeg.unmount(MOUNT_POINT);
    } else {
      await ffmpeg.deleteFile(inputName);
    }
  } catch (_) {}
  try { await ffmpeg.deleteFile(OUTPUT_NAME); } catch (_) {}
}

function isMemoryError(message) {
  return /memory|out of bounds|OOM/i.test(message);
}

/**
 * Convierte un video a WebM con la instancia actual de ffmpeg.wasm.
 * Nunca lanza: deja el video en 'completed', 'error' o 'cancelled'.
 */
export async function convertVideo(video) {
  const preset = getPreset(video.presetId);
  const ffmpeg = state.ffmpeg;
  const durationSec = Number(video.metadata?.duration || 0);

  if (!ffmpeg || !state.ffmpegLoaded) {
    video.status = 'error';
    video.errorMessage = 'ffmpeg no está cargado';
    updateVideoCard(video);
    return;
  }

  logVideo(video, `Iniciando conversión · ${preset.label} (CRF ${video.crf})`);
  video.status = 'converting';
  video.progress = 0;
  video.conversionStartTime = Date.now();
  video.scaledResolution = expectedScaledResolution(video.metadata, preset);
  if (video.scaledResolution) {
    logVideo(video, `Escalando a ${video.scaledResolution}`);
  }
  updateVideoCard(video);

  let lastLoggedProgress = 0;
  const onProgress = ({ progress }) => {
    // ffmpeg.wasm puede dar valores fuera de rango si no conoce la duración
    const pct = Math.max(0, Math.min(Math.round(progress * 100), 99));
    video.progress = pct;
    updateVideoCard(video);
    if (pct - lastLoggedProgress >= 10 || pct >= 99) {
      lastLoggedProgress = pct;
      logVideo(video, `Progreso ${pct}%`);
    }
  };

  const onLog = ({ message }) => {
    debugLog('[FFmpeg]', message);
    const frameMatch = message.match(/frame=\s*(\d+).*size=\s*([\d.]+)kB/);
    if (frameMatch) {
      video.currentFrame = parseInt(frameMatch[1], 10);
      video.currentSizeKB = parseFloat(frameMatch[2]);
      updateVideoCard(video);
    }
    if (/^(frame=|Input #0|Output #0|Stream|Error|Unknown|Could not|Invalid)/.test(message)) {
      logVideo(video, message.trim());
    }
  };

  let input = null;
  ffmpeg.on('progress', onProgress);
  ffmpeg.on('log', onLog);

  try {
    input = await writeInput(ffmpeg, video);

    const args = buildFfmpegArgs(input.inputName, preset);
    video.ffmpegArgsUsed = args;
    debugLog('[convertVideo] Argumentos FFmpeg:', args.join(' '));
    logVideo(video, `VP8 · CRF ${preset.crf} · cpu-used ${preset.cpuUsed}`);

    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg terminó con código ${exitCode}. Revisa los logs para más detalles.`);
    }

    const data = await ffmpeg.readFile(OUTPUT_NAME);
    const blob = new Blob([data], { type: 'video/webm' });

    const bitrateKbps = durationSec > 0 ? Math.round((blob.size * 8) / (durationSec * 1000)) : null;
    logVideo(video, `COMPLETADO - CRF ${video.crf}`);
    if (bitrateKbps !== null) logVideo(video, `Bitrate resultante: ${bitrateKbps} kbps`);
    logVideo(video, `Tamaño: ${formatMB(blob.size)} (original ${formatMB(video.originalSize)}, ${formatReduction(video.originalSize, blob.size)})`);

    Object.assign(video, {
      status: 'completed',
      progress: 100,
      webmBlob: blob,
      webmSize: blob.size,
      webmUrl: URL.createObjectURL(blob)
    });
    showNotification(`video convertido: ${video.originalFile.name}`, 'success');
  } catch (error) {
    if (video.status === 'cancelled') {
      // cancelVideo() ya terminó la instancia y actualizó la tarjeta
      debugLog('[convertVideo] Conversión cancelada por el usuario');
    } else {
      console.error('[convertVideo] ✗ Error convirtiendo video:', error);
      const message = error?.message || String(error) || 'desconocido';
      const oom = isMemoryError(message);
      logVideo(video, oom
        ? `Error: sin memoria suficiente para este archivo (${formatMB(video.originalSize)}). Prueba un archivo más pequeño.`
        : `Error: ${message}`);
      video.status = 'error';
      video.errorMessage = oom ? 'archivo demasiado grande para la memoria del navegador' : 'error al convertir el video';
      showNotification(`error al convertir: ${video.originalFile.name}`, 'error');
    }
  } finally {
    // Si la instancia se terminó (cancelación) estas llamadas fallan en silencio
    ffmpeg.off('progress', onProgress);
    ffmpeg.off('log', onLog);
    if (input && state.ffmpeg === ffmpeg) {
      await cleanupFS(ffmpeg, input);
    }
    updateVideoCard(video);
    updateVideosContainer();
  }
}
