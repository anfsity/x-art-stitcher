// ==UserScript==
// @name              X Art Stitcher
// @name:zh-CN        X 画师拼图自动还原
// @namespace         https://github.com/anfsity/x-art-stitcher
// @version           1.0.0
// @description       Automatically detect, unshuffle, and stitch multi-image artist artworks on X (Twitter), including 2x2 grids and 20-image carousels, with fullscreen lightbox, lossless download, and clipboard copy.
// @description:zh-CN 自动识别并拼合 X (Twitter) 上画师发布的多图/四宫格/长图/多图轮播及防 AI 乱序切片作品，支持高清灯箱预览、原图下载与一键复制。
// @author            anfsity
// @license           Apache-2.0
// @homepageURL       https://github.com/anfsity/x-art-stitcher
// @supportURL        https://github.com/anfsity/x-art-stitcher/issues
// @updateURL         https://raw.githubusercontent.com/anfsity/x-art-stitcher/main/dist/x-art-stitcher.user.js
// @downloadURL       https://raw.githubusercontent.com/anfsity/x-art-stitcher/main/dist/x-art-stitcher.user.js
// @match             https://x.com/*
// @match             https://twitter.com/*
// @match             https://mobile.x.com/*
// @match             https://mobile.twitter.com/*
// @connect           pbs.twimg.com
// @grant             GM_xmlhttpRequest
// @grant             GM_addStyle
// @grant             GM_getValue
// @grant             GM_setValue
// @grant             GM_registerMenuCommand
// @grant             GM_download
// @grant             unsafeWindow
// @run-at            document-start
// ==/UserScript==

(() => {
  'use strict';

  // --- config.js ---
  const DEFAULT_CONFIG = {
    autoDetect: true,
    autoStitch: true,
    autoUnshuffle: true,
    sensitivity: 'normal', // 'strict' | 'normal' | 'loose'
    downloadFormat: 'png', // 'png' | 'jpeg' | 'webp'
    downloadQuality: 0.95,
    filenameTemplate: '@{handle}_{tweetId}_{layout}',
    debug: false,
  };

  const SENSITIVITY_PRESETS = {
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

  function loadConfig() {
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

  function saveConfig(config) {
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

  function getThresholds(sensitivity) {
    return SENSITIVITY_PRESETS[sensitivity] || SENSITIVITY_PRESETS.normal;
  }

  // --- gm.js ---
  function parseContentType(responseHeaders, fallbackUrl) {
    if (typeof responseHeaders === 'string') {
      const match = responseHeaders.match(/^content-type:\s*([^;\r\n]+)/im);
      if (match) return match[1].trim().toLowerCase();
    }
    if (/format=png|\.png(?:$|[?:])/i.test(fallbackUrl)) return 'image/png';
    if (/format=webp|\.webp(?:$|[?:])/i.test(fallbackUrl)) return 'image/webp';
    return 'image/jpeg';
  }

  function requestArrayBuffer(url) {
    return new Promise((resolve, reject) => {
      const gmRequest =
        typeof GM_xmlhttpRequest === 'function'
          ? GM_xmlhttpRequest
          : typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function'
            ? GM.xmlHttpRequest
            : null;

      if (!gmRequest) {
        fetch(url, { mode: 'cors' })
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buffer = await res.arrayBuffer();
            const type = res.headers.get('content-type') || parseContentType('', url);
            resolve(new Blob([buffer], { type }));
          })
          .catch(reject);
        return;
      }

      // Use arraybuffer instead of blob for consistent ScriptCat / Firefox sandbox behavior.
      gmRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        timeout: 25000,
        onload(res) {
          if (res.status >= 200 && res.status < 300 && res.response) {
            const type = parseContentType(res.responseHeaders, url);
            resolve(new Blob([res.response], { type }));
          } else {
            reject(new Error(`HTTP ${res.status} for ${url}`));
          }
        },
        onerror(err) {
          reject(new Error(`Network error for ${url}: ${err?.error || 'unknown'}`));
        },
        ontimeout() {
          reject(new Error(`Timeout fetching ${url}`));
        },
      });
    });
  }

  async function fetchBlobWithFallback(urls) {
    let lastError = null;
    for (const url of urls) {
      try {
        return await requestArrayBuffer(url);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Failed to fetch image');
  }

  async function decodeImage(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close() {
            try {
              bitmap.close();
            } catch (_) {
              // Already closed.
            }
          },
        };
      } catch (_) {
        // Fall back to HTMLImageElement decoding below.
      }
    }

    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          close() {},
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to decode image blob'));
      };
      img.src = objectUrl;
    });
  }

  function extractRgbaFromDecoded(decoded, maxDim = 512) {
    const scale = Math.min(1, maxDim / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return {
      width,
      height,
      origWidth: decoded.width,
      origHeight: decoded.height,
      data: imageData.data,
    };
  }

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').slice(0, 180);
  }

  function downloadBlob(blob, filename) {
    const safeName = sanitizeFilename(filename);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = safeName;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
  }

  async function copyPngBlobToClipboard(blobPromiseOrBlob) {
    const ClipboardItemCtor =
      typeof ClipboardItem !== 'undefined'
        ? ClipboardItem
        : typeof unsafeWindow !== 'undefined' && unsafeWindow.ClipboardItem
          ? unsafeWindow.ClipboardItem
          : null;

    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || !ClipboardItemCtor) {
      throw new Error('Image clipboard write is not supported in this browser environment');
    }

    // Pass the promise synchronously when possible so Firefox preserves the click user-activation token.
    try {
      const item = new ClipboardItemCtor({ 'image/png': Promise.resolve(blobPromiseOrBlob) });
      await navigator.clipboard.write([item]);
      return;
    } catch (err) {
      const resolvedBlob = await blobPromiseOrBlob;
      const item = new ClipboardItemCtor({ 'image/png': resolvedBlob });
      await navigator.clipboard.write([item]);
    }
  }

  function injectStyles(cssText) {
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(cssText);
      return;
    }
    const style = document.createElement('style');
    style.textContent = cssText;
    (document.head || document.documentElement).appendChild(style);
  }

  function registerMenu(label, callback, id) {
    if (typeof GM_registerMenuCommand !== 'function') return;
    try {
      GM_registerMenuCommand(label, callback, id ? { id } : undefined);
    } catch (_) {
      GM_registerMenuCommand(label, callback);
    }
  }

  // --- url.js ---
  function isTweetMediaUrl(src) {
    if (!src || typeof src !== 'string') return false;
    try {
      const u = new URL(src);
      return u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/');
    } catch (_) {
      return false;
    }
  }

  function buildMediaUrl(src, targetName) {
    const u = new URL(src);
    const legacyMatch = u.pathname.match(/^(\/media\/[^/.:]+)\.(jpg|jpeg|png|webp)(?::[a-z0-9_]+)?$/i);
    if (legacyMatch) {
      const ext = legacyMatch[2].toLowerCase();
      u.pathname = legacyMatch[1];
      u.searchParams.set('format', ext === 'jpeg' ? 'jpg' : ext);
    } else {
      const colonSuffix = u.pathname.match(/^(\/media\/[^:]+):[a-z0-9_]+$/i);
      if (colonSuffix) {
        u.pathname = colonSuffix[1];
      }
    }
    if (!u.searchParams.has('format')) {
      u.searchParams.set('format', 'jpg');
    }
    u.searchParams.set('name', targetName);
    return u.toString();
  }

  function getMediaVariantUrls(src, variant) {
    const urls = [];
    if (variant === 'thumb') {
      urls.push(buildMediaUrl(src, 'small'));
      urls.push(buildMediaUrl(src, 'medium'));
      urls.push(src);
    } else {
      urls.push(buildMediaUrl(src, 'orig'));
      urls.push(buildMediaUrl(src, 'large'));
      urls.push(src);
    }
    return Array.from(new Set(urls));
  }

  function parseStatusHref(href) {
    if (!href) return null;
    const match = href.match(/\/([^/]+)\/status\/(\d+)(?:\/photo\/(\d+))?/i);
    if (!match) return null;
    return {
      handle: match[1],
      tweetId: match[2],
      photoIndex: match[3] ? Number(match[3]) : null,
    };
  }

  function formatFilename(template, { handle, tweetId, layout, ext }) {
    const safeHandle = handle || 'x_artist';
    const safeTweetId = tweetId || String(Date.now());
    const safeLayout = layout || 'stitched';
    const base = (template || '@{handle}_{tweetId}_{layout}')
      .replace(/\{handle\}/g, safeHandle)
      .replace(/\{tweetId\}/g, safeTweetId)
      .replace(/\{layout\}/g, safeLayout);
    const cleanExt = ext === 'jpeg' ? 'jpg' : ext;
    return `${base}.${cleanExt}`;
  }

  // --- interceptor.js ---
  const MAX_REGISTRY_ENTRIES = 1200;
  const tweetMediaRegistry = new Map();
  const captureListeners = new Set();

  function storeTweetMedia(tweetId, entry) {
    if (!tweetId || !entry || !Array.isArray(entry.photos) || entry.photos.length < 2) return false;
    const existing = tweetMediaRegistry.get(tweetId);
    if (existing && existing.photos.length >= entry.photos.length) return false;

    if (tweetMediaRegistry.has(tweetId)) {
      tweetMediaRegistry.delete(tweetId);
    }
    tweetMediaRegistry.set(tweetId, entry);
    while (tweetMediaRegistry.size > MAX_REGISTRY_ENTRIES) {
      const oldestKey = tweetMediaRegistry.keys().next().value;
      tweetMediaRegistry.delete(oldestKey);
    }
    return true;
  }

  function getRegisteredTweetMedia(tweetId) {
    if (!tweetId) return null;
    return tweetMediaRegistry.get(String(tweetId)) || null;
  }

  function onTweetMediaCaptured(listener) {
    captureListeners.add(listener);
    return () => captureListeners.delete(listener);
  }

  function notifyCaptured() {
    for (const listener of captureListeners) {
      try {
        listener();
      } catch (_) {
        // Isolate listener errors.
      }
    }
  }

  function extractScreenName(tweetObj) {
    return (
      tweetObj?.core?.user_results?.result?.core?.screen_name ||
      tweetObj?.core?.user_results?.result?.legacy?.screen_name ||
      tweetObj?.user?.screen_name ||
      null
    );
  }

  function normalizePhotoMediaList(mediaList) {
    if (!Array.isArray(mediaList) || mediaList.length < 2) return null;
    const photos = [];
    for (const item of mediaList) {
      if (!item || item.type !== 'photo') continue;
      const url = item.media_url_https || item.media_url;
      if (!url || typeof url !== 'string') continue;
      photos.push({
        url,
        width: Number(item.original_info?.width) || 0,
        height: Number(item.original_info?.height) || 0,
      });
    }
    return photos.length >= 2 ? photos : null;
  }

  /**
   * Recursively walk an X GraphQL or REST JSON payload and index every multi-photo
   * tweet by rest_id. This captures all photos even when X virtualizes 5-20 image
   * carousels in the DOM.
   */
  function ingestGraphqlObject(root) {
    if (!root || typeof root !== 'object') return 0;

    let added = 0;
    const seen = new Set();
    const stack = [root];

    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
      seen.add(cur);

      if (Array.isArray(cur)) {
        for (let i = 0; i < cur.length; i++) {
          const v = cur[i];
          if (v && typeof v === 'object') stack.push(v);
        }
        continue;
      }

      const legacy = cur.legacy && typeof cur.legacy === 'object' ? cur.legacy : null;
      const tweetId = cur.rest_id || legacy?.id_str || cur.id_str;
      const mediaList =
        legacy?.extended_entities?.media ||
        cur.extended_entities?.media ||
        legacy?.entities?.media;

      if (tweetId && Array.isArray(mediaList)) {
        const photos = normalizePhotoMediaList(mediaList);
        if (photos) {
          const handle = extractScreenName(cur);
          if (storeTweetMedia(String(tweetId), { handle, photos })) {
            added++;
          }
        }
      }

      const keys = Object.keys(cur);
      for (let i = 0; i < keys.length; i++) {
        const val = cur[keys[i]];
        if (val && typeof val === 'object') {
          stack.push(val);
        }
      }
    }

    return added;
  }

  function ingestJsonText(text) {
    if (!text || typeof text !== 'string' || text.length < 40) return;
    if (!text.includes('pbs.twimg.com/media/')) return;
    try {
      const parsed = JSON.parse(text);
      const added = ingestGraphqlObject(parsed);
      if (added > 0) notifyCaptured();
    } catch (_) {
      // Ignore non-JSON or truncated responses.
    }
  }

  function isInterestingApiUrl(url) {
    if (typeof url !== 'string') return false;
    return (
      url.includes('/i/api/graphql/') ||
      url.includes('/i/api/2/') ||
      url.includes('/i/api/1.1/')
    );
  }

  /**
   * Fallback media extractor that reads tweet media entities directly from X's
   * React Fiber tree on an <article> node when a tweet rendered before network
   * interception attached.
   */
  function extractTweetMediaFromReactFiber(article, targetTweetId = null) {
    try {
      const raw = article?.wrappedJSObject || article;
      if (!raw) return null;

      const fiberKey = Object.keys(raw).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
      );
      if (!fiberKey) return null;

      const startFiber = raw[fiberKey];
      if (!startFiber) return null;

      const visited = new Set();
      const queue = [startFiber];
      let steps = 0;

      while (queue.length > 0 && steps < 60) {
        const fiber = queue.shift();
        if (!fiber || visited.has(fiber)) continue;
        visited.add(fiber);
        steps++;

        const props = fiber.memoizedProps;
        if (props && typeof props === 'object') {
          const candidates = [props.tweet, props.status, props.item?.content, props.data];
          for (const cand of candidates) {
            if (!cand || typeof cand !== 'object') continue;
            const id = cand.id_str || cand.rest_id || cand.legacy?.id_str;
            if (targetTweetId && id && String(id) !== String(targetTweetId)) continue;
            const mediaList =
              cand.extended_entities?.media ||
              cand.legacy?.extended_entities?.media ||
              cand.entities?.media;
            const photos = normalizePhotoMediaList(mediaList);
            if (photos) {
              const handle = extractScreenName(cand);
              if (id) storeTweetMedia(String(id), { handle, photos });
              return { handle, photos };
            }
          }
        }

        if (fiber.return) queue.push(fiber.return);
        if (fiber.child && steps < 25) queue.push(fiber.child);
      }
    } catch (_) {
      // Gracefully fall back to DOM extraction when Xray/React internals block access.
    }
    return null;
  }

  let interceptorInstalled = false;

  /**
   * Install passive, read-only hooks on XHR and fetch so X's own GraphQL tweet
   * responses populate the media registry without making any extra requests.
   * Preserves Firefox Xray boundaries by returning native Promises untouched and
   * exporting wrapper functions via exportFunction when available.
   */
  function installGraphqlInterceptor() {
    if (interceptorInstalled) return;
    interceptorInstalled = true;

    const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const canExport = typeof exportFunction === 'function';
    const wrapForPage = (fn) => (canExport ? exportFunction(fn, targetWin) : fn);

    // Hook XMLHttpRequest.prototype (primary transport used by X web client)
    try {
      const XHRProto = targetWin.XMLHttpRequest?.prototype;
      if (XHRProto && typeof XHRProto.open === 'function' && typeof XHRProto.send === 'function') {
        const xhrUrls = new WeakMap();
        const origOpen = XHRProto.open;
        const origSend = XHRProto.send;

        const hookedOpen = function (method, url) {
          try {
            if (typeof url === 'string' && isInterestingApiUrl(url)) {
              xhrUrls.set(this, url);
            }
          } catch (_) {
            // Never interfere with page XHR.
          }
          return Reflect.apply(origOpen, this, arguments);
        };

        const hookedSend = function () {
          try {
            if (xhrUrls.has(this)) {
              const onLoad = function () {
                try {
                  if (this.responseType === '' || this.responseType === 'text') {
                    ingestJsonText(this.responseText);
                  }
                } catch (_) {
                  // Ignore read errors.
                }
              };
              this.addEventListener('load', wrapForPage(onLoad));
            }
          } catch (_) {
            // Never interfere with page XHR.
          }
          return Reflect.apply(origSend, this, arguments);
        };

        XHRProto.open = wrapForPage(hookedOpen);
        XHRProto.send = wrapForPage(hookedSend);
      }
    } catch (err) {
      console.warn('[XAS] XHR interceptor skipped:', err);
    }

    // Hook fetch passively without replacing the native Promise returned to page code
    try {
      const origFetch = targetWin.fetch;
      if (typeof origFetch === 'function') {
        const hookedFetch = function (...args) {
          const nativePromise = Reflect.apply(origFetch, this, args);
          try {
            const req = args[0];
            const url = typeof req === 'string' ? req : req?.url || '';
            if (isInterestingApiUrl(url) && nativePromise && typeof nativePromise.then === 'function') {
              const onRes = (res) => {
                try {
                  if (res && typeof res.clone === 'function') {
                    const textPromise = res.clone().text();
                    textPromise.then(
                      wrapForPage((text) => ingestJsonText(text)),
                      wrapForPage(() => {}),
                    );
                  }
                } catch (_) {
                  // Ignore clone/read failures.
                }
              };
              nativePromise.then(wrapForPage(onRes), wrapForPage(() => {}));
            }
          } catch (_) {
            // Never interfere with page fetch.
          }
          return nativePromise;
        };

        targetWin.fetch = wrapForPage(hookedFetch);
      }
    } catch (err) {
      console.warn('[XAS] Fetch interceptor skipped:', err);
    }
  }

  // --- detector.js ---
  const DEFAULT_SAMPLES = 96;

  function clampByte(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function getAspect(img) {
    const w = img.origWidth || img.width;
    const h = img.origHeight || img.height;
    return w / Math.max(1, h);
  }

  function samplePixelRgb(img, x, y) {
    const cx = x < 0 ? 0 : x >= img.width ? img.width - 1 : x;
    const cy = y < 0 ? 0 : y >= img.height ? img.height - 1 : y;
    const idx = (cy * img.width + cx) * 4;
    return [img.data[idx], img.data[idx + 1], img.data[idx + 2]];
  }

  /**
   * Extract an edge strip (outer blended border + inner 2px inset) resampled via
   * box-filter averaging so thin line art crossing a cut is preserved.
   */
  function extractEdgeStrip(img, side, startFrac = 0, endFrac = 1, samples = DEFAULT_SAMPLES) {
    const isHorizontalEdge = side === 'top' || side === 'bottom';
    const totalLen = isHorizontalEdge ? img.width : img.height;
    const depth = isHorizontalEdge ? img.height : img.width;

    const pStart = Math.max(0, Math.min(totalLen - 1, Math.floor(startFrac * totalLen)));
    const pEnd = Math.max(pStart + 1, Math.min(totalLen, Math.ceil(endFrac * totalLen)));
    const segLen = pEnd - pStart;

    const outer = new Float32Array(samples * 3);
    const inner = new Float32Array(samples * 3);

    const d0 = side === 'top' || side === 'left' ? 0 : depth - 1;
    const d1 = side === 'top' || side === 'left' ? Math.min(1, depth - 1) : Math.max(0, depth - 2);
    const d2 = side === 'top' || side === 'left' ? Math.min(2, depth - 1) : Math.max(0, depth - 3);

    for (let k = 0; k < samples; k++) {
      let or = 0;
      let og = 0;
      let ob = 0;
      let ir = 0;
      let ig = 0;
      let ib = 0;

      if (segLen >= samples) {
        const b0 = pStart + Math.floor((k * segLen) / samples);
        const b1 = Math.max(b0 + 1, pStart + Math.floor(((k + 1) * segLen) / samples));
        const count = b1 - b0;
        for (let p = b0; p < b1; p++) {
          const px0 = isHorizontalEdge ? samplePixelRgb(img, p, d0) : samplePixelRgb(img, d0, p);
          const px1 = isHorizontalEdge ? samplePixelRgb(img, p, d1) : samplePixelRgb(img, d1, p);
          const px2 = isHorizontalEdge ? samplePixelRgb(img, p, d2) : samplePixelRgb(img, d2, p);
          or += 0.65 * px0[0] + 0.35 * px1[0];
          og += 0.65 * px0[1] + 0.35 * px1[1];
          ob += 0.65 * px0[2] + 0.35 * px1[2];
          ir += px2[0];
          ig += px2[1];
          ib += px2[2];
        }
        const inv = 1 / count;
        or *= inv;
        og *= inv;
        ob *= inv;
        ir *= inv;
        ig *= inv;
        ib *= inv;
      } else {
        const pos = pStart + (samples > 1 ? (k / (samples - 1)) * (segLen - 1) : 0);
        const p0 = Math.floor(pos);
        const p1 = Math.min(pEnd - 1, p0 + 1);
        const t = pos - p0;

        const a0 = isHorizontalEdge ? samplePixelRgb(img, p0, d0) : samplePixelRgb(img, d0, p0);
        const a1 = isHorizontalEdge ? samplePixelRgb(img, p0, d1) : samplePixelRgb(img, d1, p0);
        const a2 = isHorizontalEdge ? samplePixelRgb(img, p0, d2) : samplePixelRgb(img, d2, p0);
        const b0 = isHorizontalEdge ? samplePixelRgb(img, p1, d0) : samplePixelRgb(img, d0, p1);
        const b1 = isHorizontalEdge ? samplePixelRgb(img, p1, d1) : samplePixelRgb(img, d1, p1);
        const b2 = isHorizontalEdge ? samplePixelRgb(img, p1, d2) : samplePixelRgb(img, d2, p1);

        const o0r = 0.65 * a0[0] + 0.35 * a1[0];
        const o0g = 0.65 * a0[1] + 0.35 * a1[1];
        const o0b = 0.65 * a0[2] + 0.35 * a1[2];
        const o1r = 0.65 * b0[0] + 0.35 * b1[0];
        const o1g = 0.65 * b0[1] + 0.35 * b1[1];
        const o1b = 0.65 * b0[2] + 0.35 * b1[2];

        or = o0r + (o1r - o0r) * t;
        og = o0g + (o1g - o0g) * t;
        ob = o0b + (o1b - o0b) * t;
        ir = a2[0] + (b2[0] - a2[0]) * t;
        ig = a2[1] + (b2[1] - a2[1]) * t;
        ib = a2[2] + (b2[2] - a2[2]) * t;
      }

      const base = k * 3;
      outer[base] = or;
      outer[base + 1] = og;
      outer[base + 2] = ob;
      inner[base] = ir;
      inner[base + 1] = ig;
      inner[base + 2] = ib;
    }

    return { outer, inner, samples };
  }

  function rmsRgb(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
  }

  /**
   * Apply a lightweight 3-tap binomial filter [0.25, 0.5, 0.25] along the seam
   * so gradient correlation remains resilient to 1-2px diagonal shifts caused by
   * JPEG recompression or timeline gap cropping.
   */
  function smoothStrip(buf, samples) {
    const out = new Float32Array(samples * 3);
    for (let k = 0; k < samples; k++) {
      const prev = Math.max(0, k - 1) * 3;
      const curr = k * 3;
      const next = Math.min(samples - 1, k + 1) * 3;
      out[curr] = 0.25 * buf[prev] + 0.5 * buf[curr] + 0.25 * buf[next];
      out[curr + 1] = 0.25 * buf[prev + 1] + 0.5 * buf[curr + 1] + 0.25 * buf[next + 1];
      out[curr + 2] = 0.25 * buf[prev + 2] + 0.5 * buf[curr + 2] + 0.25 * buf[next + 2];
    }
    return out;
  }

  /**
   * Score visual continuity between two opposing edge strips.
   * Combines color agreement, linear-extrapolation smoothness, intra-image cliff
   * ratio, pooled 3-channel Pearson correlation (NCC), and smoothed along-seam
   * gradient correlation while guarding against flat-background false positives.
   */
  function scoreEdgePair(stripA, stripB, minActivity = 9) {
    const S = stripA.samples;
    const aO = stripA.outer;
    const aI = stripA.inner;
    const bO = stripB.outer;
    const bI = stripB.inner;

    const aSmooth = smoothStrip(aO, S);
    const bSmooth = smoothStrip(bO, S);

    const diffs = new Float32Array(S);
    let sumDiff = 0;
    let sumInner = 0;

    let meanAr = 0;
    let meanAg = 0;
    let meanAb = 0;
    let meanBr = 0;
    let meanBg = 0;
    let meanBb = 0;

    for (let k = 0; k < S; k++) {
      const idx = k * 3;
      const ar = aO[idx];
      const ag = aO[idx + 1];
      const ab = aO[idx + 2];
      const br = bO[idx];
      const bg = bO[idx + 1];
      const bb = bO[idx + 2];

      const air = aI[idx];
      const aig = aI[idx + 1];
      const aib = aI[idx + 2];
      const bir = bI[idx];
      const big = bI[idx + 1];
      const bib = bI[idx + 2];

      meanAr += ar;
      meanAg += ag;
      meanAb += ab;
      meanBr += br;
      meanBg += bg;
      meanBb += bb;

      const dDirect = rmsRgb(ar, ag, ab, br, bg, bb) / 255;

      // Linear extrapolation from 2px inside each image across the boundary.
      const pBr = clampByte(2 * ar - air);
      const pBg = clampByte(2 * ag - aig);
      const pBb = clampByte(2 * ab - aib);
      const pAr = clampByte(2 * br - bir);
      const pAg = clampByte(2 * bg - big);
      const pAb = clampByte(2 * bb - bib);
      const dPred =
        (0.5 * (rmsRgb(pBr, pBg, pBb, br, bg, bb) + rmsRgb(pAr, pAg, pAb, ar, ag, ab))) / 255;

      const dSmooth =
        rmsRgb(aSmooth[idx], aSmooth[idx + 1], aSmooth[idx + 2], bSmooth[idx], bSmooth[idx + 1], bSmooth[idx + 2]) /
        255;

      const d = Math.min(dDirect, 0.5 * dDirect + 0.5 * dPred, 0.6 * dDirect + 0.4 * dSmooth);
      diffs[k] = d;
      sumDiff += d;

      const dInA = rmsRgb(ar, ag, ab, air, aig, aib) / 255;
      const dInB = rmsRgb(br, bg, bb, bir, big, bib) / 255;
      sumInner += 0.5 * (dInA + dInB);
    }

    const invS = 1 / S;
    meanAr *= invS;
    meanAg *= invS;
    meanAb *= invS;
    meanBr *= invS;
    meanBg *= invS;
    meanBb *= invS;

    const meanDiff = sumDiff * invS;
    const dInner = sumInner * invS;

    const sortedDiffs = Float32Array.from(diffs).sort();
    const p75Diff = sortedDiffs[Math.min(S - 1, Math.floor(S * 0.75))];

    let varA = 0;
    let varB = 0;
    let covAB = 0;
    let gVarA = 0;
    let gVarB = 0;
    let gCovAB = 0;

    for (let k = 0; k < S; k++) {
      const idx = k * 3;
      const dar = aO[idx] - meanAr;
      const dag = aO[idx + 1] - meanAg;
      const dab = aO[idx + 2] - meanAb;
      const dbr = bO[idx] - meanBr;
      const dbg = bO[idx + 1] - meanBg;
      const dbb = bO[idx + 2] - meanBb;

      varA += dar * dar + dag * dag + dab * dab;
      varB += dbr * dbr + dbg * dbg + dbb * dbb;
      covAB += dar * dbr + dag * dbg + dab * dbb;

      if (k + 1 < S) {
        const nIdx = idx + 3;
        const gar = aSmooth[nIdx] - aSmooth[idx];
        const gag = aSmooth[nIdx + 1] - aSmooth[idx + 1];
        const gab = aSmooth[nIdx + 2] - aSmooth[idx + 2];
        const gbr = bSmooth[nIdx] - bSmooth[idx];
        const gbg = bSmooth[nIdx + 1] - bSmooth[idx + 1];
        const gbb = bSmooth[nIdx + 2] - bSmooth[idx + 2];

        gVarA += gar * gar + gag * gag + gab * gab;
        gVarB += gbr * gbr + gbg * gbg + gbb * gbb;
        gCovAB += gar * gbr + gag * gbg + gab * gbb;
      }
    }

    const stdA = Math.sqrt(varA / (S * 3));
    const stdB = Math.sqrt(varB / (S * 3));
    const activity = Math.min(stdA, stdB);

    const ncc = varA > 1e-3 && varB > 1e-3 ? covAB / Math.sqrt(varA * varB) : 0;
    const gradNcc = gVarA > 1e-3 && gVarB > 1e-3 ? gCovAB / Math.sqrt(gVarA * gVarB) : 0;

    const colorScore = 0.65 * Math.exp(-meanDiff / 0.12) + 0.35 * Math.exp(-p75Diff / 0.18);
    const cliffRatio = meanDiff / (dInner + 0.032);
    const continuityFactor = Math.exp(-Math.max(0, cliffRatio - 1.5) * 0.35);
    const structScore = Math.max(0, Math.min(1, 0.78 * Math.max(0, ncc) + 0.22 * Math.max(0, gradNcc)));

    const isActive = activity >= minActivity * 0.6;
    let score;
    if (isActive) {
      score = 0.50 * (colorScore * continuityFactor) + 0.50 * structScore;
    } else {
      // Low-variance (e.g. plain sky/background) seams cannot reliably correlate:
      // keep matching flat seams neutral so they neither trigger alone nor ruin a valid split.
      score = meanDiff < 0.045 ? Math.min(0.66, colorScore * 0.72) : colorScore * 0.40;
    }

    return {
      score,
      activity,
      isActive,
      meanDiff,
      p75Diff,
      ncc,
      gradNcc,
    };
  }

  function getPermutations(n) {
    const result = [];
    const arr = Array.from({ length: n }, (_, i) => i);
    function permute(start) {
      if (start === n) {
        result.push(arr.slice());
        return;
      }
      for (let i = start; i < n; i++) {
        [arr[start], arr[i]] = [arr[i], arr[start]];
        permute(start + 1);
        [arr[start], arr[i]] = [arr[i], arr[start]];
      }
    }
    permute(0);
    return result;
  }

  function isNaturalOrder(order) {
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== i) return false;
    }
    return true;
  }

  function aggregateCandidate(layout, order, seams, geomScore, minActivity) {
    if (geomScore <= 0 || seams.length === 0) {
      return null;
    }

    let sumAll = 0;
    let sumActive = 0;
    let activeCount = 0;
    let maxActivity = 0;
    const scores = new Array(seams.length);

    for (let i = 0; i < seams.length; i++) {
      const seam = seams[i];
      scores[i] = seam.score;
      sumAll += seam.score;
      if (seam.activity > maxActivity) maxActivity = seam.activity;
      if (seam.isActive) {
        sumActive += seam.score;
        activeCount++;
      }
    }

    scores.sort((a, b) => a - b);
    // For long multi-slice strips (N >= 6), use the 10th-percentile seam so one
    // noisy margin cut does not veto 10+ strongly matching seams.
    const floorIdx = seams.length >= 6 ? Math.floor(seams.length * 0.1) : 0;
    const minSeamScore = scores[floorIdx];

    const meanScore = sumAll / seams.length;
    const activeMeanScore = activeCount > 0 ? sumActive / activeCount : 0;

    // Reject all-flat arrangements (e.g. separate sketches floating on white canvas).
    if (activeCount === 0 || maxActivity < minActivity) {
      return {
        layout,
        order,
        composite: 0,
        meanScore,
        minSeamScore,
        activeMeanScore,
        activeCount,
        maxActivity,
        geomScore,
        seams,
      };
    }

    const rawComposite = 0.50 * activeMeanScore + 0.25 * meanScore + 0.25 * minSeamScore;
    const composite = rawComposite * geomScore;

    return {
      layout,
      order,
      composite,
      meanScore,
      minSeamScore,
      activeMeanScore,
      activeCount,
      maxActivity,
      geomScore,
      seams,
    };
  }

  function buildGreedyChainOrder(n, matrix) {
    let bestOrder = Array.from({ length: n }, (_, i) => i);
    let bestSum = -1;

    for (let start = 0; start < n; start++) {
      const used = new Uint8Array(n);
      const order = [start];
      used[start] = 1;
      let sum = 0;

      while (order.length < n) {
        const tail = order[order.length - 1];
        let bestNext = -1;
        let bestScore = -1;
        for (let cand = 0; cand < n; cand++) {
          if (used[cand]) continue;
          const s = matrix[tail][cand].score;
          if (s > bestScore) {
            bestScore = s;
            bestNext = cand;
          }
        }
        if (bestNext === -1) break;
        order.push(bestNext);
        used[bestNext] = 1;
        sum += bestScore;
      }

      if (sum > bestSum) {
        bestSum = sum;
        bestOrder = order;
      }
    }

    return bestOrder;
  }

  function getGridFactors(n) {
    const pairs = [];
    for (let rows = 2; rows * rows <= n; rows++) {
      if (n % rows === 0) {
        const cols = n / rows;
        pairs.push([rows, cols]);
        if (rows !== cols) pairs.push([cols, rows]);
      }
    }
    return pairs;
  }

  function computeGridGeomScore(rows, cols, order, aspects) {
    let maxErr = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const tl = order[r * cols + c];
        const tr = order[r * cols + c + 1];
        const bl = order[(r + 1) * cols + c];
        const br = order[(r + 1) * cols + c + 1];
        const ratio = (aspects[tl] * aspects[br]) / Math.max(1e-6, aspects[tr] * aspects[bl]);
        const err = Math.abs(Math.log(ratio));
        if (err > maxErr) maxErr = err;
      }
    }
    if (maxErr > 0.24) return 0;
    return Math.exp(-Math.max(0, maxErr - 0.03) * 3.5);
  }

  /**
   * Analyze N decoded thumbnail RGBA buffers and determine whether they form a
   * split artwork, along with the optimal layout and unshuffled tile order.
   */
  function detectSplitArtwork(images, options = {}) {
    const n = images.length;
    if (n < 2) {
      return {
        isMatch: false,
        winner: null,
        wasUnshuffled: false,
        bestByLayout: {},
      };
    }

    const minComposite = options.minComposite ?? 0.60;
    const minSeam = options.minSeam ?? 0.40;
    const minActivity = options.minActivity ?? 9;
    const unshuffleMargin = options.unshuffleMargin ?? 0.10;
    const allowUnshuffle = options.allowUnshuffle ?? true;

    const fullEdges = images.map((img) => ({
      top: extractEdgeStrip(img, 'top'),
      bottom: extractEdgeStrip(img, 'bottom'),
      left: extractEdgeStrip(img, 'left'),
      right: extractEdgeStrip(img, 'right'),
    }));

    const aspects = images.map(getAspect);

    // Pairwise horizontal (i left of j) and vertical (i above j) seam score matrices.
    const H = Array.from({ length: n }, () => new Array(n));
    const V = Array.from({ length: n }, () => new Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        H[i][j] = scoreEdgePair(fullEdges[i].right, fullEdges[j].left, minActivity);
        V[i][j] = scoreEdgePair(fullEdges[i].bottom, fullEdges[j].top, minActivity);
      }
    }

    const candidates = [];
    const pushCandidate = (cand) => {
      if (cand) candidates.push(cand);
    };

    if (n <= 4) {
      const perms = getPermutations(n);

      // 1xN horizontal & Nx1 vertical
      for (const order of perms) {
        const hSeams = [];
        const vSeams = [];
        for (let i = 0; i < n - 1; i++) {
          hSeams.push(H[order[i]][order[i + 1]]);
          vSeams.push(V[order[i]][order[i + 1]]);
        }
        pushCandidate(aggregateCandidate('horizontal', order, hSeams, 1.0, minActivity));
        pushCandidate(aggregateCandidate('vertical', order, vSeams, 1.0, minActivity));
      }

      // Special 3-image X layouts (1 tall + 2 stacked, or 1 wide + 2 side-by-side)
      if (n === 3) {
        const subEdgeCache = new Map();
        const getSubEdge = (imgIdx, side, startFrac, endFrac) => {
          const key = `${imgIdx}:${side}:${startFrac.toFixed(4)}:${endFrac.toFixed(4)}`;
          let strip = subEdgeCache.get(key);
          if (!strip) {
            strip = extractEdgeStrip(images[imgIdx], side, startFrac, endFrac);
            subEdgeCache.set(key, strip);
          }
          return strip;
        };

        for (const order of perms) {
          // 3-left-tall: [left, topRight, botRight]
          {
            const [left, tr, br] = order;
            const invTr = 1 / aspects[tr];
            const invBr = 1 / aspects[br];
            const splitFrac = invTr / (invTr + invBr);
            if (splitFrac >= 0.15 && splitFrac <= 0.85) {
              const leftTop = getSubEdge(left, 'right', 0, splitFrac);
              const leftBot = getSubEdge(left, 'right', splitFrac, 1);
              const seams = [
                V[tr][br],
                scoreEdgePair(leftTop, fullEdges[tr].left, minActivity),
                scoreEdgePair(leftBot, fullEdges[br].left, minActivity),
              ];
              pushCandidate(aggregateCandidate('3-left-tall', order, seams, 1.0, minActivity));
            }
          }

          // 3-right-tall: [topLeft, botLeft, right]
          {
            const [tl, bl, right] = order;
            const invTl = 1 / aspects[tl];
            const invBl = 1 / aspects[bl];
            const splitFrac = invTl / (invTl + invBl);
            if (splitFrac >= 0.15 && splitFrac <= 0.85) {
              const rightTop = getSubEdge(right, 'left', 0, splitFrac);
              const rightBot = getSubEdge(right, 'left', splitFrac, 1);
              const seams = [
                V[tl][bl],
                scoreEdgePair(fullEdges[tl].right, rightTop, minActivity),
                scoreEdgePair(fullEdges[bl].right, rightBot, minActivity),
              ];
              pushCandidate(aggregateCandidate('3-right-tall', order, seams, 1.0, minActivity));
            }
          }

          // 3-top-wide: [top, botLeft, botRight]
          {
            const [top, bl, br] = order;
            const splitFrac = aspects[bl] / (aspects[bl] + aspects[br]);
            if (splitFrac >= 0.15 && splitFrac <= 0.85) {
              const topLeft = getSubEdge(top, 'bottom', 0, splitFrac);
              const topRight = getSubEdge(top, 'bottom', splitFrac, 1);
              const seams = [
                H[bl][br],
                scoreEdgePair(topLeft, fullEdges[bl].top, minActivity),
                scoreEdgePair(topRight, fullEdges[br].top, minActivity),
              ];
              pushCandidate(aggregateCandidate('3-top-wide', order, seams, 1.0, minActivity));
            }
          }

          // 3-bottom-wide: [topLeft, topRight, bottom]
          {
            const [tl, tr, bottom] = order;
            const splitFrac = aspects[tl] / (aspects[tl] + aspects[tr]);
            if (splitFrac >= 0.15 && splitFrac <= 0.85) {
              const botLeft = getSubEdge(bottom, 'top', 0, splitFrac);
              const botRight = getSubEdge(bottom, 'top', splitFrac, 1);
              const seams = [
                H[tl][tr],
                scoreEdgePair(fullEdges[tl].bottom, botLeft, minActivity),
                scoreEdgePair(fullEdges[tr].bottom, botRight, minActivity),
              ];
              pushCandidate(aggregateCandidate('3-bottom-wide', order, seams, 1.0, minActivity));
            }
          }
        }
      }

      // 2x2 grid for 4 images
      if (n === 4) {
        for (const order of perms) {
          const geomScore = computeGridGeomScore(2, 2, order, aspects);
          if (geomScore <= 0) continue;
          const [tl, tr, bl, br] = order;
          const seams = [H[tl][tr], H[bl][br], V[tl][bl], V[tr][br]];
          pushCandidate(aggregateCandidate('grid-2x2', order, seams, geomScore, minActivity));
        }
      }
    } else {
      // N > 4 (e.g. X's 5-20 photo carousel strips): evaluate natural strips,
      // greedy unshuffled strips, and geometrically valid factor grids.
      const natural = Array.from({ length: n }, (_, i) => i);
      const evalStrip = (layout, order, matrix) => {
        const seams = [];
        for (let i = 0; i < n - 1; i++) {
          seams.push(matrix[order[i]][order[i + 1]]);
        }
        pushCandidate(aggregateCandidate(layout, order, seams, 1.0, minActivity));
      };

      evalStrip('horizontal', natural, H);
      evalStrip('vertical', natural, V);

      if (allowUnshuffle) {
        evalStrip('horizontal', buildGreedyChainOrder(n, H), H);
        evalStrip('vertical', buildGreedyChainOrder(n, V), V);
      }

      for (const [rows, cols] of getGridFactors(n)) {
        const geomScore = computeGridGeomScore(rows, cols, natural, aspects);
        if (geomScore <= 0) continue;
        const seams = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (c + 1 < cols) seams.push(H[idx][idx + 1]);
            if (r + 1 < rows) seams.push(V[idx][idx + cols]);
          }
        }
        pushCandidate(aggregateCandidate(`grid-${rows}x${cols}`, natural, seams, geomScore, minActivity));
      }
    }

    // Track best candidate overall, best natural-order candidate, and best per layout.
    const bestByLayout = {};
    let bestNatural = null;
    let bestAny = null;

    for (const cand of candidates) {
      const prevLayout = bestByLayout[cand.layout];
      if (!prevLayout || cand.composite > prevLayout.composite) {
        bestByLayout[cand.layout] = cand;
      }

      if (!bestAny || cand.composite > bestAny.composite) {
        bestAny = cand;
      }

      if (isNaturalOrder(cand.order)) {
        if (!bestNatural || cand.composite > bestNatural.composite) {
          bestNatural = cand;
        }
      }
    }

    let winner = bestNatural;
    let wasUnshuffled = false;

    if (allowUnshuffle && bestAny) {
      if (!bestNatural) {
        winner = bestAny;
        wasUnshuffled = !isNaturalOrder(bestAny.order);
      } else if (
        !isNaturalOrder(bestAny.order) &&
        bestAny.composite >= bestNatural.composite + unshuffleMargin
      ) {
        winner = bestAny;
        wasUnshuffled = true;
      }
    }

    const requiredActiveSeams = winner && winner.seams.length >= 4 ? 2 : 1;
    const isMatch = Boolean(
      winner &&
        winner.composite >= minComposite &&
        winner.minSeamScore >= minSeam &&
        winner.activeCount >= requiredActiveSeams,
    );

    return {
      isMatch,
      winner,
      wasUnshuffled: isMatch && wasUnshuffled,
      bestByLayout,
    };
  }

  // --- stitcher.js ---
  const MAX_CANVAS_EDGE = 16000;
  const MAX_CANVAS_PIXELS = 120_000_000;

  function parseGridLayout(layout) {
    if (layout === 'grid-2x2') return { rows: 2, cols: 2 };
    const match = /^grid-(\d+)x(\d+)$/.exec(layout);
    if (!match) return null;
    return { rows: Number(match[1]), cols: Number(match[2]) };
  }

  /**
   * Compute pixel-accurate tile placement rectangles for the requested layout.
   * Preserves 1:1 native resolution whenever source dimensions align cleanly.
   */
  function computeLayoutPlan(images, layout, order) {
    const ordered = order.map((idx) => images[idx]);
    const rects = [];
    let width = 0;
    let height = 0;

    if (layout === 'horizontal') {
      height = Math.max(...ordered.map((img) => img.height));
      let x = 0;
      for (const img of ordered) {
        const w = img.height === height ? img.width : Math.round((img.width * height) / img.height);
        rects.push({ img, x, y: 0, w, h: height });
        x += w;
      }
      width = x;
    } else if (layout === 'vertical') {
      width = Math.max(...ordered.map((img) => img.width));
      let y = 0;
      for (const img of ordered) {
        const h = img.width === width ? img.height : Math.round((img.height * width) / img.width);
        rects.push({ img, x: 0, y, w: width, h });
        y += h;
      }
      height = y;
    } else if (layout === '3-left-tall' && ordered.length === 3) {
      const [left, tr, br] = ordered;
      const rightBaseW = Math.max(tr.width, br.width);
      const trH0 = tr.width === rightBaseW ? tr.height : Math.round((tr.height * rightBaseW) / tr.width);
      const brH0 = br.width === rightBaseW ? br.height : Math.round((br.height * rightBaseW) / br.width);
      const rightTotalH0 = trH0 + brH0;

      height = Math.max(left.height, rightTotalH0);
      const leftScale = height / left.height;
      const rightScale = height / rightTotalH0;

      const leftW = leftScale === 1 ? left.width : Math.round(left.width * leftScale);
      const rightW = rightScale === 1 ? rightBaseW : Math.round(rightBaseW * rightScale);
      const trH = rightScale === 1 ? trH0 : Math.round(trH0 * rightScale);
      const brH = height - trH;

      rects.push({ img: left, x: 0, y: 0, w: leftW, h: height });
      rects.push({ img: tr, x: leftW, y: 0, w: rightW, h: trH });
      rects.push({ img: br, x: leftW, y: trH, w: rightW, h: brH });
      width = leftW + rightW;
    } else if (layout === '3-right-tall' && ordered.length === 3) {
      const [tl, bl, right] = ordered;
      const leftBaseW = Math.max(tl.width, bl.width);
      const tlH0 = tl.width === leftBaseW ? tl.height : Math.round((tl.height * leftBaseW) / tl.width);
      const blH0 = bl.width === leftBaseW ? bl.height : Math.round((bl.height * leftBaseW) / bl.width);
      const leftTotalH0 = tlH0 + blH0;

      height = Math.max(right.height, leftTotalH0);
      const leftScale = height / leftTotalH0;
      const rightScale = height / right.height;

      const leftW = leftScale === 1 ? leftBaseW : Math.round(leftBaseW * leftScale);
      const rightW = rightScale === 1 ? right.width : Math.round(right.width * rightScale);
      const tlH = leftScale === 1 ? tlH0 : Math.round(tlH0 * leftScale);
      const blH = height - tlH;

      rects.push({ img: tl, x: 0, y: 0, w: leftW, h: tlH });
      rects.push({ img: bl, x: 0, y: tlH, w: leftW, h: blH });
      rects.push({ img: right, x: leftW, y: 0, w: rightW, h: height });
      width = leftW + rightW;
    } else if (layout === '3-top-wide' && ordered.length === 3) {
      const [top, bl, br] = ordered;
      const botBaseH = Math.max(bl.height, br.height);
      const blW0 = bl.height === botBaseH ? bl.width : Math.round((bl.width * botBaseH) / bl.height);
      const brW0 = br.height === botBaseH ? br.width : Math.round((br.width * botBaseH) / br.height);
      const botTotalW0 = blW0 + brW0;

      width = Math.max(top.width, botTotalW0);
      const topScale = width / top.width;
      const botScale = width / botTotalW0;

      const topH = topScale === 1 ? top.height : Math.round(top.height * topScale);
      const botH = botScale === 1 ? botBaseH : Math.round(botBaseH * botScale);
      const blW = botScale === 1 ? blW0 : Math.round(blW0 * botScale);
      const brW = width - blW;

      rects.push({ img: top, x: 0, y: 0, w: width, h: topH });
      rects.push({ img: bl, x: 0, y: topH, w: blW, h: botH });
      rects.push({ img: br, x: blW, y: topH, w: brW, h: botH });
      height = topH + botH;
    } else if (layout === '3-bottom-wide' && ordered.length === 3) {
      const [tl, tr, bottom] = ordered;
      const topBaseH = Math.max(tl.height, tr.height);
      const tlW0 = tl.height === topBaseH ? tl.width : Math.round((tl.width * topBaseH) / tl.height);
      const trW0 = tr.height === topBaseH ? tr.width : Math.round((tr.width * topBaseH) / tr.height);
      const topTotalW0 = tlW0 + trW0;

      width = Math.max(bottom.width, topTotalW0);
      const topScale = width / topTotalW0;
      const botScale = width / bottom.width;

      const topH = topScale === 1 ? topBaseH : Math.round(topBaseH * topScale);
      const botH = botScale === 1 ? bottom.height : Math.round(bottom.height * botScale);
      const tlW = topScale === 1 ? tlW0 : Math.round(tlW0 * topScale);
      const trW = width - tlW;

      rects.push({ img: tl, x: 0, y: 0, w: tlW, h: topH });
      rects.push({ img: tr, x: tlW, y: 0, w: trW, h: topH });
      rects.push({ img: bottom, x: 0, y: topH, w: width, h: botH });
      height = topH + botH;
    } else {
      const grid = parseGridLayout(layout);
      if (!grid || grid.rows * grid.cols !== ordered.length) {
        return computeLayoutPlan(images, 'vertical', order);
      }

      const rowInfos = [];
      for (let r = 0; r < grid.rows; r++) {
        const rowImgs = ordered.slice(r * grid.cols, (r + 1) * grid.cols);
        const rowH = Math.max(...rowImgs.map((img) => img.height));
        const widths = rowImgs.map((img) =>
          img.height === rowH ? img.width : Math.round((img.width * rowH) / img.height),
        );
        const totalW = widths.reduce((acc, w) => acc + w, 0);
        rowInfos.push({ rowImgs, rowH, widths, totalW });
      }

      width = Math.max(...rowInfos.map((info) => info.totalW));
      let y = 0;
      for (const info of rowInfos) {
        const scale = width / info.totalW;
        const scaledH = scale === 1 ? info.rowH : Math.round(info.rowH * scale);
        let x = 0;
        for (let c = 0; c < info.rowImgs.length; c++) {
          const isLast = c === info.rowImgs.length - 1;
          const scaledW = isLast ? width - x : scale === 1 ? info.widths[c] : Math.round(info.widths[c] * scale);
          rects.push({ img: info.rowImgs[c], x, y, w: scaledW, h: scaledH });
          x += scaledW;
        }
        y += scaledH;
      }
      height = y;
    }

    // Clamp canvas dimensions to browser-safe limits while preserving aspect ratio.
    let downscale = 1;
    if (width > MAX_CANVAS_EDGE) downscale = Math.min(downscale, MAX_CANVAS_EDGE / width);
    if (height > MAX_CANVAS_EDGE) downscale = Math.min(downscale, MAX_CANVAS_EDGE / height);
    if (width * height * downscale * downscale > MAX_CANVAS_PIXELS) {
      downscale = Math.min(downscale, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
    }

    if (downscale < 1) {
      width = Math.max(1, Math.floor(width * downscale));
      height = Math.max(1, Math.floor(height * downscale));
      for (const rect of rects) {
        rect.x = Math.floor(rect.x * downscale);
        rect.y = Math.floor(rect.y * downscale);
        rect.w = Math.max(1, Math.floor(rect.w * downscale));
        rect.h = Math.max(1, Math.floor(rect.h * downscale));
      }
    }

    return { width, height, rects, downscale };
  }

  function renderStitchedCanvas(decodedImages, layout, order) {
    const plan = computeLayoutPlan(decodedImages, layout, order);
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    for (const rect of plan.rects) {
      ctx.drawImage(rect.img.source, rect.x, rect.y, rect.w, rect.h);
    }

    return { canvas, width: plan.width, height: plan.height };
  }

  function canvasToBlob(canvas, format = 'png', quality = 0.95) {
    const mimeType =
      format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error(`Failed to encode stitched canvas as ${mimeType}`));
        },
        mimeType,
        format === 'png' ? undefined : quality,
      );
    });
  }

  function getAvailableLayouts(count) {
    if (count === 2) return ['horizontal', 'vertical'];
    if (count === 3) {
      return ['3-left-tall', '3-right-tall', '3-top-wide', '3-bottom-wide', 'horizontal', 'vertical'];
    }
    if (count === 4) return ['grid-2x2', 'horizontal', 'vertical'];

    const layouts = ['horizontal', 'vertical'];
    for (let rows = 2; rows * rows <= count; rows++) {
      if (count % rows === 0) {
        const cols = count / rows;
        layouts.unshift(`grid-${rows}x${cols}`);
        if (rows !== cols) layouts.unshift(`grid-${cols}x${rows}`);
      }
    }
    return layouts;
  }

  // --- dom.js ---
  function findLowestCommonAncestor(elements, boundary) {
    if (elements.length === 0) return null;
    let lca = elements[0].parentElement;
    for (let i = 1; i < elements.length; i++) {
      while (lca && lca !== boundary && !lca.contains(elements[i])) {
        lca = lca.parentElement;
      }
    }
    return lca && lca !== boundary ? lca : null;
  }

  function isMediaFrameSafe(el, article, isQuoted) {
    if (!el || el === article) return false;
    if (el.getAttribute('role') === 'link') return false;
    if (el.getAttribute('data-testid') === 'tweet') return false;
    if (el.querySelector('[data-testid="tweetText"]')) return false;
    if (el.querySelector('[data-testid="User-Name"]')) return false;
    if (el.querySelector('[role="group"]')) return false;
    if (el.querySelector('time')) return false;
    if (el.querySelector('[data-testid="card.wrapper"]')) return false;
    if (el.querySelector('[data-testid="cardPoll"]')) return false;
    if (el.querySelector('[data-testid="birdwatch-pivot"]')) return false;
    if (!isQuoted && el.querySelector('[tabindex="0"][role="link"]')) return false;
    return true;
  }

  /**
   * Climb from the photo LCA to the outermost media frame inside the tweet
   * article. This naturally encompasses React Native Web aspect-ratio spacers
   * as well as multi-image carousel tracks, arrows, and pagination controls.
   */
  function resolveGalleryContainer(photoEls, article, isQuoted) {
    let container = findLowestCommonAncestor(photoEls, article);
    if (!container || !isMediaFrameSafe(container, article, isQuoted)) {
      return null;
    }

    while (
      container.parentElement &&
      container.parentElement !== article &&
      isMediaFrameSafe(container.parentElement, article, isQuoted)
    ) {
      container = container.parentElement;
    }

    return container;
  }

  function getFallbackStatusInfo(article) {
    const timeEl = article.querySelector('time');
    const timeLink = timeEl ? timeEl.closest('a[href*="/status/"]') : null;
    if (timeLink) {
      const parsed = parseStatusHref(timeLink.getAttribute('href'));
      if (parsed) return parsed;
    }
    const pageParsed = parseStatusHref(window.location.pathname);
    if (pageParsed) return pageParsed;
    return { handle: 'x_artist', tweetId: 'unknown', photoIndex: null };
  }

  function normalizeSignatureKey(url) {
    try {
      return new URL(url).pathname.replace(/\.(jpg|jpeg|png|webp)(?::[a-z0-9_]+)?$/i, '');
    } catch (_) {
      return url;
    }
  }

  /**
   * Scan a tweet <article> and extract independent multi-image galleries.
   * Combines passive GraphQL / React Fiber media metadata with DOM photos so
   * virtualized 5-20 image carousels still resolve all slices immediately, and
   * quoted tweets are never merged with the outer tweet.
   */
  function extractGalleriesFromArticle(article) {
    const photoNodes = Array.from(article.querySelectorAll('[data-testid="tweetPhoto"]'));
    if (photoNodes.length === 0) return [];

    const fallbackMeta = getFallbackStatusInfo(article);
    const groups = new Map();

    for (let domIdx = 0; domIdx < photoNodes.length; domIdx++) {
      const photoNode = photoNodes[domIdx];

      if (photoNode.closest('.xas-injected')) continue;
      if (photoNode.closest('[data-testid="videoPlayer"]')) continue;
      if (photoNode.closest('[data-testid="card.wrapper"]')) continue;

      const img = photoNode.querySelector('img');
      const src = img && isTweetMediaUrl(img.src) ? img.src : null;

      const anchor = photoNode.closest('a[href*="/status/"]');
      const parsed = anchor ? parseStatusHref(anchor.getAttribute('href')) : null;
      const isQuoted = Boolean(photoNode.closest('[tabindex="0"][role="link"]'));

      const handle = parsed?.handle || fallbackMeta.handle;
      const tweetId = parsed?.tweetId || (isQuoted ? `${fallbackMeta.tweetId}_quote` : fallbackMeta.tweetId);
      const photoIndex = parsed?.photoIndex ?? domIdx + 1;
      const groupKey = `${tweetId}:${isQuoted ? 'q' : 'm'}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupKey,
          handle,
          tweetId,
          isQuoted,
          domPhotoNodes: [],
          items: [],
        });
      }

      const group = groups.get(groupKey);
      group.domPhotoNodes.push(photoNode);
      if (src) {
        group.items.push({
          photoNode,
          src,
          photoIndex,
          domIdx,
        });
      }
    }

    const galleries = [];
    for (const group of groups.values()) {
      group.items.sort((a, b) => a.photoIndex - b.photoIndex || a.domIdx - b.domIdx);

      const seenMediaPath = new Set();
      const uniqueDomItems = [];
      for (const item of group.items) {
        const mediaKey = normalizeSignatureKey(item.src);
        if (seenMediaPath.has(mediaKey)) continue;
        seenMediaPath.add(mediaKey);
        uniqueDomItems.push(item);
      }

      // Prefer complete media list from GraphQL interceptor or React Fiber when
      // X's carousel virtualizes off-screen slides.
      let metaMedia = getRegisteredTweetMedia(group.tweetId);
      if (!metaMedia && !group.isQuoted) {
        metaMedia = extractTweetMediaFromReactFiber(article, group.tweetId);
      }

      let urls;
      let origDims;
      let handle = group.handle;

      if (metaMedia && metaMedia.photos.length >= Math.max(2, uniqueDomItems.length)) {
        urls = metaMedia.photos.map((p) => p.url);
        origDims = metaMedia.photos.map((p) => ({ width: p.width, height: p.height }));
        if (metaMedia.handle) handle = metaMedia.handle;
      } else if (uniqueDomItems.length >= 2) {
        urls = uniqueDomItems.map((item) => item.src);
        origDims = uniqueDomItems.map(() => ({ width: 0, height: 0 }));
      } else {
        continue;
      }

      const container = resolveGalleryContainer(group.domPhotoNodes, article, group.isQuoted);
      if (!container) continue;

      const signature = urls.map(normalizeSignatureKey).join('|');

      galleries.push({
        article,
        container,
        handle,
        tweetId: group.tweetId,
        isQuoted: group.isQuoted,
        signature,
        urls,
        origDims,
      });
    }

    return galleries;
  }

  // --- icons.js ---
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Official Google Material Icons (Outlined, 24x24 viewBox, Apache-2.0).
  // Inlined as SVG path data so icons render crisply under X's strict CSP without external font requests.
  const MATERIAL_ICONS = {
    grid_view:
      'M3 3v8h8V3H3zm6 6H5V5h4v4zM3 13v8h8v-8H3zm6 6H5v-4h4v4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM13 13v8h8v-8h-8zm6 6h-4v-4h4v4z',
    auto_awesome:
      'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm0 6l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15zm-7.5-5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zm-1.51 3.49L9 15.17l-.99-2.18L5.83 12l2.18-.99L9 8.83l.99 2.18 2.18.99-2.18.99z',
    swap_horiz:
      'M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z',
    zoom_in:
      'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z',
    content_copy:
      'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    download:
      'M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5z',
    settings:
      'M19.43 12.98c.04-.32.07-.64.07-.98 0-.34-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.488.488 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.566.566 0 0 0-.18-.03c-.17 0-.34.09-.43.25l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98 0 .33.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.06.02.12.03.18.03.17 0 .34-.09.43-.25l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zm-1.98-1.71c.04.31.05.52.05.73 0 .21-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7.14 1.13zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
    close:
      'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    fit_screen:
      'M6 16h12V8H6zm2-6h8v4H8zm-4 5H2v3c0 1.1.9 2 2 2h3v-2H4zm0-9h3V4H4c-1.1 0-2 .9-2 2v3h2zm16-2h-3v2h3v3h2V6c0-1.1-.9-2-2-2m0 14h-3v2h3c1.1 0 2-.9 2-2v-3h-2z',
    restart_alt:
      'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  };

  function createIcon(name, size = 16) {
    const pathData = MATERIAL_ICONS[name];
    if (!pathData) {
      throw new Error(`Unknown Material icon: ${name}`);
    }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'xas-icon');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
  }

  // --- ui.js ---
  const IS_ZH = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '');

  const TEXT = {
    stitch: IS_ZH ? '拼图' : 'Stitch',
    suggested: IS_ZH ? '检测到拼图' : 'Split Detected',
    original: IS_ZH ? '原图' : 'Orig',
    auto: IS_ZH ? '自动' : 'Auto',
    unshuffledBadge: IS_ZH ? '已自动复原顺序' : 'Auto Unshuffled',
    orderBtnTitle: IS_ZH ? '调整切片顺序' : 'Adjust tile order',
    orderHint: IS_ZH ? '点击两块交换:' : 'Swap two:',
    autoOrder: IS_ZH ? '自动排序' : 'Auto',
    resetOrder: IS_ZH ? '默认' : 'Reset',
    zoomTitle: IS_ZH ? '全屏放大预览' : 'Fullscreen preview',
    downloadTitle: IS_ZH ? '下载拼合原图' : 'Download stitched image',
    copyTitle: IS_ZH ? '复制拼合图到剪贴板' : 'Copy image to clipboard',
    settingsTitle: IS_ZH ? '设置' : 'Settings',
    loading: IS_ZH ? '拼合中...' : 'Stitching...',
    lbFit: IS_ZH ? '适应窗口' : 'Fit',
    lbActual: '1:1',
    lbDownload: IS_ZH ? '下载原图' : 'Download',
    lbCopy: IS_ZH ? '复制图片' : 'Copy',
    lbClose: IS_ZH ? '关闭' : 'Close',
    lbFooter: IS_ZH
      ? '滚轮缩放 · 拖拽平移 · 单击切换适应/原尺寸 · 快捷键: D 下载 / C 复制 / 0 适应 / ESC 关闭'
      : 'Wheel to zoom · Drag to pan · Click toggles Fit/1:1 · Keys: D download / C copy / 0 fit / ESC close',
    settingsHeading: IS_ZH ? 'X Art Stitcher 设置' : 'X Art Stitcher Settings',
    optAutoDetect: IS_ZH ? '自动识别多图拼图' : 'Auto-detect split artworks',
    optAutoDetectDesc: IS_ZH
      ? '进入视野时分析边缘像素连续性，判断是否为拆分画作'
      : 'Analyze edge continuity when multi-image tweets enter viewport',
    optAutoStitch: IS_ZH ? '识别命中后自动拼合显示' : 'Auto-stitch detected artworks',
    optAutoStitchDesc: IS_ZH
      ? '关闭后仅高亮提示按钮，由你手动点击拼合'
      : 'When disabled, only highlights the stitch button without replacing',
    optAutoUnshuffle: IS_ZH ? '自动复原乱序/防 AI 切片' : 'Auto-unshuffle scrambled slices',
    optAutoUnshuffleDesc: IS_ZH
      ? '根据相邻边相似度尝试还原被打乱顺序的切片'
      : 'Search tile permutations to restore scrambled multi-image slices',
    optSensitivity: IS_ZH ? '自动识别灵敏度' : 'Detection sensitivity',
    sensStrict: IS_ZH ? '严格（极少误判）' : 'Strict (fewest false positives)',
    sensNormal: IS_ZH ? '标准（推荐）' : 'Normal (recommended)',
    sensLoose: IS_ZH ? '宽松（适配大缝隙/重压缩）' : 'Loose (handles wider gaps)',
    optFormat: IS_ZH ? '下载图片格式' : 'Download format',
    optTemplate: IS_ZH ? '下载文件名模板' : 'Filename template',
    optTemplateDesc: IS_ZH
      ? '可用占位符: {handle}, {tweetId}, {layout}'
      : 'Placeholders: {handle}, {tweetId}, {layout}',
    optDebug: IS_ZH ? '控制台输出调试日志' : 'Console debug logging',
    save: IS_ZH ? '保存' : 'Save',
    cancel: IS_ZH ? '取消' : 'Cancel',
  };

  function t(key) {
    return TEXT[key] || key;
  }

  function getLayoutLabel(layout) {
    switch (layout) {
      case 'grid-2x2':
        return '2×2';
      case 'horizontal':
        return IS_ZH ? '横拼' : 'Horiz';
      case 'vertical':
        return IS_ZH ? '竖拼' : 'Vert';
      case '3-left-tall':
        return IS_ZH ? '左1右2' : '1L+2R';
      case '3-right-tall':
        return IS_ZH ? '左2右1' : '2L+1R';
      case '3-top-wide':
        return IS_ZH ? '上1下2' : '1T+2B';
      case '3-bottom-wide':
        return IS_ZH ? '上2下1' : '2T+1B';
      default:
        return layout.replace(/^grid-/, '');
    }
  }

  let toastTimer = null;
  let toastEl = null;

  function showToast(message, isError = false) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'xas-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.toggle('xas-toast-error', Boolean(isError));
    toastEl.classList.add('xas-toast-visible');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl?.classList.remove('xas-toast-visible');
    }, 2400);
  }

  function stopBubble(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function appendIconLabel(el, iconName, label, iconSize = 15) {
    if (iconName) el.appendChild(createIcon(iconName, iconSize));
    if (label) {
      const text = document.createElement('span');
      text.textContent = label;
      el.appendChild(text);
    }
  }

  function makeIconButton({ icon, title, size = 16, active = false, onClick }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = active ? 'xas-btn xas-btn-icon xas-btn-active' : 'xas-btn xas-btn-icon';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.appendChild(createIcon(icon, size));
    btn.addEventListener('click', (e) => {
      stopBubble(e);
      onClick();
    });
    return btn;
  }

  function openLightbox({ url, title, width, height, onDownload, onCopy }) {
    const existing = document.querySelector('.xas-lightbox');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'xas-lightbox';

    const header = document.createElement('div');
    header.className = 'xas-lb-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'xas-lb-title';
    titleEl.textContent = `${title} · ${width}×${height}`;

    const actions = document.createElement('div');
    actions.className = 'xas-lb-actions';

    const makeBtn = (label, primary, handler, iconName = null) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = primary ? 'xas-lb-btn xas-lb-primary' : 'xas-lb-btn';
      appendIconLabel(btn, iconName, label, 16);
      btn.addEventListener('click', (e) => {
        stopBubble(e);
        handler();
      });
      return btn;
    };

    const viewport = document.createElement('div');
    viewport.className = 'xas-lb-viewport';

    const img = document.createElement('img');
    img.className = 'xas-lb-img';
    img.src = url;
    img.alt = title;
    viewport.appendChild(img);

    const footer = document.createElement('div');
    footer.className = 'xas-lb-footer';
    footer.textContent = t('lbFooter');

    let scale = 1;
    let fitScale = 1;
    let tx = 0;
    let ty = 0;
    let isDragging = false;
    let dragMoved = false;
    let startX = 0;
    let startY = 0;
    let origTx = 0;
    let origTy = 0;

    const applyTransform = () => {
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };

    const computeFitScale = () => {
      const rect = viewport.getBoundingClientRect();
      const pad = 24;
      const availW = Math.max(100, rect.width - pad * 2);
      const availH = Math.max(100, rect.height - pad * 2);
      return Math.min(1, availW / Math.max(1, width), availH / Math.max(1, height));
    };

    const setFit = () => {
      fitScale = computeFitScale();
      scale = fitScale;
      tx = 0;
      ty = 0;
      applyTransform();
    };

    const setActual = () => {
      fitScale = computeFitScale();
      scale = 1;
      tx = 0;
      ty = 0;
      applyTransform();
    };

    const close = () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onResize);
      overlay.remove();
    };

    const onResize = () => {
      const wasFit = Math.abs(scale - fitScale) < 0.01;
      fitScale = computeFitScale();
      if (wasFit) {
        scale = fitScale;
        tx = 0;
        ty = 0;
        applyTransform();
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        stopBubble(e);
        close();
      } else if (e.key === '0') {
        stopBubble(e);
        setFit();
      } else if (e.key === '1') {
        stopBubble(e);
        setActual();
      } else if (e.key === '+' || e.key === '=') {
        stopBubble(e);
        scale = Math.min(4, scale * 1.25);
        applyTransform();
      } else if (e.key === '-') {
        stopBubble(e);
        scale = Math.max(0.1, scale / 1.25);
        applyTransform();
      } else if (e.key.toLowerCase() === 'd') {
        stopBubble(e);
        onDownload();
      } else if (e.key.toLowerCase() === 'c') {
        stopBubble(e);
        onCopy();
      }
    };

    viewport.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.16 : 1 / 1.16;
        scale = Math.max(0.1, Math.min(5, scale * factor));
        applyTransform();
      },
      { passive: false },
    );

    viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      dragMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      origTx = tx;
      origTy = ty;
      viewport.classList.add('xas-dragging');
      viewport.setPointerCapture?.(e.pointerId);
    });

    viewport.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
      tx = origTx + dx;
      ty = origTy + dy;
      applyTransform();
    });

    const endDrag = () => {
      isDragging = false;
      viewport.classList.remove('xas-dragging');
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    viewport.addEventListener('click', (e) => {
      if (dragMoved) return;
      if (e.target === viewport) {
        close();
        return;
      }
      if (e.target === img) {
        if (Math.abs(scale - fitScale) < 0.02) {
          setActual();
        } else {
          setFit();
        }
      }
    });

    actions.appendChild(makeBtn(t('lbFit'), false, setFit, 'fit_screen'));
    actions.appendChild(makeBtn(t('lbActual'), false, setActual));
    actions.appendChild(makeBtn(t('lbCopy'), false, onCopy, 'content_copy'));
    actions.appendChild(makeBtn(t('lbDownload'), true, onDownload, 'download'));
    actions.appendChild(makeBtn(t('lbClose'), false, close, 'close'));

    header.appendChild(titleEl);
    header.appendChild(actions);
    overlay.appendChild(header);
    overlay.appendChild(viewport);
    overlay.appendChild(footer);

    document.body.appendChild(overlay);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onResize);

    requestAnimationFrame(setFit);
  }

  function openSettingsModal(currentConfig, onSave) {
    const existing = document.querySelector('.xas-modal-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'xas-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'xas-modal';

    const head = document.createElement('div');
    head.className = 'xas-modal-head';
    const heading = document.createElement('h3');
    heading.textContent = t('settingsHeading');
    const closeX = makeIconButton({
      icon: 'close',
      title: t('lbClose'),
      size: 18,
      onClick: () => backdrop.remove(),
    });
    head.appendChild(heading);
    head.appendChild(closeX);

    const body = document.createElement('div');
    body.className = 'xas-modal-body';

    const draft = { ...currentConfig };

    const addToggle = (label, desc, key) => {
      const row = document.createElement('label');
      row.className = 'xas-field';
      const left = document.createElement('div');
      const titleDiv = document.createElement('div');
      titleDiv.textContent = label;
      const descDiv = document.createElement('div');
      descDiv.className = 'xas-field-desc';
      descDiv.textContent = desc;
      left.appendChild(titleDiv);
      if (desc) left.appendChild(descDiv);

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'xas-checkbox';
      input.checked = Boolean(draft[key]);
      input.addEventListener('change', () => {
        draft[key] = input.checked;
      });

      row.appendChild(left);
      row.appendChild(input);
      body.appendChild(row);
    };

    const addSelect = (label, key, options) => {
      const row = document.createElement('label');
      row.className = 'xas-field';
      const text = document.createElement('span');
      text.textContent = label;
      const select = document.createElement('select');
      select.className = 'xas-select';
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (draft[key] === opt.value) o.selected = true;
        select.appendChild(o);
      }
      select.addEventListener('change', () => {
        draft[key] = select.value;
      });
      row.appendChild(text);
      row.appendChild(select);
      body.appendChild(row);
    };

    addToggle(t('optAutoDetect'), t('optAutoDetectDesc'), 'autoDetect');
    addToggle(t('optAutoStitch'), t('optAutoStitchDesc'), 'autoStitch');
    addToggle(t('optAutoUnshuffle'), t('optAutoUnshuffleDesc'), 'autoUnshuffle');
    addSelect(t('optSensitivity'), 'sensitivity', [
      { value: 'strict', label: t('sensStrict') },
      { value: 'normal', label: t('sensNormal') },
      { value: 'loose', label: t('sensLoose') },
    ]);
    addSelect(t('optFormat'), 'downloadFormat', [
      { value: 'png', label: 'PNG (Lossless)' },
      { value: 'jpeg', label: 'JPEG (95%)' },
      { value: 'webp', label: 'WebP (95%)' },
    ]);

    const tplWrap = document.createElement('label');
    tplWrap.className = 'xas-field-col';
    const tplLabel = document.createElement('span');
    tplLabel.textContent = t('optTemplate');
    const tplInput = document.createElement('input');
    tplInput.type = 'text';
    tplInput.className = 'xas-input';
    tplInput.value = draft.filenameTemplate;
    tplInput.addEventListener('input', () => {
      draft.filenameTemplate = tplInput.value;
    });
    const tplDesc = document.createElement('span');
    tplDesc.className = 'xas-field-desc';
    tplDesc.textContent = t('optTemplateDesc');
    tplWrap.appendChild(tplLabel);
    tplWrap.appendChild(tplInput);
    tplWrap.appendChild(tplDesc);
    body.appendChild(tplWrap);

    addToggle(t('optDebug'), '', 'debug');

    const foot = document.createElement('div');
    foot.className = 'xas-modal-foot';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'xas-lb-btn';
    cancelBtn.textContent = t('cancel');
    cancelBtn.addEventListener('click', () => backdrop.remove());

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'xas-lb-btn xas-lb-primary';
    saveBtn.textContent = t('save');
    saveBtn.addEventListener('click', () => {
      onSave(draft);
      backdrop.remove();
    });

    foot.appendChild(cancelBtn);
    foot.appendChild(saveBtn);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    backdrop.appendChild(modal);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    document.body.appendChild(backdrop);
  }

  /**
   * Manage the injected UI controls and stitched preview stage for a single tweet gallery.
   */
  function createGalleryUI(gallery, callbacks) {
    const { container, urls } = gallery;
    container.classList.add('xas-root');

    const toolbar = document.createElement('div');
    toolbar.className = 'xas-injected xas-toolbar';
    toolbar.addEventListener('click', stopBubble);

    const stage = document.createElement('div');
    stage.className = 'xas-injected xas-stage';
    stage.style.display = 'none';

    const previewImg = document.createElement('img');
    previewImg.className = 'xas-preview';
    previewImg.addEventListener('click', (e) => {
      stopBubble(e);
      callbacks.onOpenLightbox();
    });

    const metaBadge = document.createElement('div');
    metaBadge.className = 'xas-meta-badge';

    stage.appendChild(previewImg);
    stage.appendChild(metaBadge);

    container.appendChild(stage);
    container.appendChild(toolbar);

    const state = {
      stitched: false,
      busy: false,
      expanded: false,
      showOrderEditor: false,
      selectedSlot: null,
      activeLayout: null,
      order: Array.from({ length: urls.length }, (_, i) => i),
      suggested: null, // { layout, order, wasUnshuffled }
      wasUnshuffled: false,
      width: 0,
      height: 0,
    };

    const layouts = getAvailableLayouts(urls.length);

    const renderToolbar = () => {
      toolbar.textContent = '';
      toolbar.classList.toggle('xas-expanded', state.expanded || state.stitched);

      const pill = document.createElement('div');
      pill.className = 'xas-pill';

      if (state.busy) {
        const spinner = document.createElement('span');
        spinner.className = 'xas-spinner';
        const label = document.createElement('span');
        label.style.padding = '4px 6px';
        label.textContent = t('loading');
        pill.appendChild(spinner);
        pill.appendChild(label);
        toolbar.appendChild(pill);
        return;
      }

      if (!state.stitched && !state.expanded) {
        pill.classList.add(state.suggested ? 'xas-suggested' : 'xas-collapsed');
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = state.suggested ? 'xas-btn xas-btn-accent' : 'xas-btn';
        if (state.suggested) {
          appendIconLabel(
            trigger,
            'auto_awesome',
            `${t('suggested')} (${getLayoutLabel(state.suggested.layout)})`,
            15,
          );
        } else {
          appendIconLabel(trigger, 'grid_view', t('stitch'), 15);
        }
        trigger.addEventListener('click', (e) => {
          stopBubble(e);
          if (state.suggested) {
            callbacks.onSelectLayout(state.suggested.layout, state.suggested.order, state.suggested.wasUnshuffled);
          } else {
            state.expanded = true;
            renderToolbar();
          }
        });
        pill.appendChild(trigger);
        toolbar.appendChild(pill);
        return;
      }

      // Restore original view button (or collapse if not stitched)
      const origBtn = document.createElement('button');
      origBtn.type = 'button';
      origBtn.className = state.stitched ? 'xas-btn' : 'xas-btn xas-btn-active';
      origBtn.textContent = t('original');
      origBtn.addEventListener('click', (e) => {
        stopBubble(e);
        state.expanded = false;
        state.showOrderEditor = false;
        state.selectedSlot = null;
        if (state.stitched) {
          callbacks.onRestoreOriginal();
        } else {
          renderToolbar();
        }
      });
      pill.appendChild(origBtn);

      // Layout selector buttons
      for (const layout of layouts) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          state.stitched && state.activeLayout === layout ? 'xas-btn xas-btn-active' : 'xas-btn';
        btn.textContent = getLayoutLabel(layout);
        btn.addEventListener('click', (e) => {
          stopBubble(e);
          callbacks.onSelectLayout(layout, null, false);
        });
        pill.appendChild(btn);
      }

      if (!state.stitched) {
        const autoBtn = document.createElement('button');
        autoBtn.type = 'button';
        autoBtn.className = 'xas-btn xas-btn-accent';
        appendIconLabel(autoBtn, 'auto_awesome', t('auto'), 15);
        autoBtn.addEventListener('click', (e) => {
          stopBubble(e);
          callbacks.onAutoSolve();
        });
        pill.appendChild(autoBtn);
      } else {
        const sep = document.createElement('span');
        sep.className = 'xas-sep';
        pill.appendChild(sep);

        pill.appendChild(
          makeIconButton({
            icon: 'swap_horiz',
            title: t('orderBtnTitle'),
            active: state.showOrderEditor,
            onClick: () => {
              state.showOrderEditor = !state.showOrderEditor;
              state.selectedSlot = null;
              renderToolbar();
            },
          }),
        );
        pill.appendChild(
          makeIconButton({
            icon: 'zoom_in',
            title: t('zoomTitle'),
            onClick: callbacks.onOpenLightbox,
          }),
        );
        pill.appendChild(
          makeIconButton({
            icon: 'content_copy',
            title: t('copyTitle'),
            onClick: callbacks.onCopy,
          }),
        );
        pill.appendChild(
          makeIconButton({
            icon: 'download',
            title: t('downloadTitle'),
            onClick: callbacks.onDownload,
          }),
        );
      }

      pill.appendChild(
        makeIconButton({
          icon: 'settings',
          title: t('settingsTitle'),
          onClick: callbacks.onOpenSettings,
        }),
      );

      toolbar.appendChild(pill);

      // Optional inline tile-order swapper bar
      if (state.stitched && state.showOrderEditor) {
        const orderBar = document.createElement('div');
        orderBar.className = 'xas-order-bar';

        const hint = document.createElement('span');
        hint.className = 'xas-order-hint';
        hint.textContent = t('orderHint');
        orderBar.appendChild(hint);

        state.order.forEach((origIdx, slotPos) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className =
            state.selectedSlot === slotPos ? 'xas-slot-chip xas-slot-selected' : 'xas-slot-chip';
          chip.textContent = String(origIdx + 1);
          chip.addEventListener('click', (e) => {
            stopBubble(e);
            if (state.selectedSlot === null) {
              state.selectedSlot = slotPos;
              renderToolbar();
              return;
            }
            if (state.selectedSlot === slotPos) {
              state.selectedSlot = null;
              renderToolbar();
              return;
            }
            const nextOrder = state.order.slice();
            const a = state.selectedSlot;
            [nextOrder[a], nextOrder[slotPos]] = [nextOrder[slotPos], nextOrder[a]];
            state.selectedSlot = null;
            callbacks.onChangeOrder(nextOrder);
          });
          orderBar.appendChild(chip);
        });

        const autoOrderBtn = document.createElement('button');
        autoOrderBtn.type = 'button';
        autoOrderBtn.className = 'xas-btn xas-btn-accent';
        appendIconLabel(autoOrderBtn, 'auto_awesome', t('autoOrder'), 14);
        autoOrderBtn.addEventListener('click', (e) => {
          stopBubble(e);
          callbacks.onAutoSolve(state.activeLayout);
        });
        orderBar.appendChild(autoOrderBtn);

        const resetOrderBtn = document.createElement('button');
        resetOrderBtn.type = 'button';
        resetOrderBtn.className = 'xas-btn';
        appendIconLabel(resetOrderBtn, 'restart_alt', t('resetOrder'), 14);
        resetOrderBtn.addEventListener('click', (e) => {
          stopBubble(e);
          callbacks.onChangeOrder(Array.from({ length: urls.length }, (_, i) => i));
        });
        orderBar.appendChild(resetOrderBtn);

        toolbar.appendChild(orderBar);
      }
    };

    renderToolbar();

    return {
      setBusy(isBusy) {
        state.busy = isBusy;
        renderToolbar();
      },
      setSuggested(suggestion) {
        state.suggested = suggestion;
        renderToolbar();
      },
      showStitched({ objectUrl, layout, order, width, height, wasUnshuffled }) {
        state.stitched = true;
        state.busy = false;
        state.activeLayout = layout;
        state.order = order.slice();
        state.width = width;
        state.height = height;
        state.wasUnshuffled = Boolean(wasUnshuffled);

        previewImg.src = objectUrl;
        metaBadge.textContent = '';
        const parts = [getLayoutLabel(layout), `${width}×${height}`];
        if (state.wasUnshuffled) {
          metaBadge.appendChild(createIcon('auto_awesome', 14));
          parts.unshift(t('unshuffledBadge'));
        }
        const metaText = document.createElement('span');
        metaText.textContent = parts.join(' · ');
        metaBadge.appendChild(metaText);

        stage.style.display = 'flex';
        container.classList.add('xas-active');
        renderToolbar();
      },
      showOriginal() {
        state.stitched = false;
        state.busy = false;
        state.showOrderEditor = false;
        state.selectedSlot = null;
        stage.style.display = 'none';
        container.classList.remove('xas-active');
        renderToolbar();
      },
      destroy() {
        container.classList.remove('xas-active', 'xas-root');
        stage.remove();
        toolbar.remove();
      },
    };
  }

  // --- main.js ---
  // Replaced at build time with contents of src/styles.css.
  const STYLES_CSS = ".xas-root {\n  position: relative !important;\n}\n\n.xas-root.xas-active {\n  height: auto !important;\n  min-height: 0 !important;\n  overflow: visible !important;\n}\n\n.xas-root.xas-active > :not(.xas-injected) {\n  display: none !important;\n}\n\n.xas-stage {\n  position: relative;\n  width: 100%;\n  border-radius: 16px;\n  overflow: hidden;\n  background: rgba(15, 20, 25, 0.35);\n  border: 1px solid rgba(128, 128, 128, 0.22);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.xas-preview {\n  display: block;\n  width: 100%;\n  height: auto;\n  max-height: 82vh;\n  object-fit: contain;\n  cursor: zoom-in;\n  user-select: none;\n  -webkit-user-drag: none;\n}\n\n.xas-toolbar {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  z-index: 30;\n  max-width: calc(100% - 16px);\n  display: flex;\n  flex-direction: column;\n  align-items: flex-end;\n  gap: 6px;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n  font-size: 12px;\n  line-height: 1;\n  pointer-events: auto;\n}\n\n.xas-pill {\n  display: inline-flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 3px;\n  padding: 4px 6px;\n  border-radius: 999px;\n  background: rgba(15, 20, 25, 0.78);\n  color: #eff3f4;\n  border: 1px solid rgba(255, 255, 255, 0.16);\n  backdrop-filter: blur(10px);\n  -webkit-backdrop-filter: blur(10px);\n  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);\n  opacity: 0.78;\n  transition: opacity 0.16s ease, background 0.16s ease, border-color 0.16s ease;\n}\n\n.xas-root:hover .xas-pill,\n.xas-toolbar:hover .xas-pill,\n.xas-toolbar.xas-expanded .xas-pill,\n.xas-pill.xas-suggested {\n  opacity: 1;\n}\n\n.xas-pill.xas-suggested {\n  border-color: rgba(29, 155, 240, 0.75);\n  background: rgba(15, 24, 34, 0.88);\n}\n\n.xas-pill.xas-collapsed {\n  opacity: 0.52;\n  padding: 3px 5px;\n}\n\n.xas-root:hover .xas-pill.xas-collapsed {\n  opacity: 0.95;\n}\n\n.xas-icon {\n  display: block;\n  flex-shrink: 0;\n  fill: currentColor;\n}\n\n.xas-btn {\n  appearance: none;\n  border: none;\n  background: transparent;\n  color: #eff3f4;\n  font: inherit;\n  font-size: 12px;\n  font-weight: 600;\n  height: 26px;\n  padding: 0 9px;\n  border-radius: 999px;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 4px;\n  white-space: nowrap;\n  transition: background 0.14s ease, color 0.14s ease;\n}\n\n.xas-btn.xas-btn-icon {\n  width: 26px;\n  padding: 0;\n}\n\n.xas-btn:hover {\n  background: rgba(255, 255, 255, 0.15);\n}\n\n.xas-btn:disabled {\n  opacity: 0.45;\n  cursor: wait;\n}\n\n.xas-btn.xas-btn-active {\n  background: #1d9bf0;\n  color: #ffffff;\n}\n\n.xas-btn.xas-btn-accent {\n  color: #6cc5ff;\n}\n\n.xas-sep {\n  width: 1px;\n  height: 14px;\n  background: rgba(255, 255, 255, 0.18);\n  margin: 0 2px;\n}\n\n.xas-order-bar {\n  display: inline-flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 4px;\n  padding: 5px 8px;\n  border-radius: 12px;\n  background: rgba(15, 20, 25, 0.9);\n  color: #eff3f4;\n  border: 1px solid rgba(255, 255, 255, 0.18);\n  backdrop-filter: blur(10px);\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.38);\n}\n\n.xas-order-hint {\n  font-size: 11px;\n  color: #8b98a5;\n  margin-right: 2px;\n}\n\n.xas-slot-chip {\n  appearance: none;\n  border: 1px solid rgba(255, 255, 255, 0.24);\n  background: rgba(255, 255, 255, 0.08);\n  color: #eff3f4;\n  font: inherit;\n  font-weight: 700;\n  min-width: 24px;\n  height: 24px;\n  padding: 0 6px;\n  border-radius: 8px;\n  cursor: pointer;\n  transition: background 0.14s ease, border-color 0.14s ease, transform 0.1s ease;\n}\n\n.xas-slot-chip:hover {\n  background: rgba(255, 255, 255, 0.2);\n}\n\n.xas-slot-chip.xas-slot-selected {\n  background: #1d9bf0;\n  border-color: #6cc5ff;\n  color: #fff;\n  transform: scale(1.06);\n}\n\n.xas-meta-badge {\n  position: absolute;\n  left: 10px;\n  bottom: 10px;\n  z-index: 25;\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  padding: 4px 9px;\n  border-radius: 999px;\n  background: rgba(15, 20, 25, 0.72);\n  color: #e7e9ea;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n  font-size: 11px;\n  font-weight: 600;\n  border: 1px solid rgba(255, 255, 255, 0.14);\n  backdrop-filter: blur(8px);\n  pointer-events: none;\n  opacity: 0;\n  transition: opacity 0.18s ease;\n}\n\n.xas-stage:hover .xas-meta-badge,\n.xas-root:hover .xas-meta-badge {\n  opacity: 1;\n}\n\n.xas-spinner {\n  display: inline-block;\n  width: 12px;\n  height: 12px;\n  border: 2px solid rgba(255, 255, 255, 0.28);\n  border-top-color: #1d9bf0;\n  border-radius: 50%;\n  animation: xas-spin 0.75s linear infinite;\n}\n\n@keyframes xas-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n/* Fullscreen Lightbox */\n.xas-lightbox {\n  position: fixed;\n  inset: 0;\n  z-index: 2147483000;\n  background: rgba(0, 0, 0, 0.92);\n  backdrop-filter: blur(10px);\n  display: flex;\n  flex-direction: column;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n  color: #eff3f4;\n  user-select: none;\n}\n\n.xas-lb-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 12px 18px;\n  background: linear-gradient(180deg, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0));\n  z-index: 2;\n}\n\n.xas-lb-title {\n  font-size: 13px;\n  font-weight: 600;\n  color: #e7e9ea;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.xas-lb-actions {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  flex-shrink: 0;\n}\n\n.xas-lb-btn {\n  appearance: none;\n  border: 1px solid rgba(255, 255, 255, 0.18);\n  background: rgba(25, 32, 40, 0.85);\n  color: #eff3f4;\n  font: inherit;\n  font-size: 12px;\n  font-weight: 600;\n  height: 30px;\n  padding: 0 12px;\n  border-radius: 999px;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 5px;\n  white-space: nowrap;\n  transition: background 0.15s ease, border-color 0.15s ease;\n}\n\n.xas-lb-btn:hover {\n  background: rgba(45, 58, 72, 0.95);\n  border-color: rgba(255, 255, 255, 0.35);\n}\n\n.xas-lb-btn.xas-lb-primary {\n  background: #1d9bf0;\n  border-color: #1d9bf0;\n  color: #fff;\n}\n\n.xas-lb-btn.xas-lb-primary:hover {\n  background: #1a8cd8;\n}\n\n.xas-lb-viewport {\n  flex: 1;\n  position: relative;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: grab;\n}\n\n.xas-lb-viewport.xas-dragging {\n  cursor: grabbing;\n}\n\n.xas-lb-img {\n  max-width: none;\n  max-height: none;\n  transform-origin: center center;\n  will-change: transform;\n  -webkit-user-drag: none;\n  user-select: none;\n  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.65);\n}\n\n.xas-lb-footer {\n  padding: 8px 16px;\n  text-align: center;\n  font-size: 11px;\n  color: #8b98a5;\n  pointer-events: none;\n}\n\n/* Settings Modal */\n.xas-modal-backdrop {\n  position: fixed;\n  inset: 0;\n  z-index: 2147483100;\n  background: rgba(0, 0, 0, 0.65);\n  backdrop-filter: blur(4px);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 16px;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n}\n\n.xas-modal {\n  width: 100%;\n  max-width: 440px;\n  background: #15202b;\n  color: #eff3f4;\n  border: 1px solid rgba(255, 255, 255, 0.16);\n  border-radius: 16px;\n  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);\n  overflow: hidden;\n}\n\n.xas-modal-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 14px 18px;\n  border-bottom: 1px solid rgba(255, 255, 255, 0.1);\n}\n\n.xas-modal-head h3 {\n  margin: 0;\n  font-size: 16px;\n  font-weight: 700;\n}\n\n.xas-modal-body {\n  padding: 16px 18px;\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n}\n\n.xas-field {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  font-size: 13px;\n}\n\n.xas-field-col {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  font-size: 13px;\n}\n\n.xas-field-desc {\n  font-size: 11px;\n  color: #8b98a5;\n  margin-top: 2px;\n}\n\n.xas-select,\n.xas-input {\n  background: #1e2d3d;\n  color: #eff3f4;\n  border: 1px solid rgba(255, 255, 255, 0.18);\n  border-radius: 8px;\n  padding: 6px 10px;\n  font: inherit;\n  font-size: 13px;\n}\n\n.xas-checkbox {\n  width: 18px;\n  height: 18px;\n  accent-color: #1d9bf0;\n  cursor: pointer;\n}\n\n.xas-modal-foot {\n  display: flex;\n  justify-content: flex-end;\n  gap: 8px;\n  padding: 12px 18px;\n  border-top: 1px solid rgba(255, 255, 255, 0.1);\n}\n\n/* Toast */\n.xas-toast {\n  position: fixed;\n  left: 50%;\n  bottom: 26px;\n  transform: translateX(-50%) translateY(12px);\n  z-index: 2147483200;\n  padding: 10px 16px;\n  border-radius: 999px;\n  background: rgba(15, 20, 25, 0.94);\n  color: #eff3f4;\n  border: 1px solid rgba(255, 255, 255, 0.18);\n  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n  font-size: 13px;\n  font-weight: 600;\n  opacity: 0;\n  pointer-events: none;\n  transition: opacity 0.18s ease, transform 0.18s ease;\n}\n\n.xas-toast.xas-toast-visible {\n  opacity: 1;\n  transform: translateX(-50%) translateY(0);\n}\n\n.xas-toast.xas-toast-error {\n  border-color: rgba(244, 33, 46, 0.7);\n  color: #ff9aa2;\n}";

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
})();
