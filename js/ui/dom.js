// Referencias a los elementos fijos del DOM (los módulos se ejecutan tras parsear el HTML)
export const dom = {
  uploadArea: document.getElementById('uploadArea'),
  uploadTitle: document.getElementById('uploadTitle'),
  uploadSubtitle: document.getElementById('uploadSubtitle'),
  fileInput: document.getElementById('fileInput'),
  selectBtn: document.getElementById('selectBtn'),
  qualityButtons: document.querySelectorAll('.quality-btn'),
  videosContainer: document.getElementById('videosContainer'),
  videosList: document.getElementById('videosList'),
  videoCount: document.getElementById('videoCount'),
  downloadAllBtn: document.getElementById('downloadAllBtn'),
  debugTriple: document.getElementById('debugTriple'),
  debugTripleBtn: document.getElementById('debugTripleBtn'),
  debugTripleInput: document.getElementById('debugTripleInput')
};

const UPLOAD_TEXT = {
  idle: {
    title: 'arrastra vídeos aquí o haz clic para seleccionar',
    subtitle: 'soporta mp4, mov, avi, mkv, flv y más formatos'
  },
  loading: {
    title: 'cargando ffmpeg...',
    subtitle: 'descargando (~31MB), puede tardar unos segundos'
  }
};

export function setUploadAreaLoading(isLoading) {
  const text = isLoading ? UPLOAD_TEXT.loading : UPLOAD_TEXT.idle;
  dom.uploadArea.classList.toggle('loading', isLoading);
  dom.uploadArea.setAttribute('aria-busy', String(isLoading));
  dom.uploadTitle.textContent = text.title;
  dom.uploadSubtitle.textContent = text.subtitle;
  dom.selectBtn.disabled = isLoading;
}
