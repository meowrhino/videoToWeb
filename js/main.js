// Punto de entrada: conecta los eventos del DOM con la lógica de la app.
import { CONFIG, PRESETS, getPreset, settingsFor } from './config.js';
import { state, createVideoData, saveOptions } from './state.js';
import { debugLog, isVideoFile } from './utils.js';
import { loadFFmpeg } from './ffmpeg-loader.js';
import { extractMetadata } from './metadata.js';
import { addFiles, enqueueVideos, removeVideo, retryVideo, syncOrderFromDom } from './queue.js';
import { downloadAll, downloadVideo } from './downloads.js';
import { dom } from './ui/dom.js';
import { updateVideoCard, updateVideosContainer } from './ui/cards.js';
import { showNotification } from './ui/notifications.js';

// La calidad, el fotograma y "sin audio" valen para los vídeos que siguen
// esperando; los que ya se convierten o están convertidos no cambian.
function applyToWaiting() {
  for (const video of state.videos) {
    if (video.status !== 'pending') continue;
    video.presetId = state.mode;
    video.crf = settingsFor(state.mode, video.originalFile).crf;
    video.poster = state.options.poster;
    video.mute = state.options.mute;
    updateVideoCard(video);
  }
  updateVideosContainer();
  if (state.videos.some(v => v.status === 'converting' || v.status === 'completed')) {
    showNotification('vale para los vídeos que esperan; los ya convertidos no cambian', 'info');
  }
}

// ---------- Selección de calidad ----------
function selectMode(button) {
  const mode = (button.dataset.mode || '').toLowerCase();
  state.mode = getPreset(mode).id;
  dom.qualityButtons.forEach(btn => {
    const active = btn === button;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  debugLog('[selectMode] Modo:', state.mode, '| CRF:', PRESETS[state.mode].crf);
}

dom.qualityButtons.forEach(button => {
  button.addEventListener('click', () => {
    selectMode(button);
    applyToWaiting();
  });
});

// ---------- Opciones: fotograma, sin audio, numerar, empezar en ----------
dom.optionInputs.forEach(input => {
  const option = input.dataset.option;
  if (input.type === 'number') input.value = state.options[option];
  else input.checked = Boolean(state.options[option]);
  input.addEventListener('change', () => {
    if (input.type === 'number') {
      state.options[option] = Math.max(1, parseInt(input.value, 10) || 1);
      input.value = state.options[option];
    } else {
      state.options[option] = input.checked;
    }
    saveOptions();
    if (option === 'number' || option === 'start') updateVideosContainer(); // solo cambian los nombres
    else applyToWaiting();
  });
});

// ---------- Entrada de archivos: clic, drag & drop, pegar ----------
dom.uploadArea.addEventListener('click', () => dom.fileInput.click());

dom.selectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  dom.fileInput.click();
});

dom.fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});

dom.uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  dom.uploadArea.classList.add('dragover');
});

dom.uploadArea.addEventListener('dragleave', () => {
  dom.uploadArea.classList.remove('dragover');
});

dom.uploadArea.addEventListener('drop', () => {
  dom.uploadArea.classList.remove('dragover');
});

// Soltar un archivo en cualquier parte de la página: si no, el navegador lo abre
// en la pestaña y se pierde todo. Solo archivos: arrastrar tarjetas no cuenta.
const isFileDrag = e => Array.from(e.dataTransfer?.types || []).includes('Files');
document.addEventListener('dragover', (e) => {
  if (isFileDrag(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});

// Avisa antes de cerrar o recargar si se perdería algo
window.addEventListener('beforeunload', (e) => {
  const busy = state.videos.some(v => v.status === 'pending' || v.status === 'converting'
    || (v.status === 'completed' && !v.downloaded));
  if (busy) e.preventDefault();
});

document.addEventListener('paste', async (e) => {
  const files = Array.from(e.clipboardData?.files || []).filter(isVideoFile);
  if (files.length === 0) return;
  e.preventDefault();
  const added = await addFiles(files);
  if (added > 0) {
    showNotification(`${added} ${added === 1 ? 'vídeo pegado' : 'vídeos pegados'} desde el portapapeles`, 'info');
  }
});

// ---------- Acciones de las tarjetas (delegación) ----------
dom.videosList.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const id = button.closest('.video-card')?.dataset.videoId;
  if (!id) return;

  if (button.dataset.action === 'download') downloadVideo(id);
  if (button.dataset.action === 'retry') retryVideo(id);
  if (button.dataset.action === 'remove') removeVideo(id);
});

dom.downloadAllBtn.addEventListener('click', downloadAll);

// ---------- Reordenar tarjetas (desktop + touch via SortableJS) ----------
// El orden de state.videos determina el orden del ZIP final.
if (typeof window.Sortable !== 'undefined') {
  window.Sortable.create(dom.videosList, {
    animation: 150,
    // En táctil hay que mantener pulsado un momento: así el scroll sigue funcionando
    delay: 200,
    delayOnTouchOnly: true,
    // Botones y logs no inician el arrastre (se pueden pulsar y seleccionar texto)
    filter: 'button, .video-logs, .video-poster',
    preventOnFilter: false,
    ghostClass: 'card-ghost',
    chosenClass: 'card-chosen',
    dragClass: 'card-dragging',
    onEnd: () => syncOrderFromDom(dom.videosList)
  });
}

// ---------- DEBUG: convertir un video en las 3 calidades ----------
// Se muestra solo con CONFIG.DEBUG_LOGS. Pasa por la cola normal, en secuencia.
if (CONFIG.DEBUG_LOGS && dom.debugTriple) {
  dom.debugTriple.hidden = false;
  dom.debugTripleBtn.addEventListener('click', () => dom.debugTripleInput.click());
  dom.debugTripleInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !isVideoFile(file)) {
      showNotification('selecciona un archivo de video válido', 'error');
      return;
    }
    const metadata = await extractMetadata(file);
    enqueueVideos(['high', 'medium', 'low'].map(presetId => createVideoData(file, metadata, presetId)));
  });
}

// ---------- Inicialización ----------
debugLog('[INIT] SharedArrayBuffer:', typeof SharedArrayBuffer !== 'undefined' ? 'disponible' : 'NO disponible');
debugLog('[INIT] crossOriginIsolated:', self.crossOriginIsolated);

const activeButton = document.querySelector('.quality-btn.active') || dom.qualityButtons[0];
if (activeButton) selectMode(activeButton);

// En la primera visita coi-serviceworker recarga la página para tener
// SharedArrayBuffer: se le da tiempo antes de cargar ffmpeg, para no enseñar un
// error justo antes de la recarga. Si no recarga (no deja registrar el service
// worker), loadFFmpeg dice que se abra en una ventana normal.
const coiWillReload = typeof SharedArrayBuffer === 'undefined' && window.isSecureContext
  && navigator.serviceWorker && !navigator.serviceWorker.controller;
setTimeout(loadFFmpeg, coiWillReload ? 4000 : 0);
