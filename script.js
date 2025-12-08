// Estado global
const state = {
  videos: [],
  crf: 31,
  ffmpeg: null,
  ffmpegLoaded: false,
  isLoadingFFmpeg: false
};

// Versiones y CDNs
const FF_VERSIONS = {
  ffmpeg: '0.12.10',
  core: '0.12.10'
};

const CORE_CDN_BASES = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FF_VERSIONS.core}/dist`,
  `https://unpkg.com/@ffmpeg/core@${FF_VERSIONS.core}/dist`
];

const SCRIPT_CDN_BASES = [
  'https://cdn.jsdelivr.net/npm',
  'https://unpkg.com'
];

// Utilidades locales para evitar depender de @ffmpeg/util (problemas de CDN/mime)
const localFFmpegUtils = {
  async fetchFile(source) {
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
    if (typeof source === 'string') {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`fetchFile: fallo al descargar ${source} (${response.status})`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }
    throw new Error('fetchFile: tipo de entrada no soportado');
  },

  async toBlobURL(url, mimeType) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`toBlobURL: fallo al descargar ${url} (${response.status})`);
    }
    const blob = new Blob([await response.arrayBuffer()], { type: mimeType });
    return URL.createObjectURL(blob);
  }
};

// Cargar script con fallback de CDN
function loadScriptWithFallback(label, buildURL) {
  return new Promise((resolve, reject) => {
    let index = 0;
    let lastError = null;

    const tryNext = () => {
      if (index >= SCRIPT_CDN_BASES.length) {
        reject(new Error(`${label}: no se pudo cargar (${lastError?.message || 'sin detalles'})`));
        return;
      }

      const url = buildURL(SCRIPT_CDN_BASES[index]);
      index += 1;

      const script = document.createElement('script');
      script.src = url;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve(url);
      script.onerror = (e) => {
        lastError = new Error(`error cargando ${url}`);
        console.warn(`${label}: fallo ${url}`, e);
        tryNext();
      };

      document.head.appendChild(script);
    };

    tryNext();
  });
}

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

// Cargar FFmpeg desde CDN
async function loadFFmpegScript() {
  return loadScriptWithFallback(
    'ffmpeg.js',
    (base) => `${base}/@ffmpeg/ffmpeg@${FF_VERSIONS.ffmpeg}/dist/umd/ffmpeg.js`
  );
}

// Resolver URLs de core con fallback de CDN para evitar CORS/404
async function resolveCoreURLs() {
  const errors = [];

  for (const baseURL of CORE_CDN_BASES) {
    try {
      const coreURL = await localFFmpegUtils.toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await localFFmpegUtils.toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
      const workerURL = await localFFmpegUtils.toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript');
      return { coreURL, wasmURL, workerURL, baseURL };
    } catch (error) {
      console.warn(`Fallo cargando core desde ${baseURL}`, error);
      errors.push({ baseURL, error });
    }
  }

  throw new Error(`no se pudo descargar ffmpeg-core (${errors.map(e => e.baseURL).join(', ')})`);
}

// Inicializar FFmpeg
async function loadFFmpeg() {
  if (state.ffmpegLoaded || state.isLoadingFFmpeg) return;

  state.isLoadingFFmpeg = true;
  updateUploadAreaLoading(true);

  try {
    // Cargar scripts de FFmpeg
    console.log('Cargando scripts de FFmpeg...');
    await loadFFmpegScript();
    
    console.log('Scripts cargados, inicializando FFmpeg...');
    
    // Crear instancia de FFmpeg
    const { FFmpeg } = FFmpegWASM;
    
    const ffmpeg = new FFmpeg();
    
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    console.log('Cargando core de FFmpeg...');
    const { coreURL, wasmURL, workerURL, baseURL } = await resolveCoreURLs();
    console.log(`Core localizado en ${baseURL}`);

    await ffmpeg.load({
      coreURL,
      wasmURL,
      workerURL
    });

    state.ffmpeg = ffmpeg;
    state.ffmpegLoaded = true;
    console.log('FFmpeg cargado correctamente');
    showNotification('ffmpeg cargado correctamente', 'success');
  } catch (error) {
    console.error('Error cargando FFmpeg:', error);
    showNotification('error al cargar ffmpeg. por favor, recarga la página.', 'error');
  } finally {
    state.isLoadingFFmpeg = false;
    updateUploadAreaLoading(false);
  }
}

// Actualizar área de carga cuando FFmpeg está cargando
function updateUploadAreaLoading(isLoading) {
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
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        codec: file.type
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
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

// Convertir video a WebM
async function convertVideo(videoData) {
  if (!state.ffmpeg) {
    showNotification('ffmpeg no está cargado', 'error');
    return;
  }

  const ffmpeg = state.ffmpeg;
  const inputName = `input_${videoData.id}.${videoData.originalFile.name.split('.').pop()}`;
  const outputName = `output_${videoData.id}.webm`;

  try {
    // Actualizar estado a "convirtiendo"
    updateVideoStatus(videoData.id, 'converting', 0);

    console.log('Escribiendo archivo de entrada...');
    // Escribir archivo de entrada
    await ffmpeg.writeFile(inputName, await localFFmpegUtils.fetchFile(videoData.originalFile));

    // Configurar progreso
    let lastProgress = 0;
    ffmpeg.on('progress', ({ progress }) => {
      const currentProgress = Math.round(progress * 100);
      if (currentProgress !== lastProgress) {
        lastProgress = currentProgress;
        updateVideoProgress(videoData.id, currentProgress);
      }
    });

    console.log('Ejecutando conversión...');
    // Ejecutar conversión con parámetros optimizados
    await ffmpeg.exec([
      '-i', inputName,
      '-c:v', 'libvpx-vp9',
      '-crf', state.crf.toString(),
      '-b:v', '0',
      '-c:a', 'libopus',
      '-row-mt', '1',
      '-threads', '4',
      outputName
    ]);

    console.log('Leyendo archivo de salida...');
    // Leer archivo de salida
    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);

    // Actualizar estado a "completado"
    updateVideoCompleted(videoData.id, blob, url);

    // Limpiar archivos temporales
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    console.log('Conversión completada');
    showNotification(`video convertido: ${videoData.originalFile.name}`, 'success');
  } catch (error) {
    console.error('Error convirtiendo video:', error);
    updateVideoError(videoData.id, 'error al convertir el video');
    showNotification(`error al convertir: ${videoData.originalFile.name}`, 'error');
  }
}

// Manejar archivos seleccionados
async function handleFiles(files) {
  console.log('Archivos recibidos:', files.length);
  
  if (!files || files.length === 0) return;
  
  if (!state.ffmpegLoaded) {
    showNotification('ffmpeg aún se está cargando. por favor, espera un momento.', 'error');
    return;
  }

  const videoFiles = Array.from(files).filter(file => file.type.startsWith('video/'));
  console.log('Archivos de video válidos:', videoFiles.length);

  if (videoFiles.length === 0) {
    showNotification('por favor, selecciona archivos de video válidos', 'error');
    return;
  }

  // Crear objetos VideoData para cada archivo
  for (const file of videoFiles) {
    console.log('Procesando archivo:', file.name);
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

    state.videos.push(videoData);
    renderVideoCard(videoData);
  }

  updateVideosContainer();

  // Convertir videos uno por uno
  for (const file of videoFiles) {
    const videoData = state.videos.find(v => v.originalFile === file);
    if (videoData) {
      await convertVideo(videoData);
    }
  }
}

// Renderizar tarjeta de video
function renderVideoCard(videoData) {
  const card = document.createElement('div');
  card.className = 'video-card';
  card.id = `video-${videoData.id}`;

  const fileName = videoData.originalFile.name.replace(/\.[^/.]+$/, '.webm');
  const metadata = videoData.metadata;

  card.innerHTML = `
    <div class="video-preview">
      <div class="video-preview-placeholder">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="23 7 16 12 23 17 23 7"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      </div>
      <button class="btn-remove video-remove-btn" onclick="removeVideo('${videoData.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="video-info">
      <div class="video-name" title="${fileName}">${fileName}</div>
      ${metadata.width > 0 ? `
        <div class="video-metadata">
          ${metadata.width}×${metadata.height} • ${formatDuration(metadata.duration)}
        </div>
      ` : ''}
      <div class="video-content"></div>
    </div>
  `;

  videosList.appendChild(card);
}

// Actualizar estado del video
function updateVideoStatus(id, status, progress = 0) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  video.status = status;
  video.progress = progress;

  const card = document.getElementById(`video-${id}`);
  if (!card) return;

  const content = card.querySelector('.video-content');
  
  if (status === 'converting') {
    content.innerHTML = `
      <div class="progress-container">
        <div class="progress-header">
          <span>convirtiendo...</span>
          <span>${progress}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill animated" style="width: ${progress}%"></div>
        </div>
      </div>
    `;
  }
}

// Actualizar progreso del video
function updateVideoProgress(id, progress) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  video.progress = progress;

  const card = document.getElementById(`video-${id}`);
  if (!card) return;

  const progressText = card.querySelector('.progress-header span:last-child');
  const progressFill = card.querySelector('.progress-fill');

  if (progressText) progressText.textContent = `${progress}%`;
  if (progressFill) progressFill.style.width = `${progress}%`;
}

// Actualizar video completado
function updateVideoCompleted(id, blob, url) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  video.status = 'completed';
  video.progress = 100;
  video.webmBlob = blob;
  video.webmSize = blob.size;
  video.webmUrl = url;

  const card = document.getElementById(`video-${id}`);
  if (!card) return;

  // Actualizar preview
  const preview = card.querySelector('.video-preview-placeholder');
  if (preview) {
    preview.outerHTML = `<video src="${url}" controls></video>`;
  }

  // Actualizar contenido
  const content = card.querySelector('.video-content');
  const savings = calculateSavings(video.originalSize, video.webmSize);

  content.innerHTML = `
    <div class="video-stats">
      <div class="stat-row">
        <span class="stat-label">original:</span>
        <span class="stat-value">${formatSize(video.originalSize)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">webm:</span>
        <span class="stat-value">
          ${formatSize(video.webmSize)}
          <span class="badge-success">-${savings}%</span>
        </span>
      </div>
    </div>
    <button class="btn-download" onclick="downloadVideo('${id}')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline; vertical-align: middle; margin-right: 0.5rem;">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      descargar
    </button>
  `;

  updateVideosContainer();
}

// Actualizar video con error
function updateVideoError(id, errorMessage) {
  const video = state.videos.find(v => v.id === id);
  if (!video) return;

  video.status = 'error';
  video.error = errorMessage;

  const card = document.getElementById(`video-${id}`);
  if (!card) return;

  const content = card.querySelector('.video-content');
  content.innerHTML = `<div class="error-message">${errorMessage}</div>`;
}

// Actualizar contenedor de videos
function updateVideosContainer() {
  const completedCount = state.videos.filter(v => v.status === 'completed').length;
  const convertingCount = state.videos.filter(v => v.status === 'converting').length;

  if (state.videos.length === 0) {
    videosContainer.style.display = 'none';
    return;
  }

  videosContainer.style.display = 'block';

  if (completedCount > 0) {
    videoCount.textContent = `${completedCount} vídeo${completedCount !== 1 ? 's' : ''} convertido${completedCount !== 1 ? 's' : ''}`;
    downloadAllBtn.disabled = false;
  } else if (convertingCount > 0) {
    videoCount.textContent = `convirtiendo ${convertingCount} vídeo${convertingCount !== 1 ? 's' : ''}...`;
    downloadAllBtn.disabled = true;
  } else {
    videoCount.textContent = 'videos en cola';
    downloadAllBtn.disabled = true;
  }
}

// Descargar video individual
window.downloadVideo = function(id) {
  const video = state.videos.find(v => v.id === id);
  if (!video || !video.webmBlob || !video.webmUrl) return;

  const a = document.createElement('a');
  a.href = video.webmUrl;
  a.download = video.originalFile.name.replace(/\.[^/.]+$/, '.webm');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// Eliminar video
window.removeVideo = function(id) {
  const video = state.videos.find(v => v.id === id);
  if (video?.webmUrl) {
    URL.revokeObjectURL(video.webmUrl);
  }

  state.videos = state.videos.filter(v => v.id !== id);

  const card = document.getElementById(`video-${id}`);
  if (card) {
    card.remove();
  }

  updateVideosContainer();
};

// Descargar todos los videos en ZIP
async function downloadAllAsZip() {
  const completedVideos = state.videos.filter(v => v.status === 'completed');
  
  if (completedVideos.length === 0) {
    showNotification('no hay videos convertidos para descargar', 'error');
    return;
  }

  try {
    const zip = new JSZip();
    
    completedVideos.forEach(video => {
      if (video.webmBlob) {
        const filename = video.originalFile.name.replace(/\.[^/.]+$/, '.webm');
        zip.file(filename, video.webmBlob);
      }
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'videos-webm.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('descarga iniciada', 'success');
  } catch (error) {
    console.error('Error creando ZIP:', error);
    showNotification('error al crear el archivo zip', 'error');
  }
}

// Actualizar descripción de CRF
function updateCrfDescription(value) {
  let description = '';
  
  if (value <= 20) {
    description = 'calidad máxima (archivos grandes)';
  } else if (value <= 25) {
    description = 'calidad muy alta';
  } else if (value <= 30) {
    description = 'calidad alta (recomendado)';
  } else if (value <= 35) {
    description = 'calidad media';
  } else {
    description = 'calidad baja (archivos pequeños)';
  }

  crfDescription.textContent = description;
}

// Formatear tamaño
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Formatear duración
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Calcular ahorro
function calculateSavings(original, converted) {
  if (original === 0) return '0.0';
  const savings = ((original - converted) / original) * 100;
  return savings.toFixed(1);
}

// Mostrar notificación
function showNotification(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  // Aquí podrías implementar un sistema de notificaciones toast si lo deseas
}

// Event Listeners
uploadArea.addEventListener('click', () => {
  console.log('Click en área de carga');
  fileInput.click();
});

selectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  console.log('Click en botón seleccionar');
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  console.log('Cambio en input de archivo');
  handleFiles(e.target.files);
});

// Drag & Drop
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  window.addEventListener(eventName, (e) => e.preventDefault(), true);
});

uploadArea.addEventListener('dragover', () => {
  uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('drag-over');
});

uploadArea.addEventListener('drop', (e) => {
  console.log('Drop de archivos');
  uploadArea.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

// CRF Slider
crfSlider.addEventListener('input', (e) => {
  const value = parseInt(e.target.value);
  state.crf = value;
  crfValue.textContent = value;
  updateCrfDescription(value);
});

// Download All Button
downloadAllBtn.addEventListener('click', downloadAllAsZip);

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM cargado, inicializando...');
    loadFFmpeg();
    updateCrfDescription(state.crf);
  });
} else {
  console.log('DOM ya cargado, inicializando...');
  loadFFmpeg();
  updateCrfDescription(state.crf);
}
