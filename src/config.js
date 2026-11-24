export const DEFAULT_CONFIG = {
  autoDetect: true,
  autoStitch: true,
  autoUnshuffle: true,
  sensitivity: 'normal', // 'strict' | 'normal' | 'loose'
  downloadFormat: 'png', // 'png' | 'jpeg' | 'webp'
  downloadQuality: 0.95,
  filenameTemplate: '@{handle}_{tweetId}_{layout}',
  enableGifTools: true,
  autoDetectGifVideos: true,
  showOnRegularVideos: true,
  gifFps: 15, // 10 | 15 | 20 | 25
  gifMaxWidth: 540, // 480 | 540 | 720 | 0 (original)
  gifQuality: 'balanced', // 'fast' | 'balanced' | 'high'
  gifMaxDuration: 15, // 8 | 15 | 25 (seconds)
  debug: false,
};

export const SENSITIVITY_PRESETS = {
  strict: {
    minComposite: 0.70,
    minSeam: 0.52,
    minActivity: 12,
    unshuffleMargin: 0.14,
  },
  normal: {
    minComposite: 0.60,
    minSeam: 0.40,
    minActivity: 9,
    unshuffleMargin: 0.10,
  },
  loose: {
    minComposite: 0.50,
    minSeam: 0.30,
    minActivity: 6,
    unshuffleMargin: 0.08,
  },
};

const STORAGE_KEY = 'xas_config_v1';

export function loadConfig() {
  try {
    if (typeof GM_getValue === 'function') {
      const saved = GM_getValue(STORAGE_KEY, null);
      if (saved && typeof saved === 'object') {
        return { ...DEFAULT_CONFIG, ...saved };
      }
      if (typeof saved === 'string') {
        return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
      }
    }
  } catch (_) {
    // Fall back to defaults if storage is unavailable or corrupted.
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  try {
    if (typeof GM_setValue === 'function') {
      GM_setValue(STORAGE_KEY, merged);
    }
  } catch (_) {
    // Ignore storage write failures.
  }
  return merged;
}

export function getThresholds(sensitivity) {
  return SENSITIVITY_PRESETS[sensitivity] || SENSITIVITY_PRESETS.normal;
}
