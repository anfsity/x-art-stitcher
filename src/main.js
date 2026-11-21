import { getThresholds, loadConfig, saveConfig } from './config.js';
import { detectSplitArtwork } from './detector.js';
import { extractGalleriesFromArticle } from './dom.js';
import {
  copyPngBlobToClipboard,
  decodeImage,
  downloadBlob,
  extractRgbaFromDecoded,
  fetchBlobWithFallback,
  injectStyles,
  registerMenu,
} from './gm.js';
import { installGraphqlInterceptor, onTweetMediaCaptured } from './interceptor.js';
import { canvasToBlob, getAvailableLayouts, renderStitchedCanvas } from './stitcher.js';
import { createGalleryUI, getLayoutLabel, openLightbox, openSettingsModal, showToast } from './ui.js';
import { formatFilename, getMediaVariantUrls } from './url.js';

// Replaced at build time with contents of src/styles.css.
const STYLES_CSS = '__XAS_STYLES_CSS__';

// Install passive GraphQL/XHR hooks immediately at document-start before X boots.
installGraphqlInterceptor();

class LruCache {
  constructor(limit, onEvict) {
    this.limit = limit;
    this.onEvict = onEvict;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key, val) {
    if (this.map.has(key)) {
      const prev = this.map.get(key);
      this.map.delete(key);
      if (prev !== val && this.onEvict) this.onEvict(prev, key);
    }
    this.map.set(key, val);
    while (this.map.size > this.limit) {
      const oldestKey = this.map.keys().next().value;
      const oldestVal = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (this.onEvict) this.onEvict(oldestVal, oldestKey);
    }
  }
}

class TaskQueue {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.active = 0;
    this.queue = [];
  }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.active++;
      Promise.resolve()
        .then(task.fn)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let nextIdx = 0;
  const runWorker = async () => {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await worker(items[idx], idx);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

let config = loadConfig();

const detectQueue = new TaskQueue(3);
const analysisCache = new LruCache(200);
const origBlobCache = new LruCache(96);
const previewUrlCache = new LruCache(48, (entry) => {
  if (entry?.objectUrl) {
    URL.revokeObjectURL(entry.objectUrl);
    entry.revoked = true;
  }
});

const containerControllers = new WeakMap();
const activeControllers = new Set();

function debugLog(...args) {
  if (config.debug) {
    console.log('[XAS]', ...args);
  }
}

async function fetchCachedOrigDecoded(urls) {
  const blobs = await mapConcurrent(urls, 6, async (src) => {
    const variants = getMediaVariantUrls(src, 'orig');
    const cacheKey = variants[0];
    let blob = origBlobCache.get(cacheKey);
    if (!blob) {
      blob = await fetchBlobWithFallback(variants);
      origBlobCache.set(cacheKey, blob);
    }
    return blob;
  });
  return Promise.all(blobs.map(decodeImage));
}

async function analyzeGallery(gallery, { forceRecompute = false, allowUnshuffle = config.autoUnshuffle } = {}) {
  const cacheKey = `${gallery.signature}|${config.sensitivity}|${allowUnshuffle ? 1 : 0}`;
  if (!forceRecompute) {
    const cached = analysisCache.get(cacheKey);
    if (cached) return cached;
  }

  const rgbaList = await mapConcurrent(gallery.urls, 6, async (src, idx) => {
    const blob = await fetchBlobWithFallback(getMediaVariantUrls(src, 'thumb'));
    const decoded = await decodeImage(blob);
    try {
      const rgba = extractRgbaFromDecoded(decoded, 480);
      const knownDim = gallery.origDims?.[idx];
      if (knownDim?.width > 0 && knownDim?.height > 0) {
        rgba.origWidth = knownDim.width;
        rgba.origHeight = knownDim.height;
      }
      return rgba;
    } finally {
      decoded.close();
    }
  });

  const thresholds = getThresholds(config.sensitivity);
  const result = detectSplitArtwork(rgbaList, {
    ...thresholds,
    allowUnshuffle,
  });

  debugLog('Analyzed tweet gallery', {
    handle: gallery.handle,
    tweetId: gallery.tweetId,
    count: gallery.urls.length,
    isMatch: result.isMatch,
    wasUnshuffled: result.wasUnshuffled,
    winner: result.winner
      ? {
          layout: result.winner.layout,
          order: result.winner.order,
          composite: Number(result.winner.composite.toFixed(3)),
          minSeam: Number(result.winner.minSeamScore.toFixed(3)),
          activeCount: result.winner.activeCount,
          maxActivity: Number(result.winner.maxActivity.toFixed(1)),
        }
      : null,
  });

  analysisCache.set(cacheKey, result);
  return result;
}

function createGalleryController(gallery) {
  let analysis = null;
  let currentRender = null;
  let renderSeq = 0;

  const ensureCurrentCanvas = async () => {
    if (!currentRender) throw new Error('No stitched image is currently active');
    const decoded = await fetchCachedOrigDecoded(gallery.urls);
    try {
      return renderStitchedCanvas(decoded, currentRender.layout, currentRender.order);
    } finally {
      decoded.forEach((d) => d.close());
    }
  };

  const renderStitched = async (layout, customOrder = null, wasUnshuffled = false) => {
    const seq = ++renderSeq;
    const order =
      customOrder ||
      (analysis?.bestByLayout?.[layout] && config.autoUnshuffle && analysis.isMatch && analysis.winner?.layout === layout
        ? analysis.winner.order
        : Array.from({ length: gallery.urls.length }, (_, i) => i));

    const previewKey = `${gallery.signature}|${layout}|${order.join(',')}`;
    const cachedPreview = previewUrlCache.get(previewKey);
    if (cachedPreview && !cachedPreview.revoked) {
      currentRender = {
        entry: cachedPreview,
        previewKey,
        objectUrl: cachedPreview.objectUrl,
        pngBlob: cachedPreview.pngBlob,
        width: cachedPreview.width,
        height: cachedPreview.height,
        layout,
        order: order.slice(),
        wasUnshuffled,
      };
      ui.showStitched(currentRender);
      return;
    }

    ui.setBusy(true);
    try {
      const decoded = await fetchCachedOrigDecoded(gallery.urls);
      let canvas;
      let width;
      let height;
      try {
        ({ canvas, width, height } = renderStitchedCanvas(decoded, layout, order));
      } finally {
        decoded.forEach((d) => d.close());
      }

      const pngBlob = await canvasToBlob(canvas, 'png');
      if (seq !== renderSeq) return;

      const objectUrl = URL.createObjectURL(pngBlob);
      const entry = { objectUrl, pngBlob, width, height, revoked: false };
      previewUrlCache.set(previewKey, entry);

      currentRender = {
        entry,
        previewKey,
        objectUrl,
        pngBlob,
        width,
        height,
        layout,
        order: order.slice(),
        wasUnshuffled,
      };
      ui.showStitched(currentRender);
    } catch (err) {
      console.error('[XAS] Stitch render failed:', err);
      ui.setBusy(false);
      showToast(`Stitch failed: ${err.message}`, true);
    }
  };

  const handleDownload = async () => {
    if (!currentRender) return;
    try {
      const format = config.downloadFormat || 'png';
      let blob = currentRender.pngBlob;
      if (format !== 'png') {
        const { canvas } = await ensureCurrentCanvas();
        blob = await canvasToBlob(canvas, format, config.downloadQuality);
      }
      const filename = formatFilename(config.filenameTemplate, {
        handle: gallery.handle,
        tweetId: gallery.tweetId,
        layout: currentRender.layout,
        ext: format,
      });
      downloadBlob(blob, filename);
      showToast(`Downloaded ${filename}`);
    } catch (err) {
      console.error('[XAS] Download failed:', err);
      showToast(`Download failed: ${err.message}`, true);
    }
  };

  const handleCopy = async () => {
    if (!currentRender) return;
    try {
      await copyPngBlobToClipboard(currentRender.pngBlob);
      showToast('Copied stitched PNG to clipboard');
    } catch (err) {
      console.error('[XAS] Clipboard copy failed:', err);
      showToast(`Clipboard copy failed: ${err.message}`, true);
    }
  };

  const handleOpenLightbox = () => {
    if (!currentRender) return;
    if (currentRender.entry?.revoked && currentRender.pngBlob) {
      const freshUrl = URL.createObjectURL(currentRender.pngBlob);
      const freshEntry = {
        objectUrl: freshUrl,
        pngBlob: currentRender.pngBlob,
        width: currentRender.width,
        height: currentRender.height,
        revoked: false,
      };
      currentRender.entry = freshEntry;
      currentRender.objectUrl = freshUrl;
      if (currentRender.previewKey) {
        previewUrlCache.set(currentRender.previewKey, freshEntry);
      }
    }
    openLightbox({
      url: currentRender.objectUrl,
      title: `@${gallery.handle} · ${getLayoutLabel(currentRender.layout)}`,
      width: currentRender.width,
      height: currentRender.height,
      onDownload: handleDownload,
      onCopy: handleCopy,
    });
  };

  const handleAutoSolve = async (forcedLayout = null) => {
    ui.setBusy(true);
    try {
      analysis = await analyzeGallery(gallery, { forceRecompute: true, allowUnshuffle: true });
      if (forcedLayout && analysis.bestByLayout[forcedLayout]) {
        const cand = analysis.bestByLayout[forcedLayout];
        const unshuffled = cand.order.some((v, idx) => v !== idx);
        await renderStitched(forcedLayout, cand.order, unshuffled);
        return;
      }
      if (analysis.winner) {
        const unshuffled = analysis.winner.order.some((v, idx) => v !== idx);
        await renderStitched(analysis.winner.layout, analysis.winner.order, unshuffled);
      } else {
        const fallbackLayout = getAvailableLayouts(gallery.urls.length)[0];
        await renderStitched(fallbackLayout);
      }
    } catch (err) {
      console.error('[XAS] Auto-solve failed:', err);
      ui.setBusy(false);
      showToast(`Auto-detect failed: ${err.message}`, true);
    }
  };

  const ui = createGalleryUI(gallery, {
    onSelectLayout(layout, customOrder, wasUnshuffled) {
      renderStitched(layout, customOrder, wasUnshuffled);
    },
    onAutoSolve(forcedLayout) {
      handleAutoSolve(forcedLayout);
    },
    onChangeOrder(nextOrder) {
      if (!currentRender) return;
      renderStitched(currentRender.layout, nextOrder, false);
    },
    onRestoreOriginal() {
      renderSeq++;
      currentRender = null;
      ui.showOriginal();
    },
    onOpenLightbox: handleOpenLightbox,
    onDownload: handleDownload,
    onCopy: handleCopy,
    onOpenSettings: openSettings,
  });

  let detectionStarted = false;

  const triggerAutoDetect = () => {
    if (detectionStarted || !config.autoDetect) return;
    detectionStarted = true;
    detectQueue
      .enqueue(() => analyzeGallery(gallery))
      .then((result) => {
        analysis = result;
        if (!gallery.container.isConnected) return;
        if (!result.isMatch || !result.winner) return;

        const suggestion = {
          layout: result.winner.layout,
          order: result.winner.order,
          wasUnshuffled: result.wasUnshuffled,
        };
        ui.setSuggested(suggestion);

        if (config.autoStitch && !currentRender) {
          renderStitched(suggestion.layout, suggestion.order, suggestion.wasUnshuffled);
        }
      })
      .catch((err) => {
        debugLog('Auto-detect error:', err);
      });
  };

  const controller = {
    gallery,
    signature: gallery.signature,
    triggerAutoDetect,
    destroy() {
      renderSeq++;
      visibilityObserver?.unobserve(gallery.container);
      ui.destroy();
      activeControllers.delete(controller);
    },
  };

  activeControllers.add(controller);
  return controller;
}

let visibilityObserver = null;

function scanPage() {
  for (const ctrl of activeControllers) {
    if (!ctrl.gallery.container.isConnected) {
      activeControllers.delete(ctrl);
    }
  }

  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    const galleries = extractGalleriesFromArticle(article);
    for (const gallery of galleries) {
      const existing = containerControllers.get(gallery.container);
      if (existing) {
        if (existing.signature === gallery.signature) continue;
        // Image list upgraded (e.g. GraphQL captured remaining carousel slides) or container recycled.
        existing.destroy();
      }

      const ctrl = createGalleryController(gallery);
      containerControllers.set(gallery.container, ctrl);
      if (config.autoDetect && visibilityObserver) {
        visibilityObserver.observe(gallery.container);
      }
    }
  }
}

let scanScheduled = false;
function scheduleScan() {
  if (scanScheduled || !document.body) return;
  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    scanPage();
  });
}

function openSettings() {
  openSettingsModal(config, (nextConfig) => {
    config = saveConfig(nextConfig);
    debugLog('Updated config:', config);
    showToast('Settings saved');
    if (config.autoDetect && visibilityObserver) {
      for (const ctrl of activeControllers) {
        if (ctrl.gallery.container.isConnected) {
          visibilityObserver.observe(ctrl.gallery.container);
        }
      }
    }
  });
}

function isOwnUiNode(node) {
  if (!node || node.nodeType !== 1) return false;
  return Boolean(node.closest?.('.xas-injected, .xas-lightbox, .xas-modal-backdrop, .xas-toast'));
}

function initDom() {
  injectStyles(STYLES_CSS);
  registerMenu('X Art Stitcher Settings', openSettings, 'xas_settings');
  registerMenu(
    'Rescan Visible Tweets',
    () => {
      scanPage();
      showToast('Rescanned visible tweets');
    },
    'xas_rescan',
  );

  visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const ctrl = containerControllers.get(entry.target);
        if (ctrl) {
          visibilityObserver.unobserve(entry.target);
          ctrl.triggerAutoDetect();
        }
      }
    },
    { rootMargin: '320px 0px' },
  );

  onTweetMediaCaptured(scheduleScan);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (isOwnUiNode(mutation.target)) continue;
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        const hasExternal = Array.from(mutation.addedNodes).some((n) => !isOwnUiNode(n));
        if (hasExternal) {
          scheduleScan();
          return;
        }
      }
      if (mutation.type === 'attributes' && mutation.target.tagName === 'IMG') {
        scheduleScan();
        return;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });

  scheduleScan();
  debugLog('Initialized X Art Stitcher', config);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDom, { once: true });
} else {
  initDom();
}
