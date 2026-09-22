import { debugLog } from '../utils.js';

const VISIBLE_MS = 3000;
const FADE_MS = 300;

// Apila las notificaciones visibles de abajo (la más reciente) hacia arriba
function restack() {
  const all = document.querySelectorAll('.notification');
  all.forEach((n, i) => {
    n.style.bottom = `${2 + (all.length - 1 - i) * 4}rem`;
  });
}

export function showNotification(message, type = 'info') {
  debugLog('[showNotification]', type, message);
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.setAttribute('role', type === 'error' ? 'alert' : 'status');
  notification.textContent = message;

  document.body.appendChild(notification);
  restack();

  setTimeout(() => notification.classList.add('show'), 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
      restack();
    }, FADE_MS);
  }, VISIBLE_MS);
}
