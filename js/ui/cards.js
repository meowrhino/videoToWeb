import { getPreset } from '../config.js';
import { state } from '../state.js';
import { outputNames, posterName } from '../downloads.js';
import { escapeHtml, formatDuration, formatEta, formatMB, formatReduction } from '../utils.js';
import { dom } from './dom.js';

const MAX_LOG_LINES = 10;
const MAX_LOG_LENGTH = 180;

const REMOVE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

const DOWNLOAD_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M8 11L4 7h2.5V3h3v4H12L8 11z" fill="currentColor"/>
  <path d="M13 13H3v-2H2v2a1 1 0 001 1h10a1 1 0 001-1v-2h-1v2z" fill="currentColor"/>
</svg>`;

function getCard(id) {
  return document.getElementById(`video-${id}`);
}

// Las acciones (descargar / reintentar / eliminar / cancelar) se gestionan por delegación en main.js
// leyendo data-action, así la tarjeta no necesita reasignar handlers en cada cambio.
export function renderVideoCard(video) {
  const card = document.createElement('div');
  card.className = 'video-card';
  card.id = `video-${video.id}`;
  card.dataset.videoId = video.id;

  const { width, height, duration } = video.metadata;
  const resolution = width > 0 ? `${width}x${height}` : null;

  card.innerHTML = `
    <div class="video-info">
      <div class="video-name">${escapeHtml(video.originalFile.name)}</div>
      <div class="video-meta">
        <span>${formatMB(video.originalSize)}</span>
        <span>•</span>
        <span>${duration > 0 ? formatDuration(duration) : 'desconocida'}</span>
        ${resolution ? `<span>•</span><span>${resolution}</span>` : ''}
      </div>
      <div class="video-badges">
        <span class="badge badge-preset">${getPreset(video.presetId).label}</span>
        <span class="badge badge-crf">crf ${video.crf}</span>
        <span class="badge badge-mute"${video.mute ? '' : ' hidden'}>sin audio</span>
        <span class="badge badge-res"${resolution ? '' : ' hidden'}>${resolution ?? ''}</span>
      </div>
      <div class="video-out"></div>
    </div>
    <a class="video-poster" hidden title="el fotograma: clic para bajarlo solo"><img alt="fotograma"></a>
    <div class="video-status">
      <div class="status-text" aria-live="polite">esperando...</div>
      <div class="progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
    </div>
    <div class="video-logs"></div>
    <div class="video-actions">
      <button class="btn-download" data-action="download" disabled>
        ${DOWNLOAD_SVG}
        descargar
      </button>
      <button class="btn-retry" data-action="retry" hidden>reintentar</button>
      <button class="btn-remove" data-action="remove" title="eliminar" aria-label="eliminar">
        ${REMOVE_SVG}
      </button>
    </div>
  `;

  dom.videosList.appendChild(card);
  renderLogs(video);
}

function setRemoveButton(button, mode) {
  if (button.dataset.mode === mode) return;
  button.dataset.mode = mode;
  if (mode === 'cancel') {
    button.textContent = 'cancelar';
    button.title = 'cancelar conversión';
    button.setAttribute('aria-label', 'cancelar conversión');
  } else {
    button.innerHTML = REMOVE_SVG;
    button.title = 'eliminar';
    button.setAttribute('aria-label', 'eliminar');
  }
}

function getStatusView(video) {
  switch (video.status) {
    case 'pending':
      return { text: 'esperando...', progress: 0 };

    case 'converting': {
      // sacar el fotograma es un momento y el webm ya está: no se ofrece cancelar
      if (video.extractingPoster) return { text: 'sacando fotograma...', progress: 99, busy: true };
      let text = video.scaledResolution
        ? `convirtiendo (${video.scaledResolution})... ${video.progress}%`
        : `convirtiendo... ${video.progress}%`;
      const extras = [];
      if (video.currentFrame != null) extras.push(`frame ${video.currentFrame}`);
      if (video.currentSizeKB != null) extras.push(formatMB(video.currentSizeKB * 1024));
      // ETA basada en tiempo transcurrido y progreso
      if (video.progress > 5 && video.conversionStartTime) {
        const elapsed = (Date.now() - video.conversionStartTime) / 1000;
        extras.push(formatEta((elapsed / video.progress) * (100 - video.progress)));
      }
      if (extras.length) text += ` · ${extras.join(' · ')}`;
      return { text, progress: video.progress, cancellable: true };
    }

    case 'completed':
      return {
        text: `completado - ${formatMB(video.webmSize)} (${formatReduction(video.originalSize, video.webmSize)}) - crf ${video.crf}`,
        progress: 100,
        modifier: 'success',
        downloadable: true
      };

    case 'error':
      return { text: video.errorMessage || 'error al convertir', progress: 0, statusClass: 'status-error', retryable: true };

    case 'cancelled':
      return { text: 'cancelado', progress: 0, modifier: 'cancelled', retryable: true };

    default:
      return { text: '', progress: 0 };
  }
}

export function updateVideoCard(video) {
  const card = getCard(video.id);
  if (!card) return;

  const view = getStatusView(video);
  const statusText = card.querySelector('.status-text');
  const progressBar = card.querySelector('.progress-bar');
  const progressFill = card.querySelector('.progress-fill');

  // La calidad, el crf y "sin audio" cambian mientras el vídeo espera
  card.querySelector('.badge-preset').textContent = getPreset(video.presetId).label;
  card.querySelector('.badge-crf').textContent = `crf ${video.crf}`;
  card.querySelector('.badge-mute').hidden = !video.mute;
  if (video.scaledResolution) {
    const badgeRes = card.querySelector('.badge-res');
    badgeRes.textContent = video.scaledResolution;
    badgeRes.hidden = false;
  }

  statusText.className = 'status-text';
  progressFill.className = 'progress-fill';
  if (view.modifier) {
    statusText.classList.add(`status-${view.modifier}`);
    progressFill.classList.add(`progress-${view.modifier}`);
  }
  if (view.statusClass) statusText.classList.add(view.statusClass);

  statusText.textContent = view.text;
  progressFill.style.width = `${view.progress}%`;
  progressBar.setAttribute('aria-valuenow', String(view.progress));

  card.querySelector('.btn-download').disabled = !view.downloadable;
  card.querySelector('.btn-retry').hidden = !view.retryable;
  const removeButton = card.querySelector('.btn-remove');
  setRemoveButton(removeButton, view.cancellable ? 'cancel' : 'remove');
  removeButton.disabled = Boolean(view.busy);
}

function renderLogs(video) {
  const container = getCard(video.id)?.querySelector('.video-logs');
  if (!container) return;
  container.innerHTML = video.logs.map(entry => `<div>${escapeHtml(entry)}</div>`).join('');
  container.scrollTop = container.scrollHeight;
}

export function logVideo(video, message) {
  const safeMessage = message.length > MAX_LOG_LENGTH ? `${message.slice(0, MAX_LOG_LENGTH)}…` : message;
  const timestamp = new Date().toLocaleTimeString('es-ES', { hour12: false });
  video.logs.push(`[${timestamp}] ${safeMessage}`);
  if (video.logs.length > MAX_LOG_LINES) {
    video.logs = video.logs.slice(-MAX_LOG_LINES);
  }
  renderLogs(video);
}

export function removeVideoCard(id) {
  getCard(id)?.remove();
}

// Con qué nombre sale cada vídeo, y la miniatura del fotograma (que es también
// un enlace para bajarlo solo, por si el navegador bloquea la segunda descarga).
// Los nombres dependen del orden y de los demás vídeos: se repintan todos.
function renderOutputNames() {
  const names = outputNames();
  for (const video of state.videos) {
    const card = getCard(video.id);
    if (!card) continue;
    const name = names.get(video);
    const out = card.querySelector('.video-out');
    const missingPoster = video.status === 'completed' && video.poster && !video.posterBlob;
    const withPoster = video.poster && !missingPoster;
    out.hidden = !name;
    out.textContent = name ? `se descarga como ${name}.webm${withPoster ? ` + ${posterName(name)}` : ''}` : '';
    if (missingPoster) out.textContent += ' · sin fotograma: no se pudo sacar';
    out.classList.toggle('video-out-warning', missingPoster);

    const thumb = card.querySelector('.video-poster');
    thumb.hidden = !video.posterUrl;
    if (video.posterUrl && name) {
      thumb.href = video.posterUrl;
      thumb.download = posterName(name);
      thumb.querySelector('img').src = video.posterUrl;
    }
  }
}

export function updateVideosContainer() {
  renderOutputNames();
  const total = state.videos.length;
  const completed = state.videos.filter(v => v.status === 'completed').length;

  dom.videoCount.textContent = `${completed} de ${total} videos convertidos`;
  dom.videosContainer.classList.toggle('visible', total > 0);
  dom.downloadAllBtn.disabled = completed === 0;
}
