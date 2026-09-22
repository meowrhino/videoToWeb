import { CONFIG } from './config.js';

export function debugLog(...args) {
  if (CONFIG.DEBUG_LOGS) {
    console.log(...args);
  }
}

export function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Porcentaje de reducción con signo: "-84.3%" si ocupa menos, "+12.0%" si ocupa más
export function formatReduction(originalBytes, newBytes) {
  const pct = (1 - newBytes / originalBytes) * 100;
  return pct >= 0 ? `-${pct.toFixed(1)}%` : `+${Math.abs(pct).toFixed(1)}%`;
}

export function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatEta(seconds) {
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  return `~${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function getExtension(filename) {
  const match = /\.([^./]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : '';
}

export function stripExtension(filename) {
  return filename.replace(/\.[^/.]+$/, '');
}

export function isVideoFile(file) {
  return file.type.startsWith('video/') || CONFIG.VIDEO_EXTENSIONS.includes(getExtension(file.name));
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

// Descarga un blob URL. El enlace se añade al DOM y la URL se revoca más tarde:
// revocarla justo después de click() cancela la descarga en Safari/Firefox.
export function triggerDownload(url, filename, { revoke = false } = {}) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (revoke) {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
