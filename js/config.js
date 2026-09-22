// ============================================================
// CONFIGURACIÓN GLOBAL
// ============================================================
// Usa ffmpeg.wasm v0.12.x con multi-threading (VP8 + SharedArrayBuffer).
// coi-serviceworker.js inyecta los headers COOP/COEP necesarios.

export const CONFIG = {
  DEBUG_LOGS: false,

  // Codec de video: VP8 para WebM (VP9 causa memory crash en ffmpeg.wasm, issue #679/#786)
  VIDEO_CODEC: 'libvpx',

  // Codec de audio: Vorbis en contenedor WebM (libopus causa stack overflow en WASM, issue #591)
  AUDIO_CODEC: 'libvorbis',

  // CDN base para @ffmpeg/core-mt
  CORE_MT_BASE: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.9/dist/umd',

  JSZIP_URL: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',

  // A partir de este tamaño se monta el archivo con WORKERFS en vez de copiarlo a memoria WASM
  WORKERFS_THRESHOLD: 200 * 1024 * 1024,

  // A partir de este tamaño se avisa de que puede fallar por memoria
  MAX_SAFE_SIZE: 500 * 1024 * 1024,

  // Si el navegador no sabe decodificar el formato puede que nunca responda al leer metadatos
  METADATA_TIMEOUT_MS: 5000,

  // Algunos navegadores dejan file.type vacío para estos formatos (mkv, flv...)
  VIDEO_EXTENSIONS: ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'mpg', 'mpeg', '3gp', 'ts', 'mts', 'm2ts', 'ogv']
};

// ============================================================
// PRESETS VP8: cada modo define resolución, CRF, bitrates, etc.
// ============================================================
// VP8 CRF: 4 (mejor) a 63 (peor).
// Con -b:v > 0: modo VBR limitado (CRF como piso de calidad, bitrate como techo).
// Esto permite que cada preset produzca archivos de tamaño realmente distinto.
// cpu-used: 0-16 (más alto = más rápido, menos calidad). Para WASM usar >= 4.
export const PRESETS = {
  high: {
    id: 'high',
    label: '1080',
    suffix: '_1080',
    maxWidth: 1920,
    maxHeight: 1080,
    crf: 10,
    videoBitrate: '1500k',   // Techo 1.5 Mbps (v2 usó 1742 real, baja un poco)
    audioBitrate: '128k',
    cpuUsed: 4,
    fps: null
  },
  medium: {
    id: 'medium',
    label: '720p',
    suffix: '_720p',
    maxWidth: 1280,
    maxHeight: 720,
    crf: 20,
    videoBitrate: '1200k',   // Techo 1.2 Mbps → escalón claro entre alta y baja
    audioBitrate: '96k',
    cpuUsed: 5,
    fps: null
  },
  low: {
    id: 'low',
    label: '480p',
    suffix: '_480p',
    maxWidth: 854,
    maxHeight: 480,
    crf: 33,
    videoBitrate: '800k',    // Mismo techo que v1 (te gustaba más)
    audioBitrate: '96k',
    cpuUsed: 8,
    fps: 24
  }
};

export function getPreset(id) {
  return PRESETS[id] || PRESETS.medium;
}
