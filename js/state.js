import { settingsFor } from './config.js';

// Opciones que se recuerdan entre visitas: fotograma, sin audio, numerar y desde qué número.
const OPTIONS_KEY = 'videoToWeb.opciones';
const DEFAULT_OPTIONS = { poster: true, mute: false, number: false, start: 1 };

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
  // calidad, poster y mute valen para los vídeos que esperan (los convertidos ya no
  // cambian); number y start se miran al nombrar, así siguen el orden de las tarjetas
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
    posterUrl: null,
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
    extractingPoster: false,
    downloaded: false, // para avisar antes de cerrar la pestaña
    status: 'pending',
    progress: 0,
    errorMessage: null,
    conversionStartTime: null,
    metadata
  };
}
