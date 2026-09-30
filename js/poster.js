// El fotograma de un vídeo convertido, para usarlo de poster en una web: lo que
// se ve mientras el vídeo carga. Lo saca el propio navegador del webm que acaba
// de salir, a medio segundo (el primer fotograma de un clip cortado suele ser
// negro o un fundido). WebP si el navegador sabe codificarlo; si no, JPEG.
// Nunca lanza: si algo falla devuelve null y el vídeo se queda sin poster.
export function extractPoster(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    let settled = false;
    const finish = (blob) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    video.onerror = () => finish(null);
    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 1;
      video.currentTime = Math.min(0.5, duration / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx || !canvas.width) return finish(null);
      ctx.drawImage(video, 0, 0);
      // Safari no codifica WebP y devuelve PNG: entonces JPEG, que pesa menos
      canvas.toBlob((webp) => {
        if (webp?.type === 'image/webp') return finish(webp);
        canvas.toBlob(jpeg => finish(jpeg), 'image/jpeg', 0.85);
      }, 'image/webp', 0.8);
    };

    video.src = url;
  });
}

export function posterExtension(blob) {
  return blob?.type === 'image/webp' ? 'webp' : 'jpg';
}
