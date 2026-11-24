import { getThresholds, loadConfig, saveConfig } from './config.js';
import { detectSplitArtwork } from './detector.js';
import { extractGalleriesFromArticle, extractVideosFromArticle } from './dom.js';
import { transcodeMp4BlobToGif } from './gif.js';
import {
  copyPngBlobToClipboard,
  decodeImage,
  downloadBlob,
  extractRgbaFromDecoded,
  fetchBlobWithFallback,
  fetchRangeBuffer,
  injectStyles,
  registerMenu,
} from './gm.js';
import { installGraphqlInterceptor, onTweetMediaCaptured } from './interceptor.js';
import { classifyGifMedia, parseMp4Metadata } from './mp4.js';
import { canvasToBlob, getAvailableLayouts, renderStitchedCanvas } from './stitcher.js';
import {
  createGalleryUI,
  createVideoUI,
  formatIndexRange,
  getLayoutLabel,
  openLightbox,
  openSettingsModal,
  showToast,
  t,
} from './ui.js';
import { buildMediaUrl, formatFilename, getMediaVariantUrls } from './url.js';

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
const videoProbeQueue = new TaskQueue(2);
const analysisCache = new LruCache(200);
const videoProbeCache = new LruCache(200);
const origBlobCache = new LruCache(96);
const mp4BlobCache = new LruCache(12);
const previewUrlCache = new LruCache(48, (entry) => {
  if (entry?.objectUrl) {
    URL.revokeObjectURL(entry.objectUrl);
    entry.revoked = true;
  }
});

const containerControllers = new WeakMap();
const activeControllers = new Set();
const videoControllers = new WeakMap();
const activeVideoControllers = new Set();

function debugLog(...args) {
  if (config.debug) {
    console.log('[XAS]', ...args);
  }
}

async function fetchCachedOrigBlob(src) {
  const variants = getMediaVariantUrls(src, 'orig');
  const cacheKey = variants[0];
  let blob = origBlobCache.get(cacheKey);
  if (!blob) {
    blob = await fetchBlobWithFallback(variants);
    origBlobCache.set(cacheKey, blob);
  }
  return blob;
}

async function fetchCachedOrigDecoded(urls) {
  const blobs = await mapConcurrent(urls, 6, fetchCachedOrigBlob);
  return Promise.all(blobs.map(decodeImage));
}

async function fetchThumbRgba(urls, origDims) {
  return mapConcurrent(urls, 6, async (src, idx) => {
    const blob = await fetchBlobWithFallback(getMediaVariantUrls(src, 'thumb'));
    const decoded = await decodeImage(blob);
    try {
      const rgba = extractRgbaFromDecoded(decoded, 480);
      const knownDim = origDims?.[idx];
      if (knownDim?.width > 0 && knownDim?.height > 0) {
        rgba.origWidth = knownDim.width;
        rgba.origHeight = knownDim.height;
      }
      return rgba;
    } finally {
      decoded.close();
    }
  });
}

async function analyzeGallery(gallery, { forceRecompute = false, allowUnshuffle = config.autoUnshuffle } = {}) {
  const cacheKey = `${gallery.signature}|${config.sensitivity}|${allowUnshuffle ? 1 : 0}`;
  if (!forceRecompute) {
    const cached = analysisCache.get(cacheKey);
    if (cached) return cached;
  }

  const rgbaList = await fetchThumbRgba(gallery.urls, gallery.origDims);
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
    isPartial: result.isPartial,
    wasUnshuffled: result.wasUnshuffled,
    groups: result.groups?.map((g) =>
      g.type === 'stitched' ? { type: 'stitched', indices: g.indices, layout: g.layout } : g,
    ),
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

function refreshRevokedEntry(item) {
  if (item?.type !== 'stitched' || !item.entry?.revoked || !item.pngBlob) return;
  const freshUrl = URL.createObjectURL(item.pngBlob);
  const freshEntry = {
    objectUrl: freshUrl,
    pngBlob: item.pngBlob,
    width: item.width,
    height: item.height,
    revoked: false,
  };
  item.entry = freshEntry;
  item.objectUrl = freshUrl;
  if (item.previewKey) {
    previewUrlCache.set(item.previewKey, freshEntry);
  }
}

function createGalleryController(gallery) {
  let analysis = null;
  let galleryItems = null; // Array of rendered stitched/single items when active
  let activeIndex = 0;
  let renderSeq = 0;

  const getActiveItem = (idx = activeIndex) => (galleryItems ? galleryItems[idx] || null : null);

  const buildStitchedItem = async (indices, layout, order, wasUnshuffled) => {
    const previewKey = `${gallery.signature}|${indices.join(',')}|${layout}|${order.join(',')}`;
    const cached = previewUrlCache.get(previewKey);
    if (cached && !cached.revoked) {
      return {
        type: 'stitched',
        indices: indices.slice(),
        layout,
        order: order.slice(),
        wasUnshuffled: Boolean(wasUnshuffled),
        entry: cached,
        previewKey,
        objectUrl: cached.objectUrl,
        pngBlob: cached.pngBlob,
        width: cached.width,
        height: cached.height,
      };
    }

    const subsetUrls = indices.map((idx) => gallery.urls[idx]);
    const decoded = await fetchCachedOrigDecoded(subsetUrls);
    let canvas;
    let width;
    let height;
    try {
      ({ canvas, width, height } = renderStitchedCanvas(decoded, layout, order));
    } finally {
      decoded.forEach((d) => d.close());
    }

    const pngBlob = await canvasToBlob(canvas, 'png');
    const objectUrl = URL.createObjectURL(pngBlob);
    const entry = { objectUrl, pngBlob, width, height, revoked: false };
    previewUrlCache.set(previewKey, entry);

    return {
      type: 'stitched',
      indices: indices.slice(),
      layout,
      order: order.slice(),
      wasUnshuffled: Boolean(wasUnshuffled),
      entry,
      previewKey,
      objectUrl,
      pngBlob,
      width,
      height,
    };
  };

  const buildSingleItem = (index) => {
    const src = gallery.urls[index];
    const dim = gallery.origDims?.[index];
    return {
      type: 'single',
      index,
      url: buildMediaUrl(src, 'large'),
      thumbUrl: buildMediaUrl(src, 'small'),
      width: dim?.width || 0,
      height: dim?.height || 0,
    };
  };

  const renderCanvasForStitchedItem = async (item) => {
    const subsetUrls = item.indices.map((idx) => gallery.urls[idx]);
    const decoded = await fetchCachedOrigDecoded(subsetUrls);
    try {
      return renderStitchedCanvas(decoded, item.layout, item.order);
    } finally {
      decoded.forEach((d) => d.close());
    }
  };

  const renderSingleGroupView = async (layout, customOrder = null, wasUnshuffled = false) => {
    const seq = ++renderSeq;
    const allIndices = Array.from({ length: gallery.urls.length }, (_, i) => i);
    const order =
      customOrder ||
      (!analysis?.isPartial &&
      analysis?.bestByLayout?.[layout] &&
      config.autoUnshuffle &&
      analysis.isMatch &&
      analysis.winner?.layout === layout
        ? analysis.winner.order
        : allIndices);

    const previewKey = `${gallery.signature}|${allIndices.join(',')}|${layout}|${order.join(',')}`;
    const cached = previewUrlCache.get(previewKey);
    if (!cached || cached.revoked) ui.setBusy(true);

    try {
      const item = await buildStitchedItem(allIndices, layout, order, wasUnshuffled);
      if (seq !== renderSeq) return;
      galleryItems = [item];
      activeIndex = 0;
      ui.showGallery({ items: galleryItems, activeIndex });
    } catch (err) {
      console.error('[XAS] Stitch render failed:', err);
      ui.setBusy(false);
      showToast(`Stitch failed: ${err.message}`, true);
    }
  };

  const renderMixedGallery = async (groupDescriptors) => {
    const seq = ++renderSeq;
    ui.setBusy(true);
    try {
      const items = await Promise.all(
        groupDescriptors.map((grp) => {
          if (grp.type === 'stitched') {
            return buildStitchedItem(grp.indices, grp.layout, grp.order, grp.wasUnshuffled);
          }
          return buildSingleItem(grp.index);
        }),
      );
      if (seq !== renderSeq) return;
      const firstStitchedIdx = Math.max(
        0,
        items.findIndex((item) => item.type === 'stitched'),
      );
      galleryItems = items;
      activeIndex = firstStitchedIdx;
      ui.showGallery({ items: galleryItems, activeIndex });
    } catch (err) {
      console.error('[XAS] Mixed gallery render failed:', err);
      ui.setBusy(false);
      showToast(`Stitch failed: ${err.message}`, true);
    }
  };

  const updateActiveStitchedGroup = async (layout, customOrder = null, wasUnshuffled = false) => {
    const current = getActiveItem();
    if (!current || current.type !== 'stitched' || galleryItems.length <= 1) {
      return renderSingleGroupView(layout, customOrder, wasUnshuffled);
    }

    const seq = ++renderSeq;
    const targetIdx = activeIndex;
    const indices = current.indices;
    const order = customOrder || Array.from({ length: indices.length }, (_, i) => i);

    const previewKey = `${gallery.signature}|${indices.join(',')}|${layout}|${order.join(',')}`;
    const cached = previewUrlCache.get(previewKey);
    if (!cached || cached.revoked) ui.setBusy(true);

    try {
      const nextItem = await buildStitchedItem(indices, layout, order, wasUnshuffled);
      if (seq !== renderSeq || !galleryItems) return;
      galleryItems = galleryItems.slice();
      galleryItems[targetIdx] = nextItem;
      ui.showGallery({ items: galleryItems, activeIndex: targetIdx });
    } catch (err) {
      console.error('[XAS] Group re-stitch failed:', err);
      ui.setBusy(false);
      showToast(`Stitch failed: ${err.message}`, true);
    }
  };

  const handleDownload = async (idx = activeIndex) => {
    const item = getActiveItem(idx);
    if (!item) return;
    try {
      const format = config.downloadFormat || 'png';
      let blob;
      let layoutTag;

      if (item.type === 'stitched') {
        blob = item.pngBlob;
        if (format !== 'png') {
          const { canvas } = await renderCanvasForStitchedItem(item);
          blob = await canvasToBlob(canvas, format, config.downloadQuality);
        }
        layoutTag =
          galleryItems.length > 1
            ? `${item.layout}_p${formatIndexRange(item.indices).replace(/–/g, '-')}`
            : item.layout;
      } else {
        const origBlob = await fetchCachedOrigBlob(gallery.urls[item.index]);
        const targetMime =
          format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
        if (origBlob.type === targetMime) {
          blob = origBlob;
        } else {
          const decoded = await decodeImage(origBlob);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = decoded.width;
            canvas.height = decoded.height;
            canvas.getContext('2d').drawImage(decoded.source, 0, 0);
            blob = await canvasToBlob(canvas, format, config.downloadQuality);
          } finally {
            decoded.close();
          }
        }
        layoutTag = `p${item.index + 1}`;
      }

      const filename = formatFilename(config.filenameTemplate, {
        handle: gallery.handle,
        tweetId: gallery.tweetId,
        layout: layoutTag,
        ext: format,
      });
      downloadBlob(blob, filename);
      showToast(`Downloaded ${filename}`);
    } catch (err) {
      console.error('[XAS] Download failed:', err);
      showToast(`Download failed: ${err.message}`, true);
    }
  };

  const handleCopy = async (idx = activeIndex) => {
    const item = getActiveItem(idx);
    if (!item) return;
    try {
      if (item.type === 'stitched') {
        await copyPngBlobToClipboard(item.pngBlob);
        showToast('Copied stitched PNG to clipboard');
        return;
      }

      const pngPromise = (async () => {
        const origBlob = await fetchCachedOrigBlob(gallery.urls[item.index]);
        if (origBlob.type === 'image/png') return origBlob;
        const decoded = await decodeImage(origBlob);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = decoded.width;
          canvas.height = decoded.height;
          canvas.getContext('2d').drawImage(decoded.source, 0, 0);
          return await canvasToBlob(canvas, 'png');
        } finally {
          decoded.close();
        }
      })();
      await copyPngBlobToClipboard(pngPromise);
      showToast('Copied PNG to clipboard');
    } catch (err) {
      console.error('[XAS] Clipboard copy failed:', err);
      showToast(`Clipboard copy failed: ${err.message}`, true);
    }
  };

  const handleSelectGalleryItem = (idx) => {
    if (!galleryItems || idx < 0 || idx >= galleryItems.length) return;
    activeIndex = idx;
    refreshRevokedEntry(galleryItems[activeIndex]);
    ui.showGallery({ items: galleryItems, activeIndex });
  };

  const handleOpenLightbox = () => {
    if (!galleryItems || galleryItems.length === 0) return;
    const isMulti = galleryItems.length > 1;
    const lbItems = galleryItems.map((item) => {
      if (item.type === 'stitched') {
        refreshRevokedEntry(item);
        const rangePart = isMulti ? ` · #${formatIndexRange(item.indices)}` : '';
        return {
          url: item.objectUrl,
          title: `@${gallery.handle}${rangePart} · ${getLayoutLabel(item.layout)}`,
          width: item.width,
          height: item.height,
        };
      }
      return {
        url: buildMediaUrl(gallery.urls[item.index], 'orig'),
        title: `@${gallery.handle} · #${item.index + 1}`,
        width: item.width,
        height: item.height,
      };
    });

    openLightbox({
      items: lbItems,
      activeIndex,
      onSelectIndex: (nextIdx) => {
        if (galleryItems && nextIdx >= 0 && nextIdx < galleryItems.length) {
          activeIndex = nextIdx;
          ui.showGallery({ items: galleryItems, activeIndex });
        }
      },
      onDownload: (idx) => handleDownload(idx),
      onCopy: (idx) => handleCopy(idx),
    });
  };

  const handleAutoSolve = async (forcedLayout = null) => {
    const current = getActiveItem();
    const isMixedGroupOrderSolve = Boolean(
      forcedLayout && current && current.type === 'stitched' && galleryItems && galleryItems.length > 1,
    );

    ui.setBusy(true);
    try {
      if (isMixedGroupOrderSolve) {
        const subsetUrls = current.indices.map((i) => gallery.urls[i]);
        const subsetDims = current.indices.map((i) => gallery.origDims?.[i]);
        const rgbaList = await fetchThumbRgba(subsetUrls, subsetDims);
        const subResult = detectSplitArtwork(rgbaList, {
          ...getThresholds(config.sensitivity),
          allowUnshuffle: true,
        });
        const cand = subResult.bestByLayout?.[forcedLayout];
        if (cand) {
          const unshuffled = cand.order.some((v, idx) => v !== idx);
          await updateActiveStitchedGroup(forcedLayout, cand.order, unshuffled);
          return;
        }
        await updateActiveStitchedGroup(forcedLayout);
        return;
      }

      analysis = await analyzeGallery(gallery, { forceRecompute: true, allowUnshuffle: true });
      if (forcedLayout && analysis.bestByLayout[forcedLayout]) {
        const cand = analysis.bestByLayout[forcedLayout];
        const unshuffled = cand.order.some((v, idx) => v !== idx);
        await renderSingleGroupView(forcedLayout, cand.order, unshuffled);
        return;
      }
      if (analysis.isMatch && analysis.isPartial && analysis.groups?.length > 0) {
        await renderMixedGallery(analysis.groups);
        return;
      }
      if (analysis.winner) {
        const unshuffled = analysis.winner.order.some((v, idx) => v !== idx);
        await renderSingleGroupView(analysis.winner.layout, analysis.winner.order, unshuffled);
      } else {
        const fallbackLayout = getAvailableLayouts(gallery.urls.length)[0];
        await renderSingleGroupView(fallbackLayout);
      }
    } catch (err) {
      console.error('[XAS] Auto-solve failed:', err);
      ui.setBusy(false);
      showToast(`Auto-detect failed: ${err.message}`, true);
    }
  };

  const ui = createGalleryUI(gallery, {
    onSelectLayout(layout, customOrder, wasUnshuffled) {
      updateActiveStitchedGroup(layout, customOrder, wasUnshuffled);
    },
    onOpenMixedGallery(groups) {
      renderMixedGallery(groups);
    },
    onSelectGalleryItem: handleSelectGalleryItem,
    onAutoSolve(forcedLayout) {
      handleAutoSolve(forcedLayout);
    },
    onChangeOrder(nextOrder) {
      const current = getActiveItem();
      if (!current || current.type !== 'stitched') return;
      updateActiveStitchedGroup(current.layout, nextOrder, false);
    },
    onRestoreOriginal() {
      renderSeq++;
      galleryItems = null;
      activeIndex = 0;
      ui.showOriginal();
    },
    onOpenLightbox: handleOpenLightbox,
    onDownload: () => handleDownload(activeIndex),
    onCopy: () => handleCopy(activeIndex),
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
        if (!result.isMatch) return;

        if (result.isPartial && result.groups?.length > 0) {
          const stitchedGroups = result.groups.filter((g) => g.type === 'stitched');
          if (stitchedGroups.length === 0) return;
          ui.setSuggested({
            isPartial: true,
            groups: result.groups,
            stitchedCount: stitchedGroups.length,
            primaryGroup: stitchedGroups[0],
          });
          if (config.autoStitch && !galleryItems) {
            renderMixedGallery(result.groups);
          }
          return;
        }

        if (!result.winner) return;
        const suggestion = {
          isPartial: false,
          layout: result.winner.layout,
          order: result.winner.order,
          wasUnshuffled: result.wasUnshuffled,
        };
        ui.setSuggested(suggestion);

        if (config.autoStitch && !galleryItems) {
          renderSingleGroupView(suggestion.layout, suggestion.order, suggestion.wasUnshuffled);
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

function formatByteSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function selectVariantForGif(variants, maxWidth) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  if (maxWidth > 0) {
    const sufficient = variants.filter((v) => v.width >= maxWidth);
    if (sufficient.length > 0) {
      return sufficient[sufficient.length - 1];
    }
  }
  return variants[0];
}

function getProbeVariant(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  return variants[variants.length - 1] || variants[0];
}

async function fetchCachedMp4Blob(urls) {
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
  const cacheKey = uniqueUrls[0];
  let blob = cacheKey ? mp4BlobCache.get(cacheKey) : null;
  if (!blob) {
    blob = await fetchBlobWithFallback(uniqueUrls);
    if (cacheKey) mp4BlobCache.set(cacheKey, blob);
  }
  return blob;
}

function createVideoController(target) {
  const probeVariant = getProbeVariant(target.variants);
  const probeKey = target.mediaKey || probeVariant?.url || target.bestMp4Url;
  const cachedProbe = probeKey ? videoProbeCache.get(probeKey) : null;

  let classification = classifyGifMedia({
    type: target.type,
    mp4Url: target.bestMp4Url,
    posterUrl: target.posterUrl,
    hasGifBadge: target.hasGifBadge,
    durationMs: target.durationMs,
    mp4Probe: cachedProbe,
    maxAutoDurationSec: 12,
  });

  let probeStarted = Boolean(cachedProbe);
  let activeJob = null;

  const isVisible = () =>
    Boolean(config.enableGifTools && (classification !== 'video' || config.showOnRegularVideos));

  const handleExportGif = async () => {
    if (activeJob) return;
    const job = { cancelled: false };
    activeJob = job;

    const selected = selectVariantForGif(target.variants, config.gifMaxWidth);
    const candidateUrls = [selected?.url, target.bestMp4Url];

    ui.setProgress({ stage: 'fetch', progress: null });
    try {
      const mp4Blob = await fetchCachedMp4Blob(candidateUrls);
      if (job.cancelled) throw new Error('Cancelled');

      const result = await transcodeMp4BlobToGif(mp4Blob, {
        fps: Number(config.gifFps) || 15,
        maxWidth: Number(config.gifMaxWidth) || 0,
        quality: config.gifQuality || 'balanced',
        maxDurationSec: Number(config.gifMaxDuration) || 15,
        onProgress: (info) => {
          if (!job.cancelled) ui.setProgress(info);
        },
        isCancelled: () => job.cancelled,
      });

      if (job.cancelled) throw new Error('Cancelled');

      const layoutTag = target.videoCount > 1 ? `gif_v${target.videoIndex + 1}` : 'gif';
      const filename = formatFilename(config.filenameTemplate, {
        handle: target.handle,
        tweetId: target.tweetId,
        layout: layoutTag,
        ext: 'gif',
      });
      downloadBlob(result.blob, filename);

      const summary = `${result.width}×${result.height}, ${formatByteSize(result.blob.size)}`;
      const truncNote = result.truncated
        ? ` (first ${Number(config.gifMaxDuration) || 15}s)`
        : '';
      showToast(`Saved ${filename} (${summary})${truncNote}`);
    } catch (err) {
      if (job.cancelled || err?.message === 'Cancelled') {
        showToast(t('gifCancelled'));
      } else {
        console.error('[XAS] GIF export failed:', err);
        showToast(`GIF export failed: ${err.message}`, true);
      }
    } finally {
      if (activeJob === job) {
        activeJob = null;
      }
      ui.setProgress(null);
    }
  };

  const handleDownloadMp4 = async () => {
    if (activeJob) return;
    const job = { cancelled: false };
    activeJob = job;

    ui.setProgress({ stage: 'fetch', progress: null });
    try {
      const mp4Blob = await fetchCachedMp4Blob(target.variants.map((v) => v.url));
      if (job.cancelled) throw new Error('Cancelled');

      const layoutTag = target.videoCount > 1 ? `video_v${target.videoIndex + 1}` : 'video';
      const filename = formatFilename(config.filenameTemplate, {
        handle: target.handle,
        tweetId: target.tweetId,
        layout: layoutTag,
        ext: 'mp4',
      });
      downloadBlob(mp4Blob, filename);
      showToast(`Downloaded ${filename} (${formatByteSize(mp4Blob.size)})`);
    } catch (err) {
      if (job.cancelled || err?.message === 'Cancelled') {
        showToast(t('gifCancelled'));
      } else {
        console.error('[XAS] MP4 download failed:', err);
        showToast(`MP4 download failed: ${err.message}`, true);
      }
    } finally {
      if (activeJob === job) {
        activeJob = null;
      }
      ui.setProgress(null);
    }
  };

  const ui = createVideoUI(
    { ...target, classification, visible: isVisible() },
    {
      onExportGif: handleExportGif,
      onDownloadMp4: handleDownloadMp4,
      onCancel: () => {
        if (activeJob) activeJob.cancelled = true;
      },
      onOpenSettings: openSettings,
    },
  );

  const triggerAutoProbe = () => {
    if (
      probeStarted ||
      !config.enableGifTools ||
      !config.autoDetectGifVideos ||
      classification !== 'video' ||
      !(target.durationMs > 0 && target.durationMs <= 12000) ||
      !probeVariant?.url
    ) {
      return;
    }
    probeStarted = true;

    videoProbeQueue
      .enqueue(async () => {
        const cached = probeKey ? videoProbeCache.get(probeKey) : null;
        if (cached) return cached;
        const buf = await fetchRangeBuffer(probeVariant.url, 0, 65535);
        const parsed = parseMp4Metadata(buf);
        if (probeKey) videoProbeCache.set(probeKey, parsed);
        return parsed;
      })
      .then((mp4Probe) => {
        if (!target.container.isConnected) return;
        const nextClass = classifyGifMedia({
          type: target.type,
          mp4Url: target.bestMp4Url,
          posterUrl: target.posterUrl,
          hasGifBadge: target.hasGifBadge,
          durationMs: target.durationMs,
          mp4Probe,
          maxAutoDurationSec: 12,
        });

        debugLog('Probed video header', {
          handle: target.handle,
          tweetId: target.tweetId,
          durationMs: target.durationMs,
          hasMoov: mp4Probe.hasMoov,
          complete: mp4Probe.complete,
          hasAudio: mp4Probe.hasAudio,
          classification: nextClass,
        });

        if (nextClass !== classification) {
          classification = nextClass;
          ui.setClassification(classification);
          ui.setVisible(isVisible());
        }
      })
      .catch((err) => {
        debugLog('Video header probe skipped:', err);
      });
  };

  const controller = {
    target,
    signature: target.signature,
    triggerAutoProbe,
    refreshConfig() {
      ui.setVisible(isVisible());
      if (
        !probeStarted &&
        config.enableGifTools &&
        config.autoDetectGifVideos &&
        classification === 'video' &&
        target.durationMs > 0 &&
        target.durationMs <= 12000 &&
        visibilityObserver &&
        target.container.isConnected
      ) {
        visibilityObserver.observe(target.container);
      }
    },
    destroy() {
      if (activeJob) activeJob.cancelled = true;
      visibilityObserver?.unobserve(target.container);
      ui.destroy();
      activeVideoControllers.delete(controller);
    },
  };

  activeVideoControllers.add(controller);
  return controller;
}

function scanPage() {
  for (const ctrl of activeControllers) {
    if (!ctrl.gallery.container.isConnected) {
      activeControllers.delete(ctrl);
    }
  }
  for (const vctrl of activeVideoControllers) {
    if (!vctrl.target.container.isConnected) {
      activeVideoControllers.delete(vctrl);
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

    if (config.enableGifTools) {
      const videos = extractVideosFromArticle(article);
      for (const target of videos) {
        const existing = videoControllers.get(target.container);
        if (existing) {
          if (existing.signature === target.signature) continue;
          existing.destroy();
        }

        const vctrl = createVideoController(target);
        videoControllers.set(target.container, vctrl);
        if (config.autoDetectGifVideos && visibilityObserver) {
          visibilityObserver.observe(target.container);
        }
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
    for (const vctrl of activeVideoControllers) {
      if (vctrl.target.container.isConnected) {
        vctrl.refreshConfig();
      }
    }
    scheduleScan();
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
        let handled = false;
        const ctrl = containerControllers.get(entry.target);
        if (ctrl) {
          ctrl.triggerAutoDetect();
          handled = true;
        }
        const vctrl = videoControllers.get(entry.target);
        if (vctrl) {
          vctrl.triggerAutoProbe();
          handled = true;
        }
        if (handled) {
          visibilityObserver.unobserve(entry.target);
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
      if (
        mutation.type === 'attributes' &&
        (mutation.target.tagName === 'IMG' || mutation.target.tagName === 'VIDEO')
      ) {
        scheduleScan();
        return;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'poster'],
  });

  scheduleScan();
  debugLog('Initialized X Art Stitcher', config);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDom, { once: true });
} else {
  initDom();
}
