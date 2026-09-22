import { getPreset } from './config.js';

// El orden de state.videos es el orden visual de las tarjetas y el del ZIP final.
export const state = {
  videos: [],
  mode: 'medium',
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
  const preset = getPreset(presetId);
  return {
    id: crypto.randomUUID(),
    presetId: preset.id,
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
