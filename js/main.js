// Punto de entrada: conecta los eventos del DOM con la lógica de la app.
import { CONFIG, PRESETS, getPreset } from './config.js';
import { state, createVideoData } from './state.js';
import { debugLog, isVideoFile } from './utils.js';
import { loadFFmpeg } from './ffmpeg-loader.js';
import { extractMetadata } from './metadata.js';
import { addFiles, enqueueVideos, removeVideo, syncOrderFromDom } from './queue.js';
import { downloadAll, downloadVideo } from './downloads.js';
import { dom } from './ui/dom.js';
import { showNotification } from './ui/notifications.js';

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
  button.addEventListener('click', () => selectMode(button));
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

dom.uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  dom.uploadArea.classList.remove('dragover');
  addFiles(e.dataTransfer.files);
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
    filter: 'button, .video-logs',
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

loadFFmpeg();
