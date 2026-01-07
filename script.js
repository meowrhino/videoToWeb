// ============================================================
// CONFIGURACIÓN DE LA APLICACIÓN
// ============================================================
// Puedes modificar estos valores para ajustar el comportamiento del conversor

const CONFIG = {
  // Mostrar logs en consola (si es false, solo errores críticos van a consola)
  DEBUG_LOGS: false,
  // Resolución máxima permitida (videos más grandes se reducirán automáticamente)
  // 1280x720 es el límite seguro para evitar OOM en FFmpeg.js
  MAX_WIDTH: 1280,
  MAX_HEIGHT: 720,
  
  // Bitrates máximos por opción (VP8 necesita límite específico para CRF funcional)
  VIDEO_BITRATE_ALTA: '2500k',     // Alta Calidad (CRF 30)
  VIDEO_BITRATE_BALANCE: '1500k',  // Balance (CRF 33)
  VIDEO_BITRATE_MAXIMA: '1000k',   // Máxima Compresión (CRF 37)
  
  // CRF por defecto (Constant Rate Factor)
  // 3 opciones: 30 (Alta), 33 (Balance), 37 (Máxima)
  CRF_MIN: 30,
  CRF_MAX: 37,
  DEFAULT_CRF: 33,
  
  // Codec de video: VP8 optimizado para compresión
  VIDEO_CODEC: 'libvpx',  // VP8 codec para WebM (optimizado)
  
  // Codec de audio (no cambiar a menos que sepas lo que haces)
  AUDIO_CODEC: 'libopus',  // Opus codec para WebM
  
  // Parámetros de optimización de FFmpeg para VP8
  // cpu-used: 0-16 para VP8 (valores más altos = más rápido pero menor calidad)
  // speed: 2 es mejor calidad, 4 es más rápido
  CPU_USED: '2',
  DEADLINE: 'good',
  AUTO_ALT_REF: '1',
  
  // Ruta al worker de FFmpeg
  WORKER_PATH: 'ffmpeg-lib/ffmpeg-worker-webm.js',
  
  // Timeout para operaciones (en milisegundos)
  WORKER_READY_TIMEOUT: 10000,  // 10 segundos
  FFMPEG_LOAD_TIMEOUT: 30000     // 30 segundos
};

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
  crf: CONFIG.DEFAULT_CRF,
  ffmpeg: null,
  ffmpegLoaded: false,
  isLoadingFFmpeg: false,
  currentVideoId: null,
  currentCancelHandler: null
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

// Inicializar FFmpeg.js (versión compatible sin SharedArrayBuffer)
async function loadFFmpeg() {
  if (state.ffmpegLoaded || state.isLoadingFFmpeg) {
    debugLog('[loadFFmpeg] FFmpeg ya está cargado o cargándose, saltando...');
    return;
  }

  state.isLoadingFFmpeg = true;
  updateUploadAreaLoading(true);

  try {
    debugLog('[loadFFmpeg] Iniciando carga de FFmpeg.js (compatible con GitHub Pages)...');
    
    // Crear worker de FFmpeg
    debugLog(`[loadFFmpeg] Creando Worker desde: ${CONFIG.WORKER_PATH}`);
    state.ffmpeg = new Worker(CONFIG.WORKER_PATH);
    
    // Configurar manejadores de mensajes
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('[loadFFmpeg] Timeout esperando mensaje "ready"');
        reject(new Error('Timeout cargando FFmpeg'));
      }, CONFIG.FFMPEG_LOAD_TIMEOUT);

      state.ffmpeg.onmessage = (e) => {
        const msg = e.data;
        debugLog('[loadFFmpeg] Mensaje recibido del worker:', msg.type, msg);
        
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          debugLog('[loadFFmpeg] ✓ FFmpeg.js cargado y listo');
          state.ffmpegLoaded = true;
          resolve();
        } else if (msg.type === 'stdout') {
          debugLog('[FFmpeg stdout]', msg.data);
        } else if (msg.type === 'stderr') {
          debugLog('[FFmpeg stderr]', msg.data);
        }
      };

      state.ffmpeg.onerror = (error) => {
        clearTimeout(timeout);
        console.error('[loadFFmpeg] Error en el worker:', error);
        reject(error);
      };
    });

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
    uploadSubtitle.textContent = 'esto puede tardar unos segundos';
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
 * Convierte un video a formato WebM usando FFmpeg.js
 * 
 * Esta función:
 * 1. Recrea el worker de FFmpeg para cada conversión (evita errores de estado)
 * 2. Detecta videos de alta resolución y los reduce automáticamente
 * 3. Mantiene el aspect ratio al escalar
 * 4. Actualiza el progreso en tiempo real
 * 5. Maneja errores y limpia recursos
 * 
 * @param {Object} videoData - Objeto con información del video a convertir
 * @param {File} videoData.originalFile - Archivo de video original
 * @param {Object} videoData.metadata - Metadata del video (width, height, duration)
 * @param {string} videoData.id - ID único del video
 */
async function convertVideo(videoData) {
  debugLog('[convertVideo] Iniciando conversión de:', videoData.originalFile.name);
  logVideo(videoData.id, `Iniciando conversión (CRF ${videoData.crf})`);
  state.currentVideoId = videoData.id;
  
  // ============================================================
  // PASO 1: Recrear el worker para cada conversión
  // ============================================================
  // Esto evita el error "already running" que ocurre cuando un worker
  // anterior crashó o quedó en un estado inconsistente
  if (!state.ffmpeg || !state.ffmpegLoaded) {
    debugLog('[convertVideo] Creando worker y esperando ready...');
    state.ffmpeg = new Worker(CONFIG.WORKER_PATH);
    state.ffmpegLoaded = false;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout esperando worker')), CONFIG.WORKER_READY_TIMEOUT);
      state.ffmpeg.onmessage = (e) => {
        if (e.data.type === 'ready') {
          clearTimeout(timeout);
          debugLog('[convertVideo] ✓ Worker listo');
          state.ffmpegLoaded = true;
          resolve();
        }
      };
      state.ffmpeg.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };
    });
  } else {
    debugLog('[convertVideo] Reutilizando worker ya cargado');
  }
  
  if (!state.ffmpeg || !state.ffmpegLoaded) {
    console.error('[convertVideo] FFmpeg no está cargado');
    showNotification('ffmpeg no está cargado', 'error');
    return;
  }

  const worker = state.ffmpeg;
  const inputName = `input.${videoData.originalFile.name.split('.').pop()}`;
  const outputName = 'output.webm';
  const crfValue = videoData.crf ?? state.crf;

  try {
    // Actualizar estado a "convirtiendo"
    updateVideoStatus(videoData.id, 'converting', 0);

    debugLog('[convertVideo] Leyendo archivo de entrada...');
    // Leer archivo como ArrayBuffer
    const fileData = await videoData.originalFile.arrayBuffer();
    debugLog('[convertVideo] Archivo leído, tamaño:', fileData.byteLength, 'bytes');

    debugLog('[convertVideo] Preparando comando FFmpeg...');
    
    // Detectar si necesitamos reducir la resolución para evitar OOM
    // Usando los límites definidos en CONFIG para asegurar que funcione con la memoria limitada de ffmpeg.js
    const maxWidth = CONFIG.MAX_WIDTH;
    const maxHeight = CONFIG.MAX_HEIGHT;
    let scaleFilter = null;
    
    if (videoData.metadata.width > maxWidth || videoData.metadata.height > maxHeight) {
      // ============================================================
      // REDUCCIÓN AUTOMÁTICA DE RESOLUCIÓN
      // ============================================================
      // Calcular nueva resolución manteniendo aspect ratio para evitar distorsión
      const aspectRatio = videoData.metadata.width / videoData.metadata.height;
      let newWidth, newHeight;
      
      if (aspectRatio > (maxWidth / maxHeight)) {
        // Video más ancho, limitar por ancho
        newWidth = maxWidth;
        newHeight = Math.round(maxWidth / aspectRatio);
        // Asegurar que sea par (requerido por VP8)
        newHeight = newHeight % 2 === 0 ? newHeight : newHeight - 1;
      } else {
        // Video más alto, limitar por alto
        newHeight = maxHeight;
        newWidth = Math.round(maxHeight * aspectRatio);
        // Asegurar que sea par (requerido por VP8)
        newWidth = newWidth % 2 === 0 ? newWidth : newWidth - 1;
      }
      
      scaleFilter = `scale=${newWidth}:${newHeight}`;
      videoData.scaledResolution = `${newWidth}x${newHeight}`;
      debugLog(`[convertVideo] ⚠️  Video de alta resolución detectado (${videoData.metadata.width}x${videoData.metadata.height})`);
      debugLog(`[convertVideo] 📐 Reduciendo a ${newWidth}x${newHeight} para evitar problemas de memoria`);
      showNotification(`video de alta resolución detectado. reduciendo a ${newWidth}x${newHeight} para optimizar`, 'info');
      logVideo(videoData.id, `Escalando a ${newWidth}x${newHeight} para evitar OOM`);
    }
    
    // ============================================================
    // PASO 2: Determinar bitrate máximo según CRF
    // ============================================================
    // VP8 necesita un bitrate máximo específico para que CRF funcione correctamente
    let targetBitrate;
    if (crfValue === CONFIG.CRF_MIN) {
      targetBitrate = CONFIG.VIDEO_BITRATE_ALTA;
    } else if (crfValue === CONFIG.DEFAULT_CRF) {
      targetBitrate = CONFIG.VIDEO_BITRATE_BALANCE;
    } else {
      targetBitrate = CONFIG.VIDEO_BITRATE_MAXIMA;
    }
    
    logVideo(videoData.id, `⚡ USANDO CRF ${crfValue} con bitrate máximo ${targetBitrate}`);
    logVideo(videoData.id, `🎯 CRF configurado: ${crfValue} (menor = mejor calidad)`);
    
    // ============================================================
    // PASO 3: Construir comando FFmpeg
    // ============================================================
    // Parámetros optimizados para VP8 con mejor compresión
    const ffmpegArgs = [
      '-i', inputName,
      '-c:v', CONFIG.VIDEO_CODEC,  // libvpx (VP8)
      '-crf', crfValue.toString(),
      '-b:v', targetBitrate,  // Bitrate máximo específico por opción
      '-quality', 'good',
      '-c:a', CONFIG.AUDIO_CODEC,  // libopus
      '-cpu-used', CONFIG.CPU_USED,  // 2 = mejor calidad
      '-deadline', CONFIG.DEADLINE,  // 'good' = calidad decente
      '-auto-alt-ref', CONFIG.AUTO_ALT_REF,  // 1 = mejor compresión
      '-lag-in-frames', '25',  // Mejora compresión
      '-threads', '4'  // Número de threads
    ];
    
    // Añadir filtro de escala si es necesario
    if (scaleFilter) {
      ffmpegArgs.push('-vf', scaleFilter);
    }
    
    ffmpegArgs.push(outputName);
    debugLog('[convertVideo] Argumentos FFmpeg:', ffmpegArgs.join(' '));
    logVideo(videoData.id, `FFmpeg args: ${ffmpegArgs.join(' ')}`);
    
    // Enviar comando a FFmpeg worker
    const result = await new Promise((resolve, reject) => {
      let lastProgress = 0;
      let lastLoggedProgress = 0;
      let hasStarted = false;

      // Cancelación
      state.currentCancelHandler = () => {
        logVideo(videoData.id, 'Cancelando conversión...');
        state.ffmpegLoaded = false;
        state.ffmpeg?.terminate();
        state.ffmpeg = null;
        reject(new Error('cancelled'));
      };

      worker.onmessage = (e) => {
        const msg = e.data;
        debugLog('[convertVideo] Mensaje del worker:', msg.type);
        
        if (msg.type === 'run') {
          debugLog('[convertVideo] ✓ FFmpeg ha iniciado el trabajo');
          hasStarted = true;
          logVideo(videoData.id, 'FFmpeg ha iniciado el trabajo');
        } else if (msg.type === 'stdout' || msg.type === 'stderr') {
          const text = msg.data || '';
          // Registrar en logs solo algunas líneas de stderr para no saturar
          if (msg.type === 'stderr' && /^(frame=|Input #0|Output #0)/.test(text)) {
            logVideo(videoData.id, text.trim());
          }
          // Extraer frame y tamaño parcial
          const frameMatch = text.match(/frame=\s*(\d+).*size=\s*([\d\.]+)kB/);
          if (frameMatch) {
            videoData.currentFrame = parseInt(frameMatch[1]);
            videoData.currentSizeKB = parseFloat(frameMatch[2]);
            updateVideoCard(videoData.id);
          }
          // Parsear progreso de FFmpeg (aparece en stderr)
          const progressMatch = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
          if (progressMatch && videoData.metadata.duration > 0) {
            const hours = parseInt(progressMatch[1]);
            const minutes = parseInt(progressMatch[2]);
            const seconds = parseFloat(progressMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;
            const progress = Math.min(Math.round((currentTime / videoData.metadata.duration) * 100), 99);
            
            if (progress !== lastProgress) {
              lastProgress = progress;
              debugLog('[convertVideo] Progreso:', progress + '%');
              updateVideoProgress(videoData.id, progress);
              if (progress - lastLoggedProgress >= 5 || progress >= 99) {
                lastLoggedProgress = progress;
                logVideo(videoData.id, `Progreso ${progress}%`);
              }
            }
          }
        } else if (msg.type === 'exit') {
          debugLog('[convertVideo] FFmpeg terminó con código:', msg.data);
        } else if (msg.type === 'done') {
          debugLog('[convertVideo] ✓ Trabajo completado, procesando resultado...');
          debugLog('[convertVideo] Resultado recibido:', msg.data);
          resolve(msg.data);
        } else if (msg.type === 'error') {
          console.error('[convertVideo] ✗ Error del worker:', msg.data);
          logVideo(videoData.id, `Error del worker: ${msg.data}`);
          reject(new Error(msg.data));
        }
      };

      debugLog('[convertVideo] Enviando comando al worker...');
      worker.postMessage({
        type: 'run',
        arguments: ffmpegArgs,
        MEMFS: [{
          name: inputName,
          data: new Uint8Array(fileData)
        }]
      });
    });

    debugLog('[convertVideo] Buscando archivo de salida en resultado...');
    debugLog('[convertVideo] Archivos en MEMFS:', result.MEMFS ? result.MEMFS.map(f => f.name) : 'undefined');
    
    // Buscar el archivo de salida en los resultados
    if (!result.MEMFS || !Array.isArray(result.MEMFS)) {
      console.error('[convertVideo] ✗ MEMFS no está definido o no es un array');
      throw new Error('Resultado inválido: MEMFS no definido');
    }

    const outputFile = result.MEMFS.find(f => f.name === outputName);
    if (!outputFile) {
      console.error('[convertVideo] ✗ No se encontró el archivo de salida:', outputName);
      console.error('[convertVideo] Archivos disponibles:', result.MEMFS.map(f => f.name).join(', '));
      throw new Error('No se generó el archivo de salida');
    }

    debugLog('[convertVideo] ✓ Archivo de salida encontrado:', outputFile.name, 'tamaño:', outputFile.data.length, 'bytes');

    // Crear blob del resultado
    const blob = new Blob([outputFile.data], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    debugLog('[convertVideo] ✓ Blob creado, URL:', url);
    const webmSizeMB = (blob.size / (1024 * 1024)).toFixed(2);
    const originalSizeMB = (videoData.originalSize / (1024 * 1024)).toFixed(2);
    const reduction = ((1 - blob.size / videoData.originalSize) * 100).toFixed(1);
    const bitrateKbps = Math.round((blob.size * 8) / (videoData.metadata.duration * 1000));
    logVideo(videoData.id, `✅ COMPLETADO - CRF ${videoData.crf}`);
    logVideo(videoData.id, `📊 Bitrate resultante: ${bitrateKbps} kbps`);
    logVideo(videoData.id, `💾 Tamaño: ${webmSizeMB} MB (original ${originalSizeMB} MB, -${reduction}%)`);
    debugLog('[convertVideo] Bitrate calculado:', bitrateKbps, 'kbps');

    // Actualizar estado a "completado"
    updateVideoCompleted(videoData.id, blob, url);

    debugLog('[convertVideo] ✓ Video convertido exitosamente');
    showNotification(`video convertido: ${videoData.originalFile.name}`, 'success');
  } catch (error) {
    console.error('[convertVideo] ✗ Error convirtiendo video:', error);
    console.error('[convertVideo] Stack trace:', error.stack);
    state.ffmpegLoaded = false;
    if (error.message === 'cancelled') {
      updateVideoStatus(videoData.id, 'cancelled', 0);
      logVideo(videoData.id, 'Conversión cancelada');
      showNotification(`conversión cancelada: ${videoData.originalFile.name}`, 'info');
    } else {
      logVideo(videoData.id, `Error: ${error.message || 'desconocido'}`);
      updateVideoError(videoData.id, 'error al convertir el video');
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

  // Crear objetos VideoData para cada archivo
  for (const file of videoFiles) {
    debugLog('[handleFiles] Procesando archivo:', file.name, 'tipo:', file.type, 'tamaño:', file.size);
    const metadata = await extractMetadata(file);
    const videoData = {
      id: `${file.name}_crf${state.crf}_${Date.now()}`,
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
  }

  updateVideosContainer();

  // Convertir videos uno por uno
  debugLog('[handleFiles] Iniciando conversión de', videoFiles.length, 'videos...');
  for (const file of videoFiles) {
    const videoData = state.videos.find(v => v.originalFile === file);
    if (videoData) {
      debugLog('[handleFiles] Convirtiendo:', videoData.id);
      await convertVideo(videoData);
    }
  }
  debugLog('[handleFiles] ✓ Todas las conversiones completadas');
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
    logVideo(id, `Progreso ${progress}%`);
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
        <span class="badge badge-crf">crf ${videoData.crf}</span>
        ${videoData.metadata.width > 0 ? `<span class="badge badge-res">${videoData.metadata.width}x${videoData.metadata.height}</span>` : ''}
      </div>
    </div>
    <div class="video-status">
      <div class="status-text">esperando...</div>
      <div class="progress-bar">
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
      <button class="btn-remove" onclick="removeVideo('${videoData.id}')">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `;

  videosList.appendChild(card);

  const removeBtn = card.querySelector('.btn-remove');
  if (removeBtn) {
    removeBtn.dataset.icon = removeBtn.innerHTML;
  }
}

// Actualizar tarjeta de video
function updateVideoCard(id) {
  const card = document.getElementById(`video-${id}`);
  if (!card) return;

  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  const statusText = card.querySelector('.status-text');
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

  switch (video.status) {
    case 'pending':
      statusText.textContent = 'esperando...';
      progressFill.style.width = '0%';
      downloadBtn.disabled = true;
      if (removeBtn) {
        removeBtn.innerHTML = removeBtn.dataset.icon || removeBtn.innerHTML;
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
      if (extras.length) {
        statusMessage += ` • ${extras.join(' • ')}`;
      }
      statusText.textContent = statusMessage;
      progressFill.style.width = `${video.progress}%`;
      downloadBtn.disabled = true;
      if (removeBtn) {
        removeBtn.textContent = 'cancelar';
        removeBtn.title = 'cancelar conversión';
        removeBtn.onclick = () => cancelVideo(id);
      }
      break;

    case 'completed':
      const webmSizeMB = (video.webmSize / (1024 * 1024)).toFixed(2);
      const reduction = ((1 - video.webmSize / video.originalSize) * 100).toFixed(1);
      statusText.textContent = `completado - ${webmSizeMB} MB (-${reduction}%) - crf ${video.crf}`;
      statusText.style.color = '#10b981';
      progressFill.style.width = '100%';
      progressFill.style.backgroundColor = '#10b981';
      downloadBtn.disabled = false;
      downloadBtn.onclick = () => downloadVideo(id);
      if (removeBtn) {
        removeBtn.innerHTML = removeBtn.dataset.icon || removeBtn.innerHTML;
        removeBtn.title = 'eliminar';
        removeBtn.onclick = () => removeVideo(id);
      }
      break;

    case 'error':
      statusText.textContent = video.errorMessage || 'error al convertir';
      statusText.style.color = '#ef4444';
      progressFill.style.width = '0%';
      downloadBtn.disabled = true;
      if (removeBtn) {
        removeBtn.innerHTML = removeBtn.dataset.icon || removeBtn.innerHTML;
        removeBtn.title = 'eliminar';
        removeBtn.onclick = () => removeVideo(id);
      }
      break;

    case 'cancelled':
      statusText.textContent = 'cancelado';
      statusText.style.color = '#6b7280';
      progressFill.style.width = '0%';
      progressFill.style.backgroundColor = '#d1d5db';
      downloadBtn.disabled = true;
      if (removeBtn) {
        removeBtn.innerHTML = removeBtn.dataset.icon || removeBtn.innerHTML;
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

// Descargar video individual
function downloadVideo(id) {
  debugLog('[downloadVideo]', id);
  const video = state.videos.find(v => v.id === id);
  if (!video || !video.webmUrl) {
    console.error('[downloadVideo] Video no encontrado o sin URL');
    return;
  }

  const link = document.createElement('a');
  link.href = video.webmUrl;
  link.download = video.originalFile.name.replace(/\.[^/.]+$/, '') + '.webm';
  link.click();
  debugLog('[downloadVideo] Descarga iniciada:', link.download);
}

// Eliminar video
function removeVideo(id) {
  debugLog('[removeVideo]', id);
  const index = state.videos.findIndex(v => v.id === id);
  if (index === -1) {
    console.error('[removeVideo] Video no encontrado');
    return;
  }

  const video = state.videos[index];

  // Si está convirtiendo, cancelar primero
  if (video.status === 'converting') {
    cancelVideo(id);
    return;
  }
  
  cleanupVideo(id);
}

// Cancelar conversión en curso
function cancelVideo(id) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;
  if (video.status !== 'converting') {
    cleanupVideo(id);
    return;
  }
  logVideo(id, 'Solicitando cancelación...');
  if (state.currentCancelHandler && state.currentVideoId === id) {
    state.currentCancelHandler();
  } else if (state.ffmpeg) {
    state.ffmpeg.terminate();
    state.ffmpegLoaded = false;
    state.ffmpeg = null;
  }
  updateVideoStatus(id, 'cancelled', 0);
  cleanupVideo(id);
}

/**
 * Descarga todos los videos completados en un archivo ZIP
 * Usa JSZip cargado desde CDN para crear el archivo ZIP en memoria
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
    
    // Crear instancia de JSZip
    const zip = new JSZip();
    
    // Añadir cada video al ZIP
    for (const video of completedVideos) {
      const filename = video.originalFile.name.replace(/\.[^/.]+$/, '') + '.webm';
      debugLog(`[downloadAll] Añadiendo al ZIP: ${filename}`);
      zip.file(filename, video.webmBlob);
    }
    
    // Generar el archivo ZIP
    debugLog('[downloadAll] Generando archivo ZIP...');
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    
    // Descargar el ZIP
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
 * @param {string} src - URL del script a cargar
 * @returns {Promise} - Promesa que se resuelve cuando el script se carga
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

  // Limitar longitud de cada línea para no saturar UI
  const maxLen = 180;
  const safeMessage = message.length > maxLen ? `${message.slice(0, maxLen)}…` : message;
  const timestamp = new Date().toLocaleTimeString('es-ES', { hour12: false });
  const line = `[${timestamp}] ${safeMessage}`;
  video.logs = video.logs || [];
  video.logs.push(line);
  // Limitar a los últimos 10 mensajes para no crecer sin límite
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
  // Crear elemento de notificación
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  // Agregar al DOM
  document.body.appendChild(notification);

  // Mostrar con animación
  setTimeout(() => notification.classList.add('show'), 10);

  // Ocultar y eliminar después de 3 segundos
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Actualizar CRF desde botones
function updateCRFFromButton(button) {
  // Remover active de todos los botones
  qualityButtons.forEach(btn => btn.classList.remove('active'));
  // Agregar active al botón clickeado
  button.classList.add('active');
  // Actualizar CRF
  const crf = parseInt(button.dataset.crf);
  state.crf = crf;
  debugLog('[updateCRFFromButton] CRF seleccionado:', crf);
}

// Event Listeners
uploadArea.addEventListener('click', () => {
  debugLog('[Event] Click en uploadArea');
  fileInput.click();
});

selectBtn.addEventListener('click', () => {
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
  e.target.value = ''; // Reset input
});

downloadAllBtn.addEventListener('click', () => {
  debugLog('[Event] Click en downloadAllBtn');
  downloadAll();
});

  // Event listeners para botones de calidad
  qualityButtons.forEach(button => {
    button.addEventListener('click', () => updateCRFFromButton(button));
  });

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
  debugLog('='.repeat(60));
  debugLog('[INIT] DOM cargado, inicializando aplicación...');
  debugLog('[INIT] Navegador:', navigator.userAgent);
  debugLog('[INIT] Soporte Worker:', typeof Worker !== 'undefined');
  debugLog('='.repeat(60));
  // Inicializar CRF desde botón activo
  const activeButton = document.querySelector('.quality-btn.active');
  if (activeButton) {
    state.crf = parseInt(activeButton.dataset.crf);
  } else {
    state.crf = CONFIG.DEFAULT_CRF;
  }
  debugLog('[INIT] CRF inicial:', state.crf);
  loadFFmpeg();
});
