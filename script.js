// ============================================================
// CONFIGURACIÓN GLOBAL DE LA APLICACIÓN
// ============================================================
// Usa ffmpeg.wasm v0.12.x con multi-threading (VP8 + SharedArrayBuffer)
// coi-serviceworker.js inyecta los headers COOP/COEP necesarios

const CONFIG = {
  DEBUG_LOGS: false,

  // Codec de video: VP8 para WebM (VP9 causa memory crash en ffmpeg.wasm, issue #679/#786)
  VIDEO_CODEC: 'libvpx',

  // Codec de audio: Vorbis en contenedor WebM (libopus causa stack overflow en WASM, issue #591)
  AUDIO_CODEC: 'libvorbis',

  // CDN base para @ffmpeg/core-mt
  CORE_MT_BASE: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.9/dist/umd',
};

// ============================================================
// PRESETS VP8: cada modo define resolución, CRF, bitrates, etc.
// ============================================================
// VP8 CRF: 4 (mejor) a 63 (peor).
// Con -b:v > 0: modo VBR limitado (CRF como piso de calidad, bitrate como techo).
// Esto permite que cada preset produzca archivos de tamaño realmente distinto.
// cpu-used: 0-16 (más alto = más rápido, menos calidad). Para WASM usar >= 4.
const PRESETS = {
  high: {
    id: 'high',
    label: '1080',
    description: '1080p · máxima calidad',
    maxWidth: 1920,
    maxHeight: 1080,
    crf: 10,
    videoBitrate: '1500k',   // Techo 1.5 Mbps (v2 usó 1742 real, baja un poco)
    audioBitrate: '128k',
    cpuUsed: 4,
    fps: null
  },
  medium: {
    id: 'medium',
    label: '720p',
    description: 'Recomendado · 720p',
    maxWidth: 1280,
    maxHeight: 720,
    crf: 20,
    videoBitrate: '1200k',   // Techo 1.2 Mbps → escalón claro entre alta y baja
    audioBitrate: '96k',
    cpuUsed: 5,
    fps: null
  },
  low: {
    id: 'low',
    label: '480p',
    description: '480p · pesa menos',
    maxWidth: 854,
    maxHeight: 480,
    crf: 33,
    videoBitrate: '800k',    // Mismo techo que v1 (te gustaba más)
    audioBitrate: '96k',
    cpuUsed: 8,
    fps: 24
  }
};

function getActivePreset() {
  return PRESETS[state.mode] || PRESETS.medium;
}

// Utilidad para log condicionado
function debugLog(...args) {
  if (CONFIG.DEBUG_LOGS) {
    console.log(...args);
  }
}

// ============================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ============================================================

const state = {
  videos: [],
  mode: 'medium',
  crf: PRESETS.medium.crf,
  ffmpeg: null,
  ffmpegLoaded: false,
  isLoadingFFmpeg: false,
  currentVideoId: null,
  currentCancelHandler: null,
  isConverting: false,
  pendingQueue: []
};

// Formatea tamaño desde KB a cadena MB con dos decimales
function formatSizeMBFromKB(kb) {
  if (!kb && kb !== 0) return '';
  return `${(kb / 1024).toFixed(2)} MB`;
}

// Limpia estado y DOM de un video
function cleanupVideo(id) {
  const index = state.videos.findIndex(v => v.id === id);
  if (index === -1) return;

  const video = state.videos[index];
  if (video.webmUrl) {
    URL.revokeObjectURL(video.webmUrl);
    debugLog('[cleanupVideo] URL revocada');
  }

  state.videos.splice(index, 1);

  const card = document.getElementById(`video-${id}`);
  if (card) {
    card.remove();
  }

  updateVideosContainer();

  if (state.videos.length === 0) {
    videosContainer.classList.remove('visible');
  }
}

// Elementos del DOM
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const selectBtn = document.getElementById('selectBtn');
const videosContainer = document.getElementById('videosContainer');
const videosList = document.getElementById('videosList');
const videoCount = document.getElementById('videoCount');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const qualityButtons = document.querySelectorAll('.quality-btn');
const uploadTitle = document.getElementById('uploadTitle');
const uploadSubtitle = document.getElementById('uploadSubtitle');

// ============================================================
// toBlobURL: descarga un archivo remoto y lo convierte a Blob URL
// ============================================================
async function toBlobURL(url, mimeType) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const blob = new Blob([buffer], { type: mimeType });
  return URL.createObjectURL(blob);
}

// ============================================================
// CARGAR FFMPEG.WASM (multi-thread con SharedArrayBuffer)
// ============================================================
async function loadFFmpeg() {
  if (state.ffmpegLoaded || state.isLoadingFFmpeg) {
    debugLog('[loadFFmpeg] FFmpeg ya está cargado o cargándose, saltando...');
    return;
  }

  state.isLoadingFFmpeg = true;
  updateUploadAreaLoading(true);

  try {
    // Verificar que SharedArrayBuffer está disponible (coi-serviceworker debe estar activo)
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer no disponible. Recarga la página (coi-serviceworker necesita un reload inicial).');
    }

    debugLog('[loadFFmpeg] Iniciando carga de ffmpeg.wasm multi-thread...');

    const { FFmpeg } = FFmpegWASM;
    const ffmpeg = new FFmpeg();

    // Log handler
    ffmpeg.on('log', ({ message }) => {
      debugLog('[FFmpeg log]', message);
    });

    // Cargar core multi-thread desde CDN como blob URLs
    const baseURL = CONFIG.CORE_MT_BASE;
    debugLog('[loadFFmpeg] Descargando core desde:', baseURL);

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
    });

    state.ffmpeg = ffmpeg;
    state.ffmpegLoaded = true;
    debugLog('[loadFFmpeg] ✓ ffmpeg.wasm cargado y listo');
    showNotification('ffmpeg cargado correctamente', 'success');
  } catch (error) {
    console.error('[loadFFmpeg] ✗ Error cargando FFmpeg:', error);
    showNotification('error al cargar ffmpeg. por favor, recarga la página.', 'error');
    state.ffmpeg = null;
  } finally {
    state.isLoadingFFmpeg = false;
    updateUploadAreaLoading(false);
  }
}

// Actualizar área de carga cuando FFmpeg está cargando
function updateUploadAreaLoading(isLoading) {
  debugLog('[updateUploadAreaLoading]', isLoading ? 'Cargando...' : 'Listo');
  if (isLoading) {
    uploadArea.classList.add('loading');
    uploadTitle.textContent = 'cargando ffmpeg...';
    uploadSubtitle.textContent = 'descargando (~31MB), puede tardar unos segundos';
    selectBtn.disabled = true;
  } else {
    uploadArea.classList.remove('loading');
    uploadTitle.textContent = 'arrastra vídeos aquí o haz clic para seleccionar';
    uploadSubtitle.textContent = 'soporta mp4, mov, avi, mkv, flv y más formatos';
    selectBtn.disabled = false;
  }
}

// Extraer metadata del video
async function extractMetadata(file) {
  debugLog('[extractMetadata] Extrayendo metadata de:', file.name);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      const metadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        codec: file.type
      };
      debugLog('[extractMetadata] Metadata extraída:', metadata);
      resolve(metadata);
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      console.warn('[extractMetadata] Error extrayendo metadata, usando valores por defecto');
      resolve({
        duration: 0,
        width: 0,
        height: 0,
        codec: file.type
      });
    };

    video.src = URL.createObjectURL(file);
  });
}

/**
 * Convierte un video a formato WebM usando ffmpeg.wasm (VP8 multi-thread)
 */
async function convertVideo(videoData) {
  debugLog('[convertVideo] Iniciando conversión de:', videoData.originalFile.name);
  const presetAtStart = PRESETS[videoData.presetId] ? PRESETS[videoData.presetId] : PRESETS.medium;
  const preset = presetAtStart;
  logVideo(videoData.id, `Iniciando conversión · ${presetAtStart.label} (CRF ${videoData.crf})`);
  state.currentVideoId = videoData.id;
  const durationSec = Number(videoData.metadata?.duration || 0);

  if (!state.ffmpeg || !state.ffmpegLoaded) {
    console.error('[convertVideo] FFmpeg no está cargado');
    showNotification('ffmpeg no está cargado', 'error');
    return;
  }

  const ffmpeg = state.ffmpeg;
  let inputName = `input.${videoData.originalFile.name.split('.').pop()}`;
  const outputName = 'output.webm';
  const crfValue = videoData.crf ?? state.crf;

  // Umbral para usar WORKERFS en lugar de writeFile (evita copiar archivos grandes a WASM memory)
  const WORKERFS_THRESHOLD = 200 * 1024 * 1024; // 200MB
  let usedWorkerFS = false;
  const mountPoint = '/mounted';

  try {
    // Actualizar estado a "convirtiendo"
    videoData.conversionStartTime = Date.now();
    updateVideoStatus(videoData.id, 'converting', 0);

    // Escribir archivo de entrada en el FS virtual de ffmpeg.wasm
    debugLog('[convertVideo] Tamaño del archivo:', videoData.originalFile.size, 'bytes');

    if (videoData.originalFile.size >= WORKERFS_THRESHOLD) {
      // Archivos grandes: montar con WORKERFS (no copia a memoria WASM)
      debugLog('[convertVideo] Archivo grande detectado, usando WORKERFS mount...');
      // Desmontar primero por si quedó montado de una conversión anterior
      try { await ffmpeg.unmount(mountPoint); } catch (_) {}
      try {
        await ffmpeg.createDir(mountPoint);
      } catch (_) {
        // El directorio puede ya existir
      }
      await ffmpeg.mount('WORKERFS', { files: [videoData.originalFile] }, mountPoint);
      usedWorkerFS = true;
      // WORKERFS monta el archivo con su nombre original
      inputName = `${mountPoint}/${videoData.originalFile.name}`;
      debugLog('[convertVideo] Archivo montado en:', inputName);
      logVideo(videoData.id, 'Usando lectura directa (WORKERFS) para archivo grande');
    } else {
      // Archivos pequeños: writeFile normal
      debugLog('[convertVideo] Escribiendo archivo con writeFile...');
      const fileBuffer = await videoData.originalFile.arrayBuffer();
      if (!fileBuffer || fileBuffer.byteLength === 0) {
        throw new Error(`No se pudo leer el archivo. arrayBuffer devolvió ${fileBuffer ? fileBuffer.byteLength : 'null'} bytes.`);
      }
      await ffmpeg.writeFile(inputName, new Uint8Array(fileBuffer));
      debugLog('[convertVideo] Archivo escrito, tamaño:', fileBuffer.byteLength, 'bytes');
    }

    // Detectar si necesitamos reducir la resolución
    const maxWidth = preset.maxWidth ?? PRESETS.medium.maxWidth;
    const maxHeight = preset.maxHeight ?? PRESETS.medium.maxHeight;
    let scaleFilter = null;

    if (videoData.metadata.width > maxWidth || videoData.metadata.height > maxHeight) {
      const aspectRatio = videoData.metadata.width / videoData.metadata.height;
      let newWidth, newHeight;

      if (aspectRatio > (maxWidth / maxHeight)) {
        newWidth = maxWidth;
        newHeight = Math.round(maxWidth / aspectRatio);
        newHeight = newHeight % 2 === 0 ? newHeight : newHeight - 1;
      } else {
        newHeight = maxHeight;
        newWidth = Math.round(maxHeight * aspectRatio);
        newWidth = newWidth % 2 === 0 ? newWidth : newWidth - 1;
      }

      scaleFilter = `scale=${newWidth}:${newHeight}`;
      videoData.scaledResolution = `${newWidth}x${newHeight}`;
      showNotification(`reduciendo a ${newWidth}x${newHeight} para optimizar`, 'info');
      logVideo(videoData.id, `Escalando a ${newWidth}x${newHeight}`);
    }

    // Construir comando FFmpeg para VP8
    const ffmpegArgs = [
      '-i', inputName,
      '-c:v', CONFIG.VIDEO_CODEC,        // libvpx (VP8)
      '-crf', crfValue.toString(),
      '-b:v', preset.videoBitrate,        // '0' para CQ puro, o bitrate techo
      '-cpu-used', String(preset.cpuUsed), // 0-16 (más alto = más rápido)
      '-lag-in-frames', '16',             // Lookahead frames (max efectivo 16)
      '-auto-alt-ref', '1',              // Mejora calidad con frames alternativos
      '-c:a', CONFIG.AUDIO_CODEC,        // libvorbis
      '-b:a', preset.audioBitrate,
      '-threads', '2'
    ];

    // Añadir filtro de escala si es necesario
    if (scaleFilter) {
      ffmpegArgs.push('-vf', scaleFilter);
    }

    // Limitar FPS (solo en algunos modos)
    if (preset.fps) {
      ffmpegArgs.push('-r', String(preset.fps));
    }

    ffmpegArgs.push(outputName);
    debugLog('[convertVideo] Argumentos FFmpeg:', ffmpegArgs.join(' '));
    logVideo(videoData.id, `VP8 · CRF ${crfValue} · cpu-used ${preset.cpuUsed}`);

    // Configurar handler de progreso
    let lastLoggedProgress = 0;
    const progressHandler = ({ progress }) => {
      const pct = Math.min(Math.round(progress * 100), 99);
      updateVideoProgress(videoData.id, pct);
      if (pct - lastLoggedProgress >= 10 || pct >= 99) {
        lastLoggedProgress = pct;
        logVideo(videoData.id, `Progreso ${pct}%`);
      }
    };
    ffmpeg.on('progress', progressHandler);

    // Configurar handler de log para extraer frame/size y capturar errores
    const logHandler = ({ message }) => {
      debugLog('[FFmpeg]', message);
      const frameMatch = message.match(/frame=\s*(\d+).*size=\s*([\d.]+)kB/);
      if (frameMatch) {
        videoData.currentFrame = parseInt(frameMatch[1]);
        videoData.currentSizeKB = parseFloat(frameMatch[2]);
        updateVideoCard(videoData.id);
      }
      // Loguear líneas relevantes en la UI
      if (/^(frame=|Input #0|Output #0|Stream|Error|Unknown|Could not|Invalid)/.test(message)) {
        logVideo(videoData.id, message.trim());
      }
    };
    ffmpeg.on('log', logHandler);

    // Guardar preset usado
    videoData.presetUsed = { ...preset };
    videoData.ffmpegArgsUsed = [...ffmpegArgs];

    // Ejecutar conversión
    const exitCode = await ffmpeg.exec(ffmpegArgs);
    debugLog('[convertVideo] FFmpeg exit code:', exitCode);

    // Limpiar handlers
    ffmpeg.off('progress', progressHandler);
    ffmpeg.off('log', logHandler);

    if (exitCode !== 0) {
      throw new Error(`FFmpeg terminó con código ${exitCode}. Revisa los logs para más detalles.`);
    }

    // Leer archivo de salida
    debugLog('[convertVideo] Leyendo archivo de salida...');
    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data.buffer], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);

    // Limpiar archivos temporales del FS virtual
    try {
      if (usedWorkerFS) {
        await ffmpeg.unmount(mountPoint);
        debugLog('[convertVideo] WORKERFS desmontado');
      } else {
        await ffmpeg.deleteFile(inputName);
      }
      await ffmpeg.deleteFile(outputName);
    } catch (cleanupErr) {
      debugLog('[convertVideo] Error limpiando archivos temporales:', cleanupErr);
    }

    // Estadísticas
    const webmSizeMB = (blob.size / (1024 * 1024)).toFixed(2);
    const originalSizeMB = (videoData.originalSize / (1024 * 1024)).toFixed(2);
    const reductionNum = (1 - blob.size / videoData.originalSize) * 100;
    const reductionLabel = reductionNum >= 0 ? `-${reductionNum.toFixed(1)}%` : `+${Math.abs(reductionNum).toFixed(1)}%`;
    const bitrateKbps = durationSec > 0 ? Math.round((blob.size * 8) / (durationSec * 1000)) : null;
    logVideo(videoData.id, `COMPLETADO - CRF ${videoData.crf}`);
    if (bitrateKbps !== null) {
      logVideo(videoData.id, `Bitrate resultante: ${bitrateKbps} kbps`);
    }
    logVideo(videoData.id, `Tamaño: ${webmSizeMB} MB (original ${originalSizeMB} MB, ${reductionLabel})`);

    // Actualizar estado a "completado"
    updateVideoCompleted(videoData.id, blob, url);
    showNotification(`video convertido: ${videoData.originalFile.name}`, 'success');
  } catch (error) {
    console.error('[convertVideo] ✗ Error convirtiendo video:', error);

    // Limpiar WORKERFS si estaba montado
    if (usedWorkerFS) {
      try {
        await ffmpeg.unmount(mountPoint);
        debugLog('[convertVideo] WORKERFS desmontado (en error handler)');
      } catch (_) {}
    }

    // Si fue cancelado por cancelVideo(), ya está manejado
    if (videoData.status === 'cancelled') {
      debugLog('[convertVideo] Conversión cancelada por el usuario');
    } else if (error?.message === 'cancelled') {
      updateVideoStatus(videoData.id, 'cancelled', 0);
      logVideo(videoData.id, 'Conversión cancelada');
      showNotification(`conversión cancelada: ${videoData.originalFile.name}`, 'info');
    } else {
      const errorStr = error?.message || String(error) || 'desconocido';
      const isMemoryError = errorStr.includes('memory') || errorStr.includes('out of bounds') || errorStr.includes('OOM');
      const errorMsg = isMemoryError
        ? `Sin memoria suficiente para este archivo (${(videoData.originalSize / (1024 * 1024)).toFixed(0)} MB). Prueba un archivo más pequeño.`
        : errorStr;
      logVideo(videoData.id, `Error: ${errorMsg}`);
      updateVideoError(videoData.id, isMemoryError ? 'archivo demasiado grande para la memoria del navegador' : 'error al convertir el video');
      showNotification(`error al convertir: ${videoData.originalFile.name}`, 'error');
    }
  }
  state.currentCancelHandler = null;
  state.currentVideoId = null;
}

// Manejar archivos seleccionados
async function handleFiles(files) {
  debugLog('[handleFiles] Archivos recibidos:', files.length);

  if (!files || files.length === 0) {
    console.warn('[handleFiles] No se recibieron archivos');
    return;
  }

  if (!state.ffmpegLoaded) {
    console.error('[handleFiles] FFmpeg aún no está cargado');
    showNotification('ffmpeg aún se está cargando. por favor, espera un momento.', 'error');
    return;
  }

  const videoFiles = Array.from(files).filter(file => file.type.startsWith('video/'));
  debugLog('[handleFiles] Archivos de video válidos:', videoFiles.length);

  if (videoFiles.length === 0) {
    console.warn('[handleFiles] No se encontraron archivos de video válidos');
    showNotification('por favor, selecciona archivos de video válidos', 'error');
    return;
  }

  // Avisar si algún archivo es muy grande (>500MB)
  const MAX_SAFE_SIZE = 500 * 1024 * 1024;
  const largeFiles = videoFiles.filter(f => f.size > MAX_SAFE_SIZE);
  if (largeFiles.length > 0) {
    const names = largeFiles.map(f => f.name).join(', ');
    showNotification(`archivos grandes detectados (${names}). puede fallar por memoria del navegador.`, 'warning');
  }

  // Crear objetos VideoData para cada archivo
  const newIds = [];
  for (const file of videoFiles) {
    debugLog('[handleFiles] Procesando archivo:', file.name, 'tipo:', file.type, 'tamaño:', file.size);
    const metadata = await extractMetadata(file);
    const videoData = {
      id: crypto.randomUUID(),
      presetId: state.mode,
      originalFile: file,
      originalSize: file.size,
      webmBlob: null,
      webmSize: 0,
      webmUrl: null,
      crf: state.crf,
      logs: [],
      currentFrame: null,
      currentSizeKB: null,
      status: 'pending',
      progress: 0,
      metadata
    };

    debugLog('[handleFiles] VideoData creado:', videoData.id);
    state.videos.push(videoData);
    renderVideoCard(videoData);
    newIds.push(videoData.id);
  }

  updateVideosContainer();

  // Añadir a la cola y procesar
  state.pendingQueue.push(...newIds);
  processQueue();
}

// Cola de conversión secuencial (evita que dos conversiones corran a la vez en FFmpeg)
async function processQueue() {
  if (state.isConverting) return;
  state.isConverting = true;

  while (state.pendingQueue.length > 0) {
    const nextId = state.pendingQueue.shift();
    const videoData = state.videos.find(v => v.id === nextId);
    if (!videoData || videoData.status === 'cancelled') continue;

    if (!state.ffmpegLoaded) {
      await loadFFmpeg();
      if (!state.ffmpegLoaded) {
        updateVideoError(nextId, 'ffmpeg no pudo cargarse');
        continue;
      }
    }

    await convertVideo(videoData);
  }

  state.isConverting = false;
  debugLog('[processQueue] ✓ Cola de conversión vacía');
}

// Actualizar estado del video
function updateVideoStatus(id, status, progress = 0) {
  debugLog('[updateVideoStatus]', id, 'estado:', status, 'progreso:', progress);
  const video = state.videos.find(v => v.id === id);
  if (video) {
    video.status = status;
    video.progress = progress;
    updateVideoCard(id);
  }
}

// Actualizar progreso del video
function updateVideoProgress(id, progress) {
  const video = state.videos.find(v => v.id === id);
  if (video) {
    video.progress = progress;
    updateVideoCard(id);
  }
}

// Actualizar video completado
function updateVideoCompleted(id, blob, url) {
  debugLog('[updateVideoCompleted]', id, 'tamaño blob:', blob.size);
  const video = state.videos.find(v => v.id === id);
  if (video) {
    video.status = 'completed';
    video.progress = 100;
    video.webmBlob = blob;
    video.webmSize = blob.size;
    video.webmUrl = url;
    updateVideoCard(id);
    updateVideosContainer();
  }
}

// Actualizar video con error
function updateVideoError(id, errorMessage) {
  debugLog('[updateVideoError]', id, 'error:', errorMessage);
  const video = state.videos.find(v => v.id === id);
  if (video) {
    video.status = 'error';
    video.errorMessage = errorMessage;
    updateVideoCard(id);
  }
}

// SVG del botón eliminar
const REMOVE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

// Renderizar tarjeta de video
function renderVideoCard(videoData) {
  debugLog('[renderVideoCard]', videoData.id);
  const card = document.createElement('div');
  card.className = 'video-card';
  card.id = `video-${videoData.id}`;
  card.dataset.videoId = videoData.id;

  const originalSizeMB = (videoData.originalSize / (1024 * 1024)).toFixed(2);
  const duration = videoData.metadata.duration > 0
    ? formatDuration(videoData.metadata.duration)
    : 'desconocida';

  card.innerHTML = `
    <div class="video-info">
      <div class="video-name">${escapeHtml(videoData.originalFile.name)}</div>
      <div class="video-meta">
        <span>${originalSizeMB} MB</span>
        <span>•</span>
        <span>${duration}</span>
        ${videoData.metadata.width > 0 ? `
          <span>•</span>
          <span>${videoData.metadata.width}x${videoData.metadata.height}</span>
        ` : ''}
      </div>
      <div class="video-badges">
        <span class="badge badge-preset">${(PRESETS[videoData.presetId] || PRESETS.medium).label}</span>
        <span class="badge badge-crf">crf ${videoData.crf}</span>
        ${videoData.metadata.width > 0 ? `<span class="badge badge-res">${videoData.metadata.width}x${videoData.metadata.height}</span>` : ''}
      </div>
    </div>
    <div class="video-status">
      <div class="status-text">esperando...</div>
      <div class="progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
    </div>
    <div class="video-logs"></div>
    <div class="video-actions">
      <button class="btn-download" disabled>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 11L4 7h2.5V3h3v4H12L8 11z" fill="currentColor"/>
          <path d="M13 13H3v-2H2v2a1 1 0 001 1h10a1 1 0 001-1v-2h-1v2z" fill="currentColor"/>
        </svg>
        descargar
      </button>
      <button class="btn-remove" title="eliminar">
        ${REMOVE_SVG}
      </button>
    </div>
  `;

  videosList.appendChild(card);

  const removeBtn = card.querySelector('.btn-remove');
  removeBtn.addEventListener('click', () => removeVideo(videoData.id));
}

// Actualizar tarjeta de video
function updateVideoCard(id) {
  const card = document.getElementById(`video-${id}`);
  if (!card) return;

  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  const statusText = card.querySelector('.status-text');
  const progressBar = card.querySelector('.progress-bar');
  const progressFill = card.querySelector('.progress-fill');
  const downloadBtn = card.querySelector('.btn-download');
  const badgeCrf = card.querySelector('.badge-crf');
  const badgeRes = card.querySelector('.badge-res');
  const removeBtn = card.querySelector('.btn-remove');

  if (badgeCrf) {
    badgeCrf.textContent = `crf ${video.crf}`;
  }
  if (badgeRes) {
    if (video.scaledResolution) {
      badgeRes.textContent = video.scaledResolution;
    } else if (video.metadata.width > 0) {
      badgeRes.textContent = `${video.metadata.width}x${video.metadata.height}`;
    }
  }

  // Reset clases de estado
  statusText.className = 'status-text';
  progressFill.className = 'progress-fill';

  switch (video.status) {
    case 'pending':
      statusText.textContent = 'esperando...';
      progressFill.style.width = '0%';
      if (progressBar) progressBar.setAttribute('aria-valuenow', '0');
      downloadBtn.disabled = true;
      if (removeBtn) {
        removeBtn.innerHTML = REMOVE_SVG;
        removeBtn.title = 'eliminar';
        removeBtn.onclick = () => removeVideo(id);
      }
      break;

    case 'converting':
      let statusMessage = `convirtiendo... ${video.progress}%`;
      if (video.scaledResolution) {
        statusMessage = `convirtiendo (${video.scaledResolution})... ${video.progress}%`;
      }
      const extras = [];
      if (video.currentFrame != null) extras.push(`frame ${video.currentFrame}`);
      if (video.currentSizeKB != null) extras.push(formatSizeMBFromKB(video.currentSizeKB));
      // ETA basada en tiempo transcurrido y progreso
      if (video.progress > 5 && video.conversionStartTime) {
        const elapsed = (Date.now() - video.conversionStartTime) / 1000;
        const remaining = (elapsed / video.progress) * (100 - video.progress);
        if (remaining < 60) {
          extras.push(`~${Math.round(remaining)}s`);
        } else {
          extras.push(`~${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`);
        }
      }
      if (extras.length) {
        statusMessage += ` · ${extras.join(' · ')}`;
      }
      statusText.textContent = statusMessage;
      progressFill.style.width = `${video.progress}%`;
      if (progressBar) progressBar.setAttribute('aria-valuenow', String(video.progress));
      downloadBtn.disabled = true;
      if (removeBtn) {
        removeBtn.textContent = 'cancelar';
        removeBtn.title = 'cancelar conversión';
        removeBtn.onclick = () => cancelVideo(id);
      }
      break;

    case 'completed': {
      const webmSizeMB = (video.webmSize / (1024 * 1024)).toFixed(2);
      const reductionNum = (1 - video.webmSize / video.originalSize) * 100;
      const reductionLabel = reductionNum >= 0 ? `-${reductionNum.toFixed(1)}%` : `+${Math.abs(reductionNum).toFixed(1)}%`;
      statusText.textContent = `completado - ${webmSizeMB} MB (${reductionLabel}) - crf ${video.crf}`;
      statusText.classList.add('status-success');
      progressFill.style.width = '100%';
      progressFill.classList.add('progress-success');
      if (progressBar) progressBar.setAttribute('aria-valuenow', '100');
      downloadBtn.disabled = false;
      downloadBtn.onclick = () => downloadVideo(id);
      if (removeBtn) {
        removeBtn.innerHTML = REMOVE_SVG;
        removeBtn.title = 'eliminar';
        removeBtn.onclick = () => removeVideo(id);
      }
      break;
    }

    case 'error':
      statusText.textContent = video.errorMessage || 'error al convertir';
      statusText.classList.add('status-error');
      progressFill.style.width = '0%';
      downloadBtn.disabled = true;
      if (removeBtn) {
        removeBtn.innerHTML = REMOVE_SVG;
        removeBtn.title = 'eliminar';
        removeBtn.onclick = () => removeVideo(id);
      }
      break;

    case 'cancelled':
      statusText.textContent = 'cancelado';
      statusText.classList.add('status-cancelled');
      progressFill.style.width = '0%';
      progressFill.classList.add('progress-cancelled');
      downloadBtn.disabled = true;
      if (removeBtn) {
        removeBtn.innerHTML = REMOVE_SVG;
        removeBtn.title = 'eliminar';
        removeBtn.onclick = () => removeVideo(id);
      }
      break;
  }
}

// Actualizar contenedor de videos
function updateVideosContainer() {
  const totalVideos = state.videos.length;
  const completedVideos = state.videos.filter(v => v.status === 'completed').length;

  debugLog('[updateVideosContainer] Total:', totalVideos, 'Completados:', completedVideos);
  videoCount.textContent = `${completedVideos} de ${totalVideos} videos convertidos`;

  if (totalVideos > 0) {
    videosContainer.classList.add('visible');
  }

  downloadAllBtn.disabled = completedVideos === 0;
}

// Sufijo de nombre según preset
const PRESET_SUFFIX = {
  high: '_1080',
  medium: '_720p',
  low: '_480p'
};

// Generar nombre base del archivo de salida
function getOutputBaseName(video) {
  const baseName = video.originalFile.name.replace(/\.[^/.]+$/, '');
  const suffix = PRESET_SUFFIX[video.presetId] || '';
  return `${baseName}${suffix}`;
}

// Generar contenido del log como texto
function buildLogText(video) {
  const originalSizeMB = (video.originalSize / (1024 * 1024)).toFixed(2);
  const webmSizeMB = (video.webmSize / (1024 * 1024)).toFixed(2);
  const reduction = ((1 - video.webmSize / video.originalSize) * 100).toFixed(1);
  const duration = video.metadata?.duration > 0 ? formatDuration(video.metadata.duration) : 'desconocida';
  const preset = PRESETS[video.presetId] || {};

  const lines = [
    `=== Log de conversión ===`,
    `Archivo original: ${video.originalFile.name}`,
    `Tamaño original: ${originalSizeMB} MB`,
    `Resolución original: ${video.metadata?.width || '?'}x${video.metadata?.height || '?'}`,
    `Duración: ${duration}`,
    ``,
    `--- Configuración ---`,
    `Preset: ${preset.label || video.presetId}`,
    `Codec video: ${CONFIG.VIDEO_CODEC}`,
    `Codec audio: ${CONFIG.AUDIO_CODEC}`,
    `CRF: ${video.crf}`,
    `Bitrate techo: ${preset.videoBitrate || '?'}`,
    `Audio bitrate: ${preset.audioBitrate || '?'}`,
    `cpu-used: ${preset.cpuUsed || '?'}`,
    video.scaledResolution ? `Resolución de salida: ${video.scaledResolution}` : null,
    ``,
    `--- Resultado ---`,
    `Tamaño WebM: ${webmSizeMB} MB`,
    `Reducción: -${reduction}%`,
    ``,
    `--- Logs de FFmpeg ---`,
    ...(video.logs || [])
  ];

  return lines.filter(l => l !== null).join('\n');
}

// Descargar video individual
function downloadVideo(id) {
  debugLog('[downloadVideo]', id);
  const video = state.videos.find(v => v.id === id);
  if (!video || !video.webmUrl) {
    console.error('[downloadVideo] Video no encontrado o sin URL');
    return;
  }

  const baseName = getOutputBaseName(video);

  // Descargar video
  const videoLink = document.createElement('a');
  videoLink.href = video.webmUrl;
  videoLink.download = `${baseName}.webm`;
  videoLink.click();

  if (CONFIG.DEBUG_LOGS) {
    // Descargar log (solo en modo debug)
    const logText = buildLogText(video);
    const logBlob = new Blob([logText], { type: 'text/plain' });
    const logUrl = URL.createObjectURL(logBlob);
    const logLink = document.createElement('a');
    logLink.href = logUrl;
    logLink.download = `${baseName}_log.txt`;
    setTimeout(() => {
      logLink.click();
      URL.revokeObjectURL(logUrl);
    }, 100);
    debugLog('[downloadVideo] Descarga iniciada:', `${baseName}.webm + log`);
  } else {
    debugLog('[downloadVideo] Descarga iniciada:', `${baseName}.webm`);
  }
}

// Eliminar video
function removeVideo(id) {
  debugLog('[removeVideo]', id);
  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  // Si está convirtiendo, cancelar primero
  if (video.status === 'converting') {
    cancelVideo(id);
    return;
  }

  // Si está pendiente en cola, quitarlo
  state.pendingQueue = state.pendingQueue.filter(qId => qId !== id);
  cleanupVideo(id);
}

// Cancelar conversión en curso
function cancelVideo(id) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  if (video.status === 'pending') {
    state.pendingQueue = state.pendingQueue.filter(qId => qId !== id);
    cleanupVideo(id);
    return;
  }

  if (video.status !== 'converting') {
    cleanupVideo(id);
    return;
  }

  // Marcar como cancelado antes de terminar FFmpeg
  video.status = 'cancelled';
  logVideo(id, 'Solicitando cancelación...');

  // ffmpeg.wasm no tiene cancel nativo, terminamos la instancia
  if (state.ffmpeg) {
    try { state.ffmpeg.terminate(); } catch (_) {}
    state.ffmpeg = null;
    state.ffmpegLoaded = false;
  }

  state.isConverting = false;
  updateVideoCard(id);
  showNotification(`conversión cancelada: ${video.originalFile.name}`, 'info');

  // Recargar ffmpeg y continuar con la cola
  loadFFmpeg().then(() => processQueue());
}

/**
 * Descarga todos los videos completados en un archivo ZIP
 */
async function downloadAll() {
  debugLog('[downloadAll] Iniciando descarga de todos los videos en ZIP');
  const completedVideos = state.videos.filter(v => v.status === 'completed');

  if (completedVideos.length === 0) {
    console.warn('[downloadAll] No hay videos completados');
    showNotification('no hay videos completados para descargar', 'error');
    return;
  }

  try {
    // Cargar JSZip si no está disponible
    if (typeof JSZip === 'undefined') {
      debugLog('[downloadAll] Cargando JSZip desde CDN...');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      debugLog('[downloadAll] ✓ JSZip cargado');
    }

    showNotification('creando archivo zip...', 'info');

    const zip = new JSZip();
    const nameCounts = {};

    for (const video of completedVideos) {
      const baseName = getOutputBaseName(video);
      const count = (nameCounts[baseName] || 0) + 1;
      nameCounts[baseName] = count;
      const filename = count === 1 ? `${baseName}.webm` : `${baseName}-${count}.webm`;
      debugLog(`[downloadAll] Añadiendo al ZIP: ${filename}`);
      zip.file(filename, video.webmBlob);
      if (CONFIG.DEBUG_LOGS) {
        const logName = count === 1 ? `${baseName}_log.txt` : `${baseName}-${count}_log.txt`;
        zip.file(logName, buildLogText(video));
      }
    }

    debugLog('[downloadAll] Generando archivo ZIP...');
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `videos_convertidos_${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);

    debugLog('[downloadAll] ✓ ZIP descargado exitosamente');
    showNotification(`${completedVideos.length} videos descargados en zip`, 'success');
  } catch (error) {
    console.error('[downloadAll] Error creando ZIP:', error);
    showNotification('error al crear el archivo zip', 'error');
  }
}

/**
 * Carga un script externo de forma dinámica
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

// Formatear duración
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Escapar HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Agregar log a la tarjeta del video
function logVideo(id, message) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  const maxLen = 180;
  const safeMessage = message.length > maxLen ? `${message.slice(0, maxLen)}…` : message;
  const timestamp = new Date().toLocaleTimeString('es-ES', { hour12: false });
  const line = `[${timestamp}] ${safeMessage}`;
  video.logs = video.logs || [];
  video.logs.push(line);
  if (video.logs.length > 10) {
    video.logs = video.logs.slice(-10);
  }

  const card = document.getElementById(`video-${id}`);
  if (!card) return;
  const logsContainer = card.querySelector('.video-logs');
  if (!logsContainer) return;

  logsContainer.innerHTML = video.logs
    .map(entry => `<div>${escapeHtml(entry)}</div>`)
    .join('');
}

// Mostrar notificación
function showNotification(message, type = 'info') {
  debugLog('[showNotification]', type, message);
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  // Apilar notificaciones existentes hacia arriba
  const existing = document.querySelectorAll('.notification');
  for (let i = existing.length - 1; i >= 0; i--) {
    const n = existing[i];
    const idx = existing.length - 1 - i;
    n.style.bottom = `${2 + idx * 4}rem`;
  }

  setTimeout(() => notification.classList.add('show'), 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
      const remaining = document.querySelectorAll('.notification');
      remaining.forEach((n, i) => {
        n.style.bottom = `${2 + (remaining.length - 1 - i) * 4}rem`;
      });
    }, 300);
  }, 3000);
}

// Actualizar CRF desde botones
function updateCRFFromButton(button) {
  qualityButtons.forEach(btn => btn.classList.remove('active'));
  button.classList.add('active');

  const mode = (button.dataset.mode || 'medium').toLowerCase();
  state.mode = PRESETS[mode] ? mode : 'medium';

  const preset = getActivePreset();
  state.crf = preset.crf;

  debugLog('[updateCRFFromButton] Modo seleccionado:', state.mode, '| CRF:', state.crf);
}

// Event Listeners
uploadArea.addEventListener('click', () => {
  debugLog('[Event] Click en uploadArea');
  fileInput.click();
});

selectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  debugLog('[Event] Click en selectBtn');
  fileInput.click();
});

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  debugLog('[Event] Drop - archivos:', e.dataTransfer.files.length);
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
  debugLog('[Event] Change en fileInput - archivos:', e.target.files.length);
  handleFiles(e.target.files);
  e.target.value = '';
});

downloadAllBtn.addEventListener('click', () => {
  debugLog('[Event] Click en downloadAllBtn');
  downloadAll();
});

// Drag & drop para reordenar videos (desktop + touch via SortableJS).
// El orden del array state.videos determina el orden del ZIP final (downloadAll),
// así que basta con reordenar el array para que el resultado refleje el nuevo orden.
if (typeof Sortable !== 'undefined') {
  Sortable.create(videosList, {
    animation: 150,
    ghostClass: 'card-ghost',
    chosenClass: 'card-chosen',
    dragClass: 'card-dragging',
    onEnd: ({ oldIndex, newIndex }) => {
      if (oldIndex === newIndex) return;
      const [moved] = state.videos.splice(oldIndex, 1);
      state.videos.splice(newIndex, 0, moved);
      debugLog(`[Reorder] ${oldIndex} → ${newIndex}`);
    }
  });
}

// Pegar desde clipboard (Ctrl+V / Cmd+V)
document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('video/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length > 0) {
    e.preventDefault();
    handleFiles(files);
    showNotification(`${files.length} ${files.length === 1 ? 'vídeo pegado' : 'vídeos pegados'} desde el portapapeles`, 'info');
  }
});

qualityButtons.forEach(button => {
  button.addEventListener('click', () => updateCRFFromButton(button));
});

// ============================================================
// DEBUG: Convertir un video en las 3 calidades a la vez
// TODO: Quitar este bloque cuando no se necesite
// ============================================================
async function handleTripleConvert(file) {
  if (!file || !file.type.startsWith('video/')) {
    showNotification('selecciona un archivo de video válido', 'error');
    return;
  }
  if (!state.ffmpegLoaded) {
    showNotification('ffmpeg aún se está cargando', 'error');
    return;
  }

  debugLog('[debugTriple] Iniciando conversión triple de:', file.name);
  const metadata = await extractMetadata(file);
  const presetOrder = ['high', 'medium', 'low'];

  // Crear las 3 tarjetas primero
  const videoDataList = presetOrder.map(presetId => {
    const preset = PRESETS[presetId];
    const videoData = {
      id: crypto.randomUUID(),
      presetId,
      originalFile: file,
      originalSize: file.size,
      webmBlob: null,
      webmSize: 0,
      webmUrl: null,
      crf: preset.crf,
      logs: [],
      currentFrame: null,
      currentSizeKB: null,
      status: 'pending',
      progress: 0,
      metadata
    };
    state.videos.push(videoData);
    renderVideoCard(videoData);
    return videoData;
  });

  updateVideosContainer();

  // Convertir secuencialmente
  for (const videoData of videoDataList) {
    debugLog('[debugTriple] Convirtiendo:', videoData.presetId);
    await convertVideo(videoData);
  }
  debugLog('[debugTriple] ✓ Las 3 conversiones completadas');
  showNotification('las 3 conversiones han terminado', 'success');
}

const debugTripleBtn = document.getElementById('debugTripleBtn');
const debugTripleInput = document.getElementById('debugTripleInput');

if (debugTripleBtn && debugTripleInput) {
  debugTripleBtn.addEventListener('click', () => debugTripleInput.click());
  debugTripleInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleTripleConvert(e.target.files[0]);
      e.target.value = '';
    }
  });
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
  debugLog('='.repeat(60));
  debugLog('[INIT] DOM cargado, inicializando aplicación...');
  debugLog('[INIT] SharedArrayBuffer:', typeof SharedArrayBuffer !== 'undefined' ? 'disponible' : 'NO disponible');
  debugLog('[INIT] crossOriginIsolated:', self.crossOriginIsolated);
  debugLog('='.repeat(60));

  // Inicializar modo/CRF desde botón activo
  const activeButton = document.querySelector('.quality-btn.active');
  if (activeButton) {
    state.mode = (activeButton.dataset.mode || 'medium').toLowerCase();
  } else {
    state.mode = 'medium';
  }
  const preset = PRESETS[state.mode] ? PRESETS[state.mode] : PRESETS.medium;
  state.mode = preset.id;
  state.crf = preset.crf;
  debugLog('[INIT] Modo inicial:', state.mode, '| CRF:', state.crf);

  // Mostrar botón debug si DEBUG_LOGS está activado
  if (CONFIG.DEBUG_LOGS) {
    const debugDiv = document.getElementById('debugTriple');
    if (debugDiv) debugDiv.style.display = 'block';
  }

  loadFFmpeg();
});
