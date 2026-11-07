import { CONFIG, isGif, settingsFor } from './config.js';
import { state } from './state.js';
import { terminateFFmpeg } from './ffmpeg-loader.js';
import { debugLog, fixGifDelays, formatMB, formatReduction, getExtension } from './utils.js';
import { logVideo, updateVideoCard, updateVideosContainer } from './ui/cards.js';
import { showNotification } from './ui/notifications.js';

const MOUNT_POINT = '/mounted';
const OUTPUT_NAME = 'output.webm';
const POSTER_NAME = 'poster.webp';

// Escalado hecho por ffmpeg con las dimensiones reales del stream, así funciona
// aunque el navegador no haya podido leer los metadatos. Solo reduce (nunca amplía),
// mantiene el aspecto y deja dimensiones pares (VP8 lo requiere). Un vídeo vertical
// usa la caja girada (720p: 720×1280), si no saldría diminuto.
function buildScaleFilter({ maxWidth, maxHeight }) {
  const w = `if(gt(ih,iw),${maxHeight},${maxWidth})`;
  const h = `if(gt(ih,iw),${maxWidth},${maxHeight})`;
  return `scale='min(${w},iw)':'min(${h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
}

// Resolución que saldrá, solo para mostrarla en la UI. null si no hace falta escalar
// o si no conocemos los metadatos. Redondea como el filtro de ffmpeg (scale_eval.c):
// cada lado a lo más cercano, se queda con el menor y luego baja a par.
export function expectedScaledResolution({ width, height }, preset) {
  const [maxWidth, maxHeight] = height > width ? [preset.maxHeight, preset.maxWidth] : [preset.maxWidth, preset.maxHeight];
  if (!width || !height || (width <= maxWidth && height <= maxHeight)) return null;
  const [boxW, boxH] = [Math.min(maxWidth, width), Math.min(maxHeight, height)];
  const even = n => Math.max(2, Math.floor(n / 2) * 2);
  const w = Math.min(boxW, Math.round(boxH * width / height));
  const h = Math.min(boxH, Math.round(boxW * height / width));
  return `${even(w)}x${even(h)}`;
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
    ...(preset.audioBitrate
      ? ['-c:a', CONFIG.AUDIO_CODEC, '-b:a', preset.audioBitrate]  // libvorbis
      : ['-an']),                         // sin audio
    '-threads', '2',
    '-vf', buildScaleFilter(preset),
    '-pix_fmt', 'yuv420p'                 // sin canal alfa (los gif lo traen) y compatible con todo
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
  const bytes = new Uint8Array(buffer);
  // shortcut: los gifs de ≥200 MB (WORKERFS) no se corrigen; si alguna vez hace falta, leerlos aquí también
  if (isGif(file)) {
    const fixed = fixGifDelays(bytes);
    if (fixed) logVideo(video, `Gif: ${fixed} fotogramas de 0-1 cs pasan a 10 cs, como en el navegador`);
  }
  const inputName = `input.${getExtension(file.name) || 'bin'}`;
  await ffmpeg.writeFile(inputName, bytes);
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
  try { await ffmpeg.deleteFile(POSTER_NAME); } catch (_) {}
}

// El fotograma para el poster del <video> en una web: lo que se ve mientras carga.
// Lo saca ffmpeg del webm que acaba de salir (así sale .webp en todos los navegadores,
// también en Safari). A medio segundo, porque el primero de un clip cortado suele
// ser negro o un fundido; en loop, en clips de menos de 1 s y si no se sabe la
// duración (los gifs), el primero: en un bucle el poster tiene que casar con el
// arranque. scale=iw*sar por si los píxeles no son cuadrados. Devuelve null si no sale.
export function buildPosterArgs(preset, durationSec) {
  const ss = preset.id === 'loop' || !(durationSec >= 1) ? 0 : 0.5;
  return ['-ss', String(ss), '-i', OUTPUT_NAME, '-frames:v', '1', '-vf', 'scale=iw*sar:ih,setsar=1',
    '-c:v', 'libwebp', '-quality', '80', POSTER_NAME];
}

async function extractPoster(ffmpeg, preset, durationSec) {
  try {
    if (await ffmpeg.exec(buildPosterArgs(preset, durationSec)) !== 0) return null;
  } catch (error) {
    // el exec ha lanzado (memoria...): el webm vale, pero la instancia ya no
    console.error('[extractPoster] ✗', error);
    terminateFFmpeg();
    return null;
  }
  try {
    return new Blob([await ffmpeg.readFile(POSTER_NAME)], { type: 'image/webp' });
  } catch (_) {
    return null; // no salió ningún fotograma
  }
}

function isMemoryError(message) {
  return /memory|out of bounds|OOM/i.test(message);
}

/**
 * Convierte un video a WebM con la instancia actual de ffmpeg.wasm.
 * Nunca lanza: deja el video en 'completed', 'error' o 'cancelled'.
 */
export async function convertVideo(video) {
  const preset = settingsFor(video.presetId, video.originalFile, video);
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

  // Las últimas líneas de ffmpeg: si falla, son las que dicen por qué
  const lastLines = [];
  const onLog = ({ message }) => {
    debugLog('[FFmpeg]', message);
    if (video.extractingPoster) return; // el log del fotograma no es el de la conversión
    lastLines.push(message.trim());
    if (lastLines.length > 5) lastLines.shift();
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
      lastLines.forEach(line => logVideo(video, line));
      throw Object.assign(new Error(`FFmpeg terminó con código ${exitCode}. Revisa los logs para más detalles.`), { exitCode });
    }

    const data = await ffmpeg.readFile(OUTPUT_NAME);
    const blob = new Blob([data], { type: 'video/webm' });

    const bitrateKbps = durationSec > 0 ? Math.round((blob.size * 8) / (durationSec * 1000)) : null;
    logVideo(video, `COMPLETADO - CRF ${video.crf}`);
    if (bitrateKbps !== null) logVideo(video, `Bitrate resultante: ${bitrateKbps} kbps`);
    logVideo(video, `Tamaño: ${formatMB(blob.size)} (original ${formatMB(video.originalSize)}, ${formatReduction(video.originalSize, blob.size)})`);

    // El webm ya está: se guarda antes del fotograma, que no se puede cancelar (es un momento)
    Object.assign(video, { webmBlob: blob, webmSize: blob.size, webmUrl: URL.createObjectURL(blob) });

    if (video.poster) {
      ffmpeg.off('progress', onProgress); // el del fotograma volvería a empezar la barra
      video.extractingPoster = true;
      updateVideoCard(video);
      video.posterBlob = await extractPoster(ffmpeg, preset, durationSec);
      video.extractingPoster = false;
      logVideo(video, video.posterBlob
        ? `Fotograma: .poster.webp (${formatMB(video.posterBlob.size)})`
        : 'No se pudo sacar el fotograma');
      if (video.posterBlob) video.posterUrl = URL.createObjectURL(video.posterBlob);
    }

    Object.assign(video, { status: 'completed', progress: 100 });
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
      // Si ha lanzado (no un código de salida), la instancia puede quedar rota y
      // fallarían todos los que vienen: se termina y la cola la recarga
      if (error?.exitCode === undefined) terminateFFmpeg();
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
