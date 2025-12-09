// ============================================================
// CONFIGURACIÓN DE LA APLICACIÓN
// ============================================================
// Puedes modificar estos valores para ajustar el comportamiento del conversor

const CONFIG = {
  // Resolución máxima permitida (videos más grandes se reducirán automáticamente)
  // Valores recomendados: 1280x720 (HD), 1920x1080 (Full HD - requiere más memoria)
  MAX_WIDTH: 1920,
  MAX_HEIGHT: 1080,
  
  // Bitrate de video en formato FFmpeg (ej: '500K', '1M', '2M')
  // Valores más bajos = menos memoria usada, archivos más pequeños, menor calidad
  // Recomendado: '500K' para 720p, '1M' para 1080p
  VIDEO_BITRATE: '1M',
  
  // CRF por defecto (Constant Rate Factor)
  // Rango: 15-40. Valores más bajos = mejor calidad, archivos más grandes
  // Recomendado: 31 para balance calidad/tamaño
  DEFAULT_CRF: 31,
  
  // Codec de video (no cambiar a menos que sepas lo que haces)
  VIDEO_CODEC: 'libvpx',  // VP8 codec para WebM
  
  // Codec de audio (no cambiar a menos que sepas lo que haces)
  AUDIO_CODEC: 'libopus',  // Opus codec para WebM
  
  // Parámetros de optimización de FFmpeg
  // cpu-used: 0-16, valores más altos = conversión más rápida pero menor calidad
  // deadline: 'good', 'best', 'realtime'
  CPU_USED: '5',
  DEADLINE: 'realtime',
  AUTO_ALT_REF: '0',
  
  // Ruta al worker de FFmpeg
  WORKER_PATH: 'ffmpeg-lib/ffmpeg-worker-webm.js',
  
  // Timeout para operaciones (en milisegundos)
  WORKER_READY_TIMEOUT: 10000,  // 10 segundos
  FFMPEG_LOAD_TIMEOUT: 30000     // 30 segundos
};

// ============================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ============================================================

const state = {
  videos: [],
  crf: CONFIG.DEFAULT_CRF,
  ffmpeg: null,
  ffmpegLoaded: false,
  isLoadingFFmpeg: false
};

// Elementos del DOM
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const selectBtn = document.getElementById('selectBtn');
const videosContainer = document.getElementById('videosContainer');
const videosList = document.getElementById('videosList');
const videoCount = document.getElementById('videoCount');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const crfSlider = document.getElementById('crfSlider');
const crfValue = document.getElementById('crfValue');
const crfDescription = document.getElementById('crfDescription');
const uploadTitle = document.getElementById('uploadTitle');
const uploadSubtitle = document.getElementById('uploadSubtitle');

// Inicializar FFmpeg.js (versión compatible sin SharedArrayBuffer)
async function loadFFmpeg() {
  if (state.ffmpegLoaded || state.isLoadingFFmpeg) {
    console.log('[loadFFmpeg] FFmpeg ya está cargado o cargándose, saltando...');
    return;
  }

  state.isLoadingFFmpeg = true;
  updateUploadAreaLoading(true);

  try {
    console.log('[loadFFmpeg] Iniciando carga de FFmpeg.js (compatible con GitHub Pages)...');
    
    // Crear worker de FFmpeg
    console.log(`[loadFFmpeg] Creando Worker desde: ${CONFIG.WORKER_PATH}`);
    state.ffmpeg = new Worker(CONFIG.WORKER_PATH);
    
    // Configurar manejadores de mensajes
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('[loadFFmpeg] Timeout esperando mensaje "ready"');
        reject(new Error('Timeout cargando FFmpeg'));
      }, CONFIG.FFMPEG_LOAD_TIMEOUT);

      state.ffmpeg.onmessage = (e) => {
        const msg = e.data;
        console.log('[loadFFmpeg] Mensaje recibido del worker:', msg.type, msg);
        
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          console.log('[loadFFmpeg] ✓ FFmpeg.js cargado y listo');
          state.ffmpegLoaded = true;
          resolve();
        } else if (msg.type === 'stdout') {
          console.log('[FFmpeg stdout]', msg.data);
        } else if (msg.type === 'stderr') {
          console.log('[FFmpeg stderr]', msg.data);
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
  console.log('[updateUploadAreaLoading]', isLoading ? 'Cargando...' : 'Listo');
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
  console.log('[extractMetadata] Extrayendo metadata de:', file.name);
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
      console.log('[extractMetadata] Metadata extraída:', metadata);
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
  console.log('[convertVideo] Iniciando conversión de:', videoData.originalFile.name);
  
  // ============================================================
  // PASO 1: Recrear el worker para cada conversión
  // ============================================================
  // Esto evita el error "already running" que ocurre cuando un worker
  // anterior crashó o quedó en un estado inconsistente
  if (state.ffmpeg) {
    console.log('[convertVideo] Terminando worker anterior...');
    state.ffmpeg.terminate();
  }
  
  console.log('[convertVideo] Creando nuevo worker...');
  state.ffmpeg = new Worker(CONFIG.WORKER_PATH);
  
  // Esperar a que el worker esté listo
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout esperando worker')), CONFIG.WORKER_READY_TIMEOUT);
    state.ffmpeg.onmessage = (e) => {
      if (e.data.type === 'ready') {
        clearTimeout(timeout);
        console.log('[convertVideo] ✓ Worker listo');
        resolve();
      }
    };
    state.ffmpeg.onerror = (err) => {
      clearTimeout(timeout);
      reject(err);
    };
  });
  
  if (!state.ffmpeg || !state.ffmpegLoaded) {
    console.error('[convertVideo] FFmpeg no está cargado');
    showNotification('ffmpeg no está cargado', 'error');
    return;
  }

  const worker = state.ffmpeg;
  const inputName = `input.${videoData.originalFile.name.split('.').pop()}`;
  const outputName = 'output.webm';

  try {
    // Actualizar estado a "convirtiendo"
    updateVideoStatus(videoData.id, 'converting', 0);

    console.log('[convertVideo] Leyendo archivo de entrada...');
    // Leer archivo como ArrayBuffer
    const fileData = await videoData.originalFile.arrayBuffer();
    console.log('[convertVideo] Archivo leído, tamaño:', fileData.byteLength, 'bytes');

    console.log('[convertVideo] Preparando comando FFmpeg...');
    
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
      console.log(`[convertVideo] ⚠️  Video de alta resolución detectado (${videoData.metadata.width}x${videoData.metadata.height})`);
      console.log(`[convertVideo] 📐 Reduciendo a ${newWidth}x${newHeight} para evitar problemas de memoria`);
      showNotification(`video de alta resolución detectado. reduciendo a ${newWidth}x${newHeight} para optimizar`, 'info');
    }
    
    // ============================================================
    // PASO 2: Construir comando FFmpeg
    // ============================================================
    // Todos los parámetros vienen de CONFIG para fácil modificación
    const ffmpegArgs = [
      '-i', inputName,
      '-c:v', CONFIG.VIDEO_CODEC,
      '-crf', state.crf.toString(),
      '-b:v', CONFIG.VIDEO_BITRATE,
      '-c:a', CONFIG.AUDIO_CODEC,
      '-cpu-used', CONFIG.CPU_USED,
      '-deadline', CONFIG.DEADLINE,
      '-auto-alt-ref', CONFIG.AUTO_ALT_REF
    ];
    
    // Añadir filtro de escala si es necesario
    if (scaleFilter) {
      ffmpegArgs.push('-vf', scaleFilter);
    }
    
    ffmpegArgs.push(outputName);
    console.log('[convertVideo] Argumentos FFmpeg:', ffmpegArgs.join(' '));
    
    // Enviar comando a FFmpeg worker
    const result = await new Promise((resolve, reject) => {
      let lastProgress = 0;
      let hasStarted = false;

      worker.onmessage = (e) => {
        const msg = e.data;
        console.log('[convertVideo] Mensaje del worker:', msg.type);
        
        if (msg.type === 'run') {
          console.log('[convertVideo] ✓ FFmpeg ha iniciado el trabajo');
          hasStarted = true;
        } else if (msg.type === 'stdout') {
          console.log('[convertVideo stdout]', msg.data);
          
          // Parsear progreso de FFmpeg
          const progressMatch = msg.data.match(/time=(\d+):(\d+):(\d+)/);
          if (progressMatch && videoData.metadata.duration > 0) {
            const hours = parseInt(progressMatch[1]);
            const minutes = parseInt(progressMatch[2]);
            const seconds = parseInt(progressMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;
            const progress = Math.min(Math.round((currentTime / videoData.metadata.duration) * 100), 99);
            
            if (progress !== lastProgress) {
              lastProgress = progress;
              console.log('[convertVideo] Progreso:', progress + '%');
              updateVideoProgress(videoData.id, progress);
            }
          }
        } else if (msg.type === 'stderr') {
          console.log('[convertVideo stderr]', msg.data);
        } else if (msg.type === 'exit') {
          console.log('[convertVideo] FFmpeg terminó con código:', msg.data);
        } else if (msg.type === 'done') {
          console.log('[convertVideo] ✓ Trabajo completado, procesando resultado...');
          console.log('[convertVideo] Resultado recibido:', msg.data);
          resolve(msg.data);
        } else if (msg.type === 'error') {
          console.error('[convertVideo] ✗ Error del worker:', msg.data);
          reject(new Error(msg.data));
        }
      };

      console.log('[convertVideo] Enviando comando al worker...');
      worker.postMessage({
        type: 'run',
        arguments: ffmpegArgs,
        MEMFS: [{
          name: inputName,
          data: new Uint8Array(fileData)
        }]
      });
    });

    console.log('[convertVideo] Buscando archivo de salida en resultado...');
    console.log('[convertVideo] Archivos en MEMFS:', result.MEMFS ? result.MEMFS.map(f => f.name) : 'undefined');
    
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

    console.log('[convertVideo] ✓ Archivo de salida encontrado:', outputFile.name, 'tamaño:', outputFile.data.length, 'bytes');

    // Crear blob del resultado
    const blob = new Blob([outputFile.data], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    console.log('[convertVideo] ✓ Blob creado, URL:', url);

    // Actualizar estado a "completado"
    updateVideoCompleted(videoData.id, blob, url);

    console.log('[convertVideo] ✓ Video convertido exitosamente');
    showNotification(`video convertido: ${videoData.originalFile.name}`, 'success');
  } catch (error) {
    console.error('[convertVideo] ✗ Error convirtiendo video:', error);
    console.error('[convertVideo] Stack trace:', error.stack);
    updateVideoError(videoData.id, 'error al convertir el video');
    showNotification(`error al convertir: ${videoData.originalFile.name}`, 'error');
  }
}

// Manejar archivos seleccionados
async function handleFiles(files) {
  console.log('[handleFiles] Archivos recibidos:', files.length);
  
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
  console.log('[handleFiles] Archivos de video válidos:', videoFiles.length);

  if (videoFiles.length === 0) {
    console.warn('[handleFiles] No se encontraron archivos de video válidos');
    showNotification('por favor, selecciona archivos de video válidos', 'error');
    return;
  }

  // Crear objetos VideoData para cada archivo
  for (const file of videoFiles) {
    console.log('[handleFiles] Procesando archivo:', file.name, 'tipo:', file.type, 'tamaño:', file.size);
    const metadata = await extractMetadata(file);
    const videoData = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      originalFile: file,
      originalSize: file.size,
      webmBlob: null,
      webmSize: 0,
      webmUrl: null,
      status: 'pending',
      progress: 0,
      metadata
    };

    console.log('[handleFiles] VideoData creado:', videoData.id);
    state.videos.push(videoData);
    renderVideoCard(videoData);
  }

  updateVideosContainer();

  // Convertir videos uno por uno
  console.log('[handleFiles] Iniciando conversión de', videoFiles.length, 'videos...');
  for (const file of videoFiles) {
    const videoData = state.videos.find(v => v.originalFile === file);
    if (videoData) {
      console.log('[handleFiles] Convirtiendo:', videoData.id);
      await convertVideo(videoData);
    }
  }
  console.log('[handleFiles] ✓ Todas las conversiones completadas');
}

// Actualizar estado del video
function updateVideoStatus(id, status, progress = 0) {
  console.log('[updateVideoStatus]', id, 'estado:', status, 'progreso:', progress);
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
  console.log('[updateVideoCompleted]', id, 'tamaño blob:', blob.size);
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
  console.log('[updateVideoError]', id, 'error:', errorMessage);
  const video = state.videos.find(v => v.id === id);
  if (video) {
    video.status = 'error';
    video.errorMessage = errorMessage;
    updateVideoCard(id);
  }
}

// Renderizar tarjeta de video
function renderVideoCard(videoData) {
  console.log('[renderVideoCard]', videoData.id);
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
    </div>
    <div class="video-status">
      <div class="status-text">esperando...</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
    </div>
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

  switch (video.status) {
    case 'pending':
      statusText.textContent = 'esperando...';
      progressFill.style.width = '0%';
      downloadBtn.disabled = true;
      break;

    case 'converting':
      let statusMessage = `convirtiendo... ${video.progress}%`;
      if (video.scaledResolution) {
        statusMessage = `convirtiendo (${video.scaledResolution})... ${video.progress}%`;
      }
      statusText.textContent = statusMessage;
      progressFill.style.width = `${video.progress}%`;
      downloadBtn.disabled = true;
      break;

    case 'completed':
      const webmSizeMB = (video.webmSize / (1024 * 1024)).toFixed(2);
      const reduction = ((1 - video.webmSize / video.originalSize) * 100).toFixed(1);
      statusText.textContent = `completado - ${webmSizeMB} MB (-${reduction}%)`;
      statusText.style.color = '#10b981';
      progressFill.style.width = '100%';
      progressFill.style.backgroundColor = '#10b981';
      downloadBtn.disabled = false;
      downloadBtn.onclick = () => downloadVideo(id);
      break;

    case 'error':
      statusText.textContent = video.errorMessage || 'error al convertir';
      statusText.style.color = '#ef4444';
      progressFill.style.width = '0%';
      downloadBtn.disabled = true;
      break;
  }
}

// Actualizar contenedor de videos
function updateVideosContainer() {
  const totalVideos = state.videos.length;
  const completedVideos = state.videos.filter(v => v.status === 'completed').length;

  console.log('[updateVideosContainer] Total:', totalVideos, 'Completados:', completedVideos);
  videoCount.textContent = `${completedVideos} de ${totalVideos} videos convertidos`;
  
  if (totalVideos > 0) {
    videosContainer.classList.add('visible');
  }

  downloadAllBtn.disabled = completedVideos === 0;
}

// Descargar video individual
function downloadVideo(id) {
  console.log('[downloadVideo]', id);
  const video = state.videos.find(v => v.id === id);
  if (!video || !video.webmUrl) {
    console.error('[downloadVideo] Video no encontrado o sin URL');
    return;
  }

  const link = document.createElement('a');
  link.href = video.webmUrl;
  link.download = video.originalFile.name.replace(/\.[^/.]+$/, '') + '.webm';
  link.click();
  console.log('[downloadVideo] Descarga iniciada:', link.download);
}

// Eliminar video
function removeVideo(id) {
  console.log('[removeVideo]', id);
  const index = state.videos.findIndex(v => v.id === id);
  if (index === -1) {
    console.error('[removeVideo] Video no encontrado');
    return;
  }

  const video = state.videos[index];
  
  // Revocar URL si existe
  if (video.webmUrl) {
    URL.revokeObjectURL(video.webmUrl);
    console.log('[removeVideo] URL revocada');
  }

  // Eliminar del estado
  state.videos.splice(index, 1);

  // Eliminar del DOM
  const card = document.getElementById(`video-${id}`);
  if (card) {
    card.remove();
  }

  // Actualizar contenedor
  updateVideosContainer();

  // Ocultar contenedor si no hay videos
  if (state.videos.length === 0) {
    videosContainer.classList.remove('visible');
  }
}

/**
 * Descarga todos los videos completados en un archivo ZIP
 * Usa JSZip cargado desde CDN para crear el archivo ZIP en memoria
 */
async function downloadAll() {
  console.log('[downloadAll] Iniciando descarga de todos los videos en ZIP');
  const completedVideos = state.videos.filter(v => v.status === 'completed');
  
  if (completedVideos.length === 0) {
    console.warn('[downloadAll] No hay videos completados');
    showNotification('no hay videos completados para descargar', 'error');
    return;
  }

  try {
    // Cargar JSZip si no está disponible
    if (typeof JSZip === 'undefined') {
      console.log('[downloadAll] Cargando JSZip desde CDN...');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      console.log('[downloadAll] ✓ JSZip cargado');
    }

    showNotification('creando archivo zip...', 'info');
    
    // Crear instancia de JSZip
    const zip = new JSZip();
    
    // Añadir cada video al ZIP
    for (const video of completedVideos) {
      const filename = video.originalFile.name.replace(/\.[^/.]+$/, '') + '.webm';
      console.log(`[downloadAll] Añadiendo al ZIP: ${filename}`);
      zip.file(filename, video.webmBlob);
    }
    
    // Generar el archivo ZIP
    console.log('[downloadAll] Generando archivo ZIP...');
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
    
    console.log('[downloadAll] ✓ ZIP descargado exitosamente');
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

// Mostrar notificación
function showNotification(message, type = 'info') {
  console.log('[showNotification]', type, message);
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

// Actualizar descripción del CRF
function updateCRFDescription() {
  const crf = parseInt(crfSlider.value);
  crfValue.textContent = crf;
  state.crf = crf;

  let description = '';
  if (crf <= 20) {
    description = 'calidad muy alta - archivos grandes';
  } else if (crf <= 28) {
    description = 'calidad alta - buen balance';
  } else if (crf <= 35) {
    description = 'calidad media - archivos pequeños';
  } else {
    description = 'calidad baja - archivos muy pequeños';
  }

  crfDescription.textContent = description;
  console.log('[updateCRFDescription] CRF:', crf, '-', description);
}

// Event Listeners
uploadArea.addEventListener('click', () => {
  console.log('[Event] Click en uploadArea');
  fileInput.click();
});

selectBtn.addEventListener('click', () => {
  console.log('[Event] Click en selectBtn');
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
  console.log('[Event] Drop - archivos:', e.dataTransfer.files.length);
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
  console.log('[Event] Change en fileInput - archivos:', e.target.files.length);
  handleFiles(e.target.files);
  e.target.value = ''; // Reset input
});

downloadAllBtn.addEventListener('click', () => {
  console.log('[Event] Click en downloadAllBtn');
  downloadAll();
});

crfSlider.addEventListener('input', updateCRFDescription);

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
  console.log('='.repeat(60));
  console.log('[INIT] DOM cargado, inicializando aplicación...');
  console.log('[INIT] Navegador:', navigator.userAgent);
  console.log('[INIT] Soporte Worker:', typeof Worker !== 'undefined');
  console.log('='.repeat(60));
  updateCRFDescription();
  loadFFmpeg();
});
