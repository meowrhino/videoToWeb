import { settingsFor } from './config.js';

// Opciones que se recuerdan entre visitas: fotograma, sin audio, numerar.
const OPTIONS_KEY = 'videoToWeb.opciones';
const DEFAULT_OPTIONS = { poster: true, mute: false, number: false };

function loadOptions() {
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveOptions() {
  try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(state.options)); } catch {}
}

// El orden de state.videos es el orden visual de las tarjetas y el del ZIP final.
export const state = {
  videos: [],
  mode: 'medium',
  // poster y mute se aplican a los vídeos que se añaden después (como la calidad);
  // number se mira al descargar, así sigue el orden en que estén las tarjetas
  options: loadOptions(),
  ffmpeg: null,
  ffmpegLoaded: false,
  loadPromise: null,
  isConverting: false,
  pendingQueue: []
};

export function findVideo(id) {
  return state.videos.find(v => v.id === id);
}

export function createVideoData(file, metadata, presetId = state.mode) {
  const preset = settingsFor(presetId, file);
  return {
    id: crypto.randomUUID(),
    presetId: preset.id,
    poster: state.options.poster,
    mute: state.options.mute,
    posterBlob: null,
    originalFile: file,
    originalSize: file.size,
    webmBlob: null,
    webmSize: 0,
    webmUrl: null,
    crf: preset.crf,
    logs: [],
    currentFrame: null,
    currentSizeKB: null,
    scaledResolution: null,
    status: 'pending',
    progress: 0,
    errorMessage: null,
    conversionStartTime: null,
    metadata
  };
}
