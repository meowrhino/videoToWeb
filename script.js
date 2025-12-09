// Estado global
const state = {
  videos: [],
  crf: 31,
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

// Utilidad para convertir archivos a Uint8Array
async function fetchFile(file) {
  if (file instanceof Uint8Array) return file;
  if (file instanceof Blob) return new Uint8Array(await file.arrayBuffer());
  throw new Error('fetchFile: tipo de entrada no soportado');
}

// Inicializar FFmpeg (versión 0.11.6 compatible con GitHub Pages)
async function loadFFmpeg() {
  if (state.ffmpegLoaded || state.isLoadingFFmpeg) return;

  state.isLoadingFFmpeg = true;
  updateUploadAreaLoading(true);

  try {
    console.log('Cargando FFmpeg 0.11.6...');
    
    // Cargar el script de FFmpeg 0.11.6
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js';
    
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error('Error cargando FFmpeg script'));
      document.head.appendChild(script);
    });

    console.log('Script cargado, creando instancia...');
    
    // Crear instancia de FFmpeg
    const { createFFmpeg, fetchFile: ffmpegFetchFile } = FFmpeg;
    
    const ffmpeg = createFFmpeg({
      log: true,
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js'
    });

    console.log('Cargando core de FFmpeg...');
    await ffmpeg.load();

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
    // Escribir archivo de entrada usando la API 0.11.6
    ffmpeg.FS('writeFile', inputName, await fetchFile(videoData.originalFile));

    // Configurar progreso
    ffmpeg.setProgress(({ ratio }) => {
      const currentProgress = Math.round(ratio * 100);
      updateVideoProgress(videoData.id, currentProgress);
    });

    console.log('Ejecutando conversión...');
    // Ejecutar conversión con parámetros optimizados para VP9
    await ffmpeg.run(
      '-i', inputName,
      '-c:v', 'libvpx-vp9',
      '-crf', state.crf.toString(),
      '-b:v', '0',
      '-c:a', 'libopus',
      '-cpu-used', '5',
      '-deadline', 'realtime',
      outputName
    );

    console.log('Leyendo archivo de salida...');
    // Leer archivo de salida
    const data = ffmpeg.FS('readFile', outputName);
    const blob = new Blob([data.buffer], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);

    // Actualizar estado a "completado"
    updateVideoCompleted(videoData.id, blob, url);

    // Limpiar archivos temporales
    try {
      ffmpeg.FS('unlink', inputName);
      ffmpeg.FS('unlink', outputName);
    } catch (e) {
      console.warn('Error limpiando archivos temporales:', e);
    }

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

// Actualizar estado del video
function updateVideoStatus(id, status, progress = 0) {
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
  const video = state.videos.find(v => v.id === id);
  if (video) {
    video.status = 'error';
    video.errorMessage = errorMessage;
    updateVideoCard(id);
  }
}

// Renderizar tarjeta de video
function renderVideoCard(videoData) {
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
      statusText.textContent = `convirtiendo... ${video.progress}%`;
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

  videoCount.textContent = `${completedVideos} de ${totalVideos} videos convertidos`;
  
  if (totalVideos > 0) {
    videosContainer.classList.add('visible');
  }

  downloadAllBtn.disabled = completedVideos === 0;
}

// Descargar video individual
function downloadVideo(id) {
  const video = state.videos.find(v => v.id === id);
  if (!video || !video.webmUrl) return;

  const link = document.createElement('a');
  link.href = video.webmUrl;
  link.download = video.originalFile.name.replace(/\.[^/.]+$/, '') + '.webm';
  link.click();
}

// Eliminar video
function removeVideo(id) {
  const index = state.videos.findIndex(v => v.id === id);
  if (index === -1) return;

  const video = state.videos[index];
  
  // Revocar URL si existe
  if (video.webmUrl) {
    URL.revokeObjectURL(video.webmUrl);
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

// Descargar todos los videos
async function downloadAll() {
  const completedVideos = state.videos.filter(v => v.status === 'completed');
  
  if (completedVideos.length === 0) {
    showNotification('no hay videos completados para descargar', 'error');
    return;
  }

  for (const video of completedVideos) {
    downloadVideo(video.id);
    // Pequeña pausa entre descargas
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  showNotification(`descargando ${completedVideos.length} videos`, 'success');
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
}

// Event Listeners
uploadArea.addEventListener('click', () => fileInput.click());
selectBtn.addEventListener('click', () => fileInput.click());

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
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  e.target.value = ''; // Reset input
});

downloadAllBtn.addEventListener('click', downloadAll);

crfSlider.addEventListener('input', updateCRFDescription);

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM cargado, inicializando...');
  updateCRFDescription();
  loadFFmpeg();
});
