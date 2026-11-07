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
  const s = Math.round(seconds); // redondear antes de partir, si no sale "~1m 60s"
  if (s < 60) return `~${s}s`;
  return `~${Math.floor(s / 60)}m ${s % 60}s`;
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

// Los navegadores enseñan a 10 cs los fotogramas de un gif con retardo 0 o 1 cs,
// pero ffmpeg deja el de 1 cs tal cual (100 fps) y el webm sale 10 veces más
// rápido que el gif. Se cambia en los bytes (Graphic Control Extension) antes de
// convertir. Devuelve cuántos fotogramas ha cambiado.
export function fixGifDelays(bytes) {
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== 'GIF') return 0;
  const paletteSize = flags => (flags & 0x80 ? 3 << ((flags & 7) + 1) : 0);
  const skipSubBlocks = (i) => {
    while (i < bytes.length && bytes[i] !== 0) i += bytes[i] + 1;
    return i + 1;
  };
  let fixed = 0;
  let i = 13 + paletteSize(bytes[10]); // cabecera + paleta global
  while (i < bytes.length) {
    if (bytes[i] === 0x21) { // extensión: la 0xF9 trae el retardo
      if (bytes[i + 1] === 0xf9 && bytes[i + 2] === 4 && (bytes[i + 4] | (bytes[i + 5] << 8)) < 2) {
        bytes[i + 4] = 10;
        bytes[i + 5] = 0;
        fixed++;
      }
      i = skipSubBlocks(i + 2);
    } else if (bytes[i] === 0x2c) { // imagen: descriptor, paleta local, tamaño LZW y datos
      i = skipSubBlocks(i + 10 + paletteSize(bytes[i + 9]) + 1);
    } else {
      break; // 0x3B (fin del gif) o un gif roto: lo que quede, tal cual
    }
  }
  return fixed;
}
