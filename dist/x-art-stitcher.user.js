// ==UserScript==
// @name              X Art Stitcher
// @name:zh-CN        X 画师拼图自动还原
// @namespace         https://github.com/anfsity/x-art-stitcher
// @version           1.0.0
// @description       Automatically detect, unshuffle, and stitch multi-image artist artworks on X (Twitter), including 2x2 grids and 20-image carousels, with fullscreen lightbox, lossless download, and clipboard copy.
// @description:zh-CN 自动识别并拼合 X (Twitter) 上画师发布的多图/四宫格/长图/多图轮播及防 AI 乱序切片作品，支持高清灯箱预览、原图下载与一键复制。
// @author            anfsity
// @license           Apache-2.0
// @icon              data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzFkOWJmMCIvPjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDQgNCkiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0zIDN2OGg4VjNIM3ptNiA2SDVWNWg0djR6TTMgMTN2OGg4di04SDN6bTYgNkg1di00aDR2NHpNMTMgM3Y4aDhWM2gtOHptNiA2aC00VjVoNHY0ek0xMyAxM3Y4aDh2LThoLTh6bTYgNmgtNHYtNGg0djR6Ii8+PC9nPjwvc3ZnPg==
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
   * Detect a uniform 1..maxTrim px dark/light border artifact line (e.g. from a
   * screenshot crop or canvas slice guide) along an image edge. Returns 0 when
   * the edge transitions normally into interior pixels.
   */
  function detectBorderArtifactDepth(img, side, maxTrim = 2) {
    const isHorizontalEdge = side === 'top' || side === 'bottom';
    const edgeLen = isHorizontalEdge ? img.width : img.height;
    const depth = isHorizontalEdge ? img.height : img.width;
    const limit = Math.min(maxTrim, Math.floor((depth - 4) / 2));
    if (limit < 1 || edgeLen < 12) return 0;

    const sampleCount = Math.min(64, Math.max(16, edgeLen - 2));
    const margin = Math.max(0, Math.floor(edgeLen * 0.04));
    const span = Math.max(1, edgeLen - margin * 2 - 1);
    const rows = Array.from({ length: limit + 3 }, () => new Float32Array(sampleCount * 3));

    for (let d = 0; d < limit + 3; d++) {
      const coord = side === 'top' || side === 'left' ? d : depth - 1 - d;
      const buf = rows[d];
      for (let k = 0; k < sampleCount; k++) {
        const p = Math.min(edgeLen - 1, margin + Math.round((k / Math.max(1, sampleCount - 1)) * span));
        const px = isHorizontalEdge ? samplePixelRgb(img, p, coord) : samplePixelRgb(img, coord, p);
        const base = k * 3;
        buf[base] = px[0];
        buf[base + 1] = px[1];
        buf[base + 2] = px[2];
      }
    }

    // Scan from innermost candidate depth outward so anti-aliased multi-pixel
    // border lines trim cleanly up to the first calm interior row/column.
    for (let t = limit; t >= 1; t--) {
      const outBuf = rows[t - 1];
      const inBuf = rows[t];
      const nextBuf = rows[t + 1];
      const next2Buf = rows[t + 2];

      let sumOut = 0;
      let sumIn = 0;
      let sumIn2 = 0;
      let strongCount = 0;
      let darkerCount = 0;
      let brighterCount = 0;

      for (let k = 0; k < sampleCount; k++) {
        const base = k * 3;
        const dOut =
          (Math.abs(outBuf[base] - inBuf[base]) +
            Math.abs(outBuf[base + 1] - inBuf[base + 1]) +
            Math.abs(outBuf[base + 2] - inBuf[base + 2])) /
          3;
        const dIn =
          (Math.abs(inBuf[base] - nextBuf[base]) +
            Math.abs(inBuf[base + 1] - nextBuf[base + 1]) +
            Math.abs(inBuf[base + 2] - nextBuf[base + 2])) /
          3;
        const dIn2 =
          (Math.abs(nextBuf[base] - next2Buf[base]) +
            Math.abs(nextBuf[base + 1] - next2Buf[base + 1]) +
            Math.abs(nextBuf[base + 2] - next2Buf[base + 2])) /
          3;

        sumOut += dOut;
        sumIn += dIn;
        sumIn2 += dIn2;

        if (dOut >= 16 && dOut > dIn * 2.0 + 6) {
          strongCount++;
          const lumaOut = outBuf[base] + outBuf[base + 1] + outBuf[base + 2];
          const lumaIn = inBuf[base] + inBuf[base + 1] + inBuf[base + 2];
          if (lumaOut < lumaIn) darkerCount++;
          else brighterCount++;
        }
      }

      const meanOut = sumOut / sampleCount;
      const meanIn = sumIn / sampleCount;
      const meanIn2 = sumIn2 / sampleCount;
      const fracStrong = strongCount / sampleCount;
      const signConsistency = strongCount > 0 ? Math.max(darkerCount, brighterCount) / strongCount : 0;

      if (
        meanOut >= 18 &&
        meanIn <= 30 &&
        meanOut / (meanIn + 1.0) >= 3.0 &&
        meanOut / (Math.min(meanIn, meanIn2) + 1.0) >= 3.0 &&
        fracStrong >= 0.65 &&
        signConsistency >= 0.75
      ) {
        return t;
      }
    }

    return 0;
  }

  /**
   * Extract an edge strip (outer blended border + inner 2px inset) resampled via
   * box-filter averaging so thin line art crossing a cut is preserved.
   */
  function extractEdgeStrip(
    img,
    side,
    startFrac = 0,
    endFrac = 1,
    samples = DEFAULT_SAMPLES,
    inset = 0,
  ) {
    const isHorizontalEdge = side === 'top' || side === 'bottom';
    const totalLen = isHorizontalEdge ? img.width : img.height;
    const depth = isHorizontalEdge ? img.height : img.width;

    const pStart = Math.max(0, Math.min(totalLen - 1, Math.floor(startFrac * totalLen)));
    const pEnd = Math.max(pStart + 1, Math.min(totalLen, Math.ceil(endFrac * totalLen)));
    const segLen = pEnd - pStart;

    const outer = new Float32Array(samples * 3);
    const inner = new Float32Array(samples * 3);

    const clampedInset = Math.max(0, Math.min(Math.max(0, depth - 3), inset));
    const d0 = side === 'top' || side === 'left' ? clampedInset : depth - 1 - clampedInset;
    const d1 =
      side === 'top' || side === 'left'
        ? Math.min(depth - 1, clampedInset + 1)
        : Math.max(0, depth - 2 - clampedInset);
    const d2 =
      side === 'top' || side === 'left'
        ? Math.min(depth - 1, clampedInset + 2)
        : Math.max(0, depth - 3 - clampedInset);

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

    return { outer, inner, samples, inset: clampedInset };
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

  /**
   * Score an edge pair using raw borders, and if either side exhibited a uniform
   * border-line artifact, re-evaluate with the trimmed edge and keep the cleaner
   * match only when it materially improves continuity.
   */
  function scoreEdgeEntryPair(entryA, entryB, minActivity) {
    let best = scoreEdgePair(entryA.raw, entryB.raw, minActivity);
    const altA = entryA.trimmed;
    const altB = entryB.trimmed;
    if (!altA && !altB) return best;

    const pairs = [];
    if (altA) pairs.push([altA, entryB.raw]);
    if (altB) pairs.push([entryA.raw, altB]);
    if (altA && altB) pairs.push([altA, altB]);

    for (const [sa, sb] of pairs) {
      const cand = scoreEdgePair(sa, sb, minActivity);
      if (cand.score > best.score + 0.04) {
        best = cand;
      }
    }
    return best;
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

  function isMutualBestBuddy(i, j, matrix) {
    const target = matrix[i][j].score;
    const n = matrix.length;
    for (let k = 0; k < n; k++) {
      if (k !== i && k !== j && matrix[i][k].score > target + 0.01) return false;
      if (k !== i && k !== j && matrix[k][j].score > target + 0.01) return false;
    }
    return true;
  }

  /**
   * Segment a mixed multi-image carousel (e.g. a 4-slice panorama followed by
   * standalone artworks, or multiple split artworks in one tweet) into optimal
   * non-overlapping stitched groups and standalone slides.
   */
  function detectPartialSplitGroups(n, H, V, aspects, options) {
    const { minComposite, minSeam, minActivity, allowUnshuffle, unshuffleMargin } = options;
    const validIntervals = [];

    // 1. Evaluate every contiguous horizontal and vertical sub-run [start..end].
    const evalStripIntervals = (layout, matrix) => {
      for (let start = 0; start < n - 1; start++) {
        for (let end = start + 1; end < n; end++) {
          const len = end - start + 1;
          if (len >= n) continue;

          const seams = [];
          for (let k = start; k < end; k++) {
            seams.push(matrix[k][k + 1]);
          }

          // Never extend a partial group across an inactive flat-color boundary
          // (prevents swallowing an adjacent white-background standalone image).
          if (!seams[0].isActive || !seams[seams.length - 1].isActive) continue;

          const localOrder = Array.from({ length: len }, (_, i) => i);
          const cand = aggregateCandidate(layout, localOrder, seams, 1.0, minActivity);
          if (!cand) continue;

          if (len === 2) {
            // Single-seam pairs inside a larger gallery face the birthday paradox:
            // enforce high structural agreement + mutual-best-buddy confirmation.
            const seam = seams[0];
            const pairMinScore = Math.min(0.86, minComposite + 0.14);
            if (
              cand.composite < pairMinScore ||
              seam.ncc < 0.65 ||
              seam.gradNcc < 0.30 ||
              !isMutualBestBuddy(start, end, matrix)
            ) {
              continue;
            }
          } else {
            const strongSingleActive =
              len === 3 && cand.activeCount === 1 && cand.activeMeanScore >= minComposite + 0.14 && cand.minSeamScore >= 0.55;
            if (
              cand.composite < minComposite ||
              cand.minSeamScore < minSeam ||
              (cand.activeCount < 2 && !strongSingleActive)
            ) {
              continue;
            }
          }

          const indices = Array.from({ length: len }, (_, i) => start + i);
          validIntervals.push({
            start,
            end,
            len,
            indices,
            layout,
            order: localOrder,
            wasUnshuffled: false,
            candidate: cand,
            weight: (len - 1) * cand.composite,
          });
        }
      }
    };

    evalStripIntervals('horizontal', H);
    evalStripIntervals('vertical', V);

    // 2. Evaluate contiguous 4-slice 2x2 sub-blocks inside larger galleries (N >= 5).
    if (n >= 5) {
      const perms4 = allowUnshuffle ? getPermutations(4) : [[0, 1, 2, 3]];
      for (let start = 0; start <= n - 4; start++) {
        const indices = [start, start + 1, start + 2, start + 3];
        const subAspects = indices.map((idx) => aspects[idx]);
        let bestNat = null;
        let bestAny = null;

        for (const localOrder of perms4) {
          const geomScore = computeGridGeomScore(2, 2, localOrder, subAspects);
          if (geomScore <= 0) continue;
          const [tl, tr, bl, br] = localOrder.map((k) => indices[k]);
          const seams = [H[tl][tr], H[bl][br], V[tl][bl], V[tr][br]];
          const cand = aggregateCandidate('grid-2x2', localOrder, seams, geomScore, minActivity);
          if (!cand) continue;
          if (!bestAny || cand.composite > bestAny.composite) bestAny = cand;
          if (isNaturalOrder(localOrder) && (!bestNat || cand.composite > bestNat.composite)) {
            bestNat = cand;
          }
        }

        let picked = bestNat;
        let unshuffled = false;
        if (allowUnshuffle && bestAny) {
          if (!bestNat) {
            picked = bestAny;
            unshuffled = !isNaturalOrder(bestAny.order);
          } else if (!isNaturalOrder(bestAny.order) && bestAny.composite >= bestNat.composite + unshuffleMargin) {
            picked = bestAny;
            unshuffled = true;
          }
        }

        if (
          picked &&
          picked.composite >= minComposite &&
          picked.minSeamScore >= minSeam &&
          picked.activeCount >= 2
        ) {
          validIntervals.push({
            start,
            end: start + 3,
            len: 4,
            indices,
            layout: 'grid-2x2',
            order: picked.order,
            wasUnshuffled: unshuffled,
            candidate: picked,
            // Slightly favor 2x2 over a 1x4 strip on the same 4 indices when scores tie,
            // because 4 matching seams carry stronger structural evidence than 3.
            weight: 3.25 * picked.composite,
          });
        }
      }
    }

    if (validIntervals.length === 0) return null;

    // Keep only the strongest candidate per (start, end) span before interval DP.
    const bySpan = new Map();
    for (const interval of validIntervals) {
      const key = `${interval.start}:${interval.end}`;
      const prev = bySpan.get(key);
      if (!prev || interval.weight > prev.weight) {
        bySpan.set(key, interval);
      }
    }

    const intervalsByEnd = Array.from({ length: n }, () => []);
    for (const interval of bySpan.values()) {
      intervalsByEnd[interval.end].push(interval);
    }

    // Exact 1D weighted interval scheduling DP over 0..n-1.
    const dpWeight = new Float64Array(n + 1);
    const dpChoice = new Array(n + 1).fill(null);

    for (let i = 0; i < n; i++) {
      // Option A: leave image i as a standalone single.
      dpWeight[i + 1] = dpWeight[i];
      dpChoice[i + 1] = null;

      // Option B: end a split group at image i.
      for (const interval of intervalsByEnd[i]) {
        const w = dpWeight[interval.start] + interval.weight;
        if (w > dpWeight[i + 1] + 1e-9) {
          dpWeight[i + 1] = w;
          dpChoice[i + 1] = interval;
        }
      }
    }

    if (dpWeight[n] <= 0) return null;

    const selected = [];
    let cursor = n;
    while (cursor > 0) {
      const chosen = dpChoice[cursor];
      if (chosen) {
        selected.push(chosen);
        cursor = chosen.start;
      } else {
        cursor--;
      }
    }
    selected.reverse();
    if (selected.length === 0) return null;

    // Assemble the full ordered gallery sequence (stitched groups + remaining singles).
    const galleryItems = [];
    let idx = 0;
    for (const grp of selected) {
      while (idx < grp.start) {
        galleryItems.push({ type: 'single', index: idx });
        idx++;
      }
      galleryItems.push({
        type: 'stitched',
        indices: grp.indices,
        layout: grp.layout,
        order: grp.order,
        wasUnshuffled: grp.wasUnshuffled,
        candidate: grp.candidate,
      });
      idx = grp.end + 1;
    }
    while (idx < n) {
      galleryItems.push({ type: 'single', index: idx });
      idx++;
    }

    return galleryItems;
  }

  /**
   * Analyze N decoded thumbnail RGBA buffers and determine whether they form a
   * split artwork (either across the full gallery or as partial split group(s)
   * inside a mixed carousel), along with optimal layouts and unshuffled tile order.
   */
  function detectSplitArtwork(images, options = {}) {
    const n = images.length;
    if (n < 2) {
      return {
        isMatch: false,
        isPartial: false,
        winner: null,
        wasUnshuffled: false,
        bestByLayout: {},
        groups: [],
      };
    }

    const minComposite = options.minComposite ?? 0.60;
    const minSeam = options.minSeam ?? 0.40;
    const minActivity = options.minActivity ?? 9;
    const unshuffleMargin = options.unshuffleMargin ?? 0.10;
    const allowUnshuffle = options.allowUnshuffle ?? true;

    const buildEdgeEntry = (img, side) => {
      const raw = extractEdgeStrip(img, side);
      const borderDepth = detectBorderArtifactDepth(img, side, 2);
      const trimmed = borderDepth > 0 ? extractEdgeStrip(img, side, 0, 1, DEFAULT_SAMPLES, borderDepth) : null;
      return { raw, trimmed, borderDepth };
    };

    const fullEdges = images.map((img) => ({
      top: buildEdgeEntry(img, 'top'),
      bottom: buildEdgeEntry(img, 'bottom'),
      left: buildEdgeEntry(img, 'left'),
      right: buildEdgeEntry(img, 'right'),
    }));

    const aspects = images.map(getAspect);

    // Pairwise horizontal (i left of j) and vertical (i above j) seam score matrices.
    const H = Array.from({ length: n }, () => new Array(n));
    const V = Array.from({ length: n }, () => new Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        H[i][j] = scoreEdgeEntryPair(fullEdges[i].right, fullEdges[j].left, minActivity);
        V[i][j] = scoreEdgeEntryPair(fullEdges[i].bottom, fullEdges[j].top, minActivity);
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
          let entry = subEdgeCache.get(key);
          if (!entry) {
            const borderDepth = fullEdges[imgIdx][side].borderDepth;
            const raw = extractEdgeStrip(images[imgIdx], side, startFrac, endFrac);
            const trimmed =
              borderDepth > 0
                ? extractEdgeStrip(images[imgIdx], side, startFrac, endFrac, DEFAULT_SAMPLES, borderDepth)
                : null;
            entry = { raw, trimmed, borderDepth };
            subEdgeCache.set(key, entry);
          }
          return entry;
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
                scoreEdgeEntryPair(leftTop, fullEdges[tr].left, minActivity),
                scoreEdgeEntryPair(leftBot, fullEdges[br].left, minActivity),
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
                scoreEdgeEntryPair(fullEdges[tl].right, rightTop, minActivity),
                scoreEdgeEntryPair(fullEdges[bl].right, rightBot, minActivity),
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
                scoreEdgeEntryPair(topLeft, fullEdges[bl].top, minActivity),
                scoreEdgeEntryPair(topRight, fullEdges[br].top, minActivity),
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
                scoreEdgeEntryPair(fullEdges[tl].bottom, botLeft, minActivity),
                scoreEdgeEntryPair(fullEdges[tr].bottom, botRight, minActivity),
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
    const isFullMatch = Boolean(
      winner &&
        winner.composite >= minComposite &&
        winner.minSeamScore >= minSeam &&
        winner.activeCount >= requiredActiveSeams,
    );

    if (isFullMatch) {
      const fullGroup = {
        type: 'stitched',
        indices: Array.from({ length: n }, (_, i) => i),
        layout: winner.layout,
        order: winner.order,
        wasUnshuffled,
        candidate: winner,
      };
      return {
        isMatch: true,
        isPartial: false,
        winner,
        wasUnshuffled,
        bestByLayout,
        groups: [fullGroup],
      };
    }

    // Full-gallery stitch did not match: search for partial split group(s) inside
    // mixed carousels (e.g. a 4-slice panorama followed by standalone artworks).
    if (n >= 3) {
      const partialGroups = detectPartialSplitGroups(n, H, V, aspects, {
        minComposite,
        minSeam,
        minActivity,
        allowUnshuffle,
        unshuffleMargin,
      });
      if (partialGroups) {
        const primaryGroup = partialGroups.find((item) => item.type === 'stitched') || null;
        return {
          isMatch: true,
          isPartial: true,
          winner: primaryGroup ? primaryGroup.candidate : winner,
          wasUnshuffled: Boolean(primaryGroup?.wasUnshuffled),
          bestByLayout,
          groups: partialGroups,
        };
      }
    }

    return {
      isMatch: false,
      isPartial: false,
      winner,
      wasUnshuffled: false,
      bestByLayout,
      groups: [],
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
   * Determine which sides of each ordered tile touch another tile inside the
   * stitched layout. Only internal seam edges are eligible for border-line
   * artifact trimming so outer borders of the artwork are always preserved.
   */
  function getInternalSeamSides(count, layout) {
    const sides = Array.from({ length: count }, () => ({
      left: false,
      right: false,
      top: false,
      bottom: false,
    }));

    if (layout === 'horizontal') {
      for (let i = 0; i < count; i++) {
        if (i > 0) sides[i].left = true;
        if (i + 1 < count) sides[i].right = true;
      }
      return sides;
    }

    if (layout === 'vertical') {
      for (let i = 0; i < count; i++) {
        if (i > 0) sides[i].top = true;
        if (i + 1 < count) sides[i].bottom = true;
      }
      return sides;
    }

    if (layout === '3-left-tall' && count === 3) {
      sides[0].right = true;
      sides[1].left = true;
      sides[1].bottom = true;
      sides[2].left = true;
      sides[2].top = true;
      return sides;
    }

    if (layout === '3-right-tall' && count === 3) {
      sides[0].right = true;
      sides[0].bottom = true;
      sides[1].right = true;
      sides[1].top = true;
      sides[2].left = true;
      return sides;
    }

    if (layout === '3-top-wide' && count === 3) {
      sides[0].bottom = true;
      sides[1].top = true;
      sides[1].right = true;
      sides[2].top = true;
      sides[2].left = true;
      return sides;
    }

    if (layout === '3-bottom-wide' && count === 3) {
      sides[0].bottom = true;
      sides[0].right = true;
      sides[1].bottom = true;
      sides[1].left = true;
      sides[2].top = true;
      return sides;
    }

    const grid = parseGridLayout(layout);
    if (grid && grid.rows * grid.cols === count) {
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          const idx = r * grid.cols + c;
          if (c > 0) sides[idx].left = true;
          if (c + 1 < grid.cols) sides[idx].right = true;
          if (r > 0) sides[idx].top = true;
          if (r + 1 < grid.rows) sides[idx].bottom = true;
        }
      }
    }

    return sides;
  }

  /**
   * Sample a narrow strip from a decoded high-res image along one edge to detect
   * exact pixel thickness of a uniform 1..maxTrim px border line artifact.
   */
  function measureOrigBorderTrim(decodedImg, side, maxTrim = 6) {
    if (!decodedImg?.source || typeof document === 'undefined') return 0;
    const isHorizontalEdge = side === 'top' || side === 'bottom';
    const depth = isHorizontalEdge ? decodedImg.height : decodedImg.width;
    const edgeLen = isHorizontalEdge ? decodedImg.width : decodedImg.height;
    const limit = Math.min(maxTrim, Math.floor((depth - 4) / 2));
    if (limit < 1 || edgeLen < 16) return 0;

    const band = limit + 3;
    const sampleLen = Math.min(96, edgeLen);
    const canvas = document.createElement('canvas');
    canvas.width = isHorizontalEdge ? sampleLen : band;
    canvas.height = isHorizontalEdge ? band : sampleLen;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;

    if (side === 'left') {
      ctx.drawImage(decodedImg.source, 0, 0, band, decodedImg.height, 0, 0, band, sampleLen);
    } else if (side === 'right') {
      ctx.drawImage(
        decodedImg.source,
        decodedImg.width - band,
        0,
        band,
        decodedImg.height,
        0,
        0,
        band,
        sampleLen,
      );
    } else if (side === 'top') {
      ctx.drawImage(decodedImg.source, 0, 0, decodedImg.width, band, 0, 0, sampleLen, band);
    } else {
      ctx.drawImage(
        decodedImg.source,
        0,
        decodedImg.height - band,
        decodedImg.width,
        band,
        0,
        0,
        sampleLen,
        band,
      );
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return detectBorderArtifactDepth(
      { width: canvas.width, height: canvas.height, data: imageData.data },
      side,
      limit,
    );
  }

  function resolveTileCrop(img, trim) {
    const left = Math.max(0, trim?.left || 0);
    const right = Math.max(0, trim?.right || 0);
    const top = Math.max(0, trim?.top || 0);
    const bottom = Math.max(0, trim?.bottom || 0);
    const sw = Math.max(1, img.width - left - right);
    const sh = Math.max(1, img.height - top - bottom);
    return { img, sx: left, sy: top, sw, sh };
  }

  /**
   * Compute pixel-accurate tile placement rectangles for the requested layout.
   * Preserves 1:1 native resolution whenever source dimensions align cleanly and
   * honors optional per-tile internal seam trims.
   */
  function computeLayoutPlan(images, layout, order, orderedTrims = null) {
    const tiles = order.map((idx, slotPos) =>
      resolveTileCrop(images[idx], orderedTrims ? orderedTrims[slotPos] : null),
    );
    const rects = [];
    let width = 0;
    let height = 0;

    if (layout === 'horizontal') {
      height = Math.max(...tiles.map((t) => t.sh));
      let x = 0;
      for (const tile of tiles) {
        const w = tile.sh === height ? tile.sw : Math.round((tile.sw * height) / tile.sh);
        rects.push({ ...tile, x, y: 0, w, h: height });
        x += w;
      }
      width = x;
    } else if (layout === 'vertical') {
      width = Math.max(...tiles.map((t) => t.sw));
      let y = 0;
      for (const tile of tiles) {
        const h = tile.sw === width ? tile.sh : Math.round((tile.sh * width) / tile.sw);
        rects.push({ ...tile, x: 0, y, w: width, h });
        y += h;
      }
      height = y;
    } else if (layout === '3-left-tall' && tiles.length === 3) {
      const [left, tr, br] = tiles;
      const rightBaseW = Math.max(tr.sw, br.sw);
      const trH0 = tr.sw === rightBaseW ? tr.sh : Math.round((tr.sh * rightBaseW) / tr.sw);
      const brH0 = br.sw === rightBaseW ? br.sh : Math.round((br.sh * rightBaseW) / br.sw);
      const rightTotalH0 = trH0 + brH0;

      height = Math.max(left.sh, rightTotalH0);
      const leftScale = height / left.sh;
      const rightScale = height / rightTotalH0;

      const leftW = leftScale === 1 ? left.sw : Math.round(left.sw * leftScale);
      const rightW = rightScale === 1 ? rightBaseW : Math.round(rightBaseW * rightScale);
      const trH = rightScale === 1 ? trH0 : Math.round(trH0 * rightScale);
      const brH = height - trH;

      rects.push({ ...left, x: 0, y: 0, w: leftW, h: height });
      rects.push({ ...tr, x: leftW, y: 0, w: rightW, h: trH });
      rects.push({ ...br, x: leftW, y: trH, w: rightW, h: brH });
      width = leftW + rightW;
    } else if (layout === '3-right-tall' && tiles.length === 3) {
      const [tl, bl, right] = tiles;
      const leftBaseW = Math.max(tl.sw, bl.sw);
      const tlH0 = tl.sw === leftBaseW ? tl.sh : Math.round((tl.sh * leftBaseW) / tl.sw);
      const blH0 = bl.sw === leftBaseW ? bl.sh : Math.round((bl.sh * leftBaseW) / bl.sw);
      const leftTotalH0 = tlH0 + blH0;

      height = Math.max(right.sh, leftTotalH0);
      const leftScale = height / leftTotalH0;
      const rightScale = height / right.sh;

      const leftW = leftScale === 1 ? leftBaseW : Math.round(leftBaseW * leftScale);
      const rightW = rightScale === 1 ? right.sw : Math.round(right.sw * rightScale);
      const tlH = leftScale === 1 ? tlH0 : Math.round(tlH0 * leftScale);
      const blH = height - tlH;

      rects.push({ ...tl, x: 0, y: 0, w: leftW, h: tlH });
      rects.push({ ...bl, x: 0, y: tlH, w: leftW, h: blH });
      rects.push({ ...right, x: leftW, y: 0, w: rightW, h: height });
      width = leftW + rightW;
    } else if (layout === '3-top-wide' && tiles.length === 3) {
      const [top, bl, br] = tiles;
      const botBaseH = Math.max(bl.sh, br.sh);
      const blW0 = bl.sh === botBaseH ? bl.sw : Math.round((bl.sw * botBaseH) / bl.sh);
      const brW0 = br.sh === botBaseH ? br.sw : Math.round((br.sw * botBaseH) / br.sh);
      const botTotalW0 = blW0 + brW0;

      width = Math.max(top.sw, botTotalW0);
      const topScale = width / top.sw;
      const botScale = width / botTotalW0;

      const topH = topScale === 1 ? top.sh : Math.round(top.sh * topScale);
      const botH = botScale === 1 ? botBaseH : Math.round(botBaseH * botScale);
      const blW = botScale === 1 ? blW0 : Math.round(blW0 * botScale);
      const brW = width - blW;

      rects.push({ ...top, x: 0, y: 0, w: width, h: topH });
      rects.push({ ...bl, x: 0, y: topH, w: blW, h: botH });
      rects.push({ ...br, x: blW, y: topH, w: brW, h: botH });
      height = topH + botH;
    } else if (layout === '3-bottom-wide' && tiles.length === 3) {
      const [tl, tr, bottom] = tiles;
      const topBaseH = Math.max(tl.sh, tr.sh);
      const tlW0 = tl.sh === topBaseH ? tl.sw : Math.round((tl.sw * topBaseH) / tl.sh);
      const trW0 = tr.sh === topBaseH ? tr.sw : Math.round((tr.sw * topBaseH) / tr.sh);
      const topTotalW0 = tlW0 + trW0;

      width = Math.max(bottom.sw, topTotalW0);
      const topScale = width / topTotalW0;
      const botScale = width / bottom.sw;

      const topH = topScale === 1 ? topBaseH : Math.round(topBaseH * topScale);
      const botH = botScale === 1 ? bottom.sh : Math.round(bottom.sh * botScale);
      const tlW = topScale === 1 ? tlW0 : Math.round(tlW0 * topScale);
      const trW = width - tlW;

      rects.push({ ...tl, x: 0, y: 0, w: tlW, h: topH });
      rects.push({ ...tr, x: tlW, y: 0, w: trW, h: topH });
      rects.push({ ...bottom, x: 0, y: topH, w: width, h: botH });
      height = topH + botH;
    } else {
      const grid = parseGridLayout(layout);
      if (!grid || grid.rows * grid.cols !== tiles.length) {
        return computeLayoutPlan(images, 'vertical', order, orderedTrims);
      }

      const rowInfos = [];
      for (let r = 0; r < grid.rows; r++) {
        const rowTiles = tiles.slice(r * grid.cols, (r + 1) * grid.cols);
        const rowH = Math.max(...rowTiles.map((t) => t.sh));
        const widths = rowTiles.map((t) => (t.sh === rowH ? t.sw : Math.round((t.sw * rowH) / t.sh)));
        const totalW = widths.reduce((acc, w) => acc + w, 0);
        rowInfos.push({ rowTiles, rowH, widths, totalW });
      }

      width = Math.max(...rowInfos.map((info) => info.totalW));
      let y = 0;
      for (const info of rowInfos) {
        const scale = width / info.totalW;
        const scaledH = scale === 1 ? info.rowH : Math.round(info.rowH * scale);
        let x = 0;
        for (let c = 0; c < info.rowTiles.length; c++) {
          const isLast = c === info.rowTiles.length - 1;
          const scaledW = isLast ? width - x : scale === 1 ? info.widths[c] : Math.round(info.widths[c] * scale);
          rects.push({ ...info.rowTiles[c], x, y, w: scaledW, h: scaledH });
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

  function renderStitchedCanvas(decodedImages, layout, order, { autoTrimBorders = true } = {}) {
    let orderedTrims = null;
    if (autoTrimBorders) {
      const seamSides = getInternalSeamSides(order.length, layout);
      orderedTrims = order.map((imgIdx, slotPos) => {
        const img = decodedImages[imgIdx];
        const mask = seamSides[slotPos];
        return {
          left: mask.left ? measureOrigBorderTrim(img, 'left') : 0,
          right: mask.right ? measureOrigBorderTrim(img, 'right') : 0,
          top: mask.top ? measureOrigBorderTrim(img, 'top') : 0,
          bottom: mask.bottom ? measureOrigBorderTrim(img, 'bottom') : 0,
        };
      });
    }

    const plan = computeLayoutPlan(decodedImages, layout, order, orderedTrims);
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    for (const rect of plan.rects) {
      ctx.drawImage(rect.img.source, rect.sx, rect.sy, rect.sw, rect.sh, rect.x, rect.y, rect.w, rect.h);
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
    chevron_left: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    chevron_right: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
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
    partialSuggested: IS_ZH ? '局部拼图' : 'Partial Split',
    multiGroupSuffix: IS_ZH ? '组拼图' : 'Split Groups',
    singleSlide: IS_ZH ? '单图' : 'Single',
    original: IS_ZH ? '原图' : 'Orig',
    auto: IS_ZH ? '自动' : 'Auto',
    unshuffledBadge: IS_ZH ? '已自动复原顺序' : 'Auto Unshuffled',
    orderBtnTitle: IS_ZH ? '调整切片顺序' : 'Adjust tile order',
    orderHint: IS_ZH ? '点击两块交换:' : 'Swap two:',
    autoOrder: IS_ZH ? '自动排序' : 'Auto',
    resetOrder: IS_ZH ? '默认' : 'Reset',
    zoomTitle: IS_ZH ? '全屏放大预览' : 'Fullscreen preview',
    downloadTitle: IS_ZH ? '下载当前原图' : 'Download current image',
    copyTitle: IS_ZH ? '复制当前图片到剪贴板' : 'Copy current image to clipboard',
    settingsTitle: IS_ZH ? '设置' : 'Settings',
    prevItemTitle: IS_ZH ? '上一项' : 'Previous item',
    nextItemTitle: IS_ZH ? '下一项' : 'Next item',
    loading: IS_ZH ? '拼合中...' : 'Stitching...',
    lbFit: IS_ZH ? '适应窗口' : 'Fit',
    lbActual: '1:1',
    lbDownload: IS_ZH ? '下载原图' : 'Download',
    lbCopy: IS_ZH ? '复制图片' : 'Copy',
    lbClose: IS_ZH ? '关闭' : 'Close',
    lbFooter: IS_ZH
      ? '滚轮缩放 · 拖拽平移 · 单击切换适应/原尺寸 · 快捷键: D 下载 / C 复制 / 0 适应 / ESC 关闭'
      : 'Wheel to zoom · Drag to pan · Click toggles Fit/1:1 · Keys: D download / C copy / 0 fit / ESC close',
    lbFooterMulti: IS_ZH
      ? '滚轮缩放 · 拖拽平移 · ←/→ 切换画廊 · 单击适应/1:1 · D 下载 / C 复制 / ESC 关闭'
      : 'Wheel zoom · Drag pan · ←/→ switch item · Click Fit/1:1 · D download / C copy / ESC close',
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

  function formatIndexRange(indices) {
    if (!indices || indices.length === 0) return '';
    const sorted = indices.slice().sort((a, b) => a - b);
    let contiguous = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) {
        contiguous = false;
        break;
      }
    }
    if (contiguous && sorted.length > 1) {
      return `${sorted[0] + 1}–${sorted[sorted.length - 1] + 1}`;
    }
    return sorted.map((i) => i + 1).join(',');
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

  function openLightbox({
    items,
    activeIndex = 0,
    onSelectIndex,
    onDownload,
    onCopy,
  }) {
    if (!Array.isArray(items) || items.length === 0) return;
    const existing = document.querySelector('.xas-lightbox');
    if (existing) existing.remove();

    const slideList = items.map((item) => ({ ...item, width: item.width || 0, height: item.height || 0 }));
    let currentIdx = Math.max(0, Math.min(slideList.length - 1, activeIndex));
    const isMulti = slideList.length > 1;

    const overlay = document.createElement('div');
    overlay.className = 'xas-lightbox';

    const header = document.createElement('div');
    header.className = 'xas-lb-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'xas-lb-title';

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
    viewport.appendChild(img);

    let prevBtn = null;
    let nextBtn = null;
    if (isMulti) {
      prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'xas-lb-nav xas-lb-prev';
      prevBtn.title = t('prevItemTitle');
      prevBtn.setAttribute('aria-label', t('prevItemTitle'));
      prevBtn.appendChild(createIcon('chevron_left', 24));
      prevBtn.addEventListener('click', (e) => {
        stopBubble(e);
        stepSlide(-1);
      });

      nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'xas-lb-nav xas-lb-next';
      nextBtn.title = t('nextItemTitle');
      nextBtn.setAttribute('aria-label', t('nextItemTitle'));
      nextBtn.appendChild(createIcon('chevron_right', 24));
      nextBtn.addEventListener('click', (e) => {
        stopBubble(e);
        stepSlide(1);
      });

      viewport.appendChild(prevBtn);
      viewport.appendChild(nextBtn);
    }

    const footer = document.createElement('div');
    footer.className = 'xas-lb-footer';
    footer.textContent = isMulti ? t('lbFooterMulti') : t('lbFooter');

    let curW = 1;
    let curH = 1;
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
      const w = Math.max(1, curW || img.naturalWidth || 1);
      const h = Math.max(1, curH || img.naturalHeight || 1);
      return Math.min(1, availW / w, availH / h);
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

    const updateTitle = () => {
      const item = slideList[currentIdx];
      const parts = [item.title];
      if (curW > 0 && curH > 0) parts.push(`${curW}×${curH}`);
      if (isMulti) parts.push(`${currentIdx + 1} / ${slideList.length}`);
      titleEl.textContent = parts.join(' · ');
    };

    const loadSlide = (idx) => {
      currentIdx = idx;
      const item = slideList[currentIdx];
      curW = item.width || 0;
      curH = item.height || 0;
      img.src = item.url;
      img.alt = item.title;
      updateTitle();
      if (prevBtn) prevBtn.style.display = currentIdx > 0 ? 'inline-flex' : 'none';
      if (nextBtn) nextBtn.style.display = currentIdx + 1 < slideList.length ? 'inline-flex' : 'none';
      if (curW > 0 && curH > 0) {
        requestAnimationFrame(setFit);
      }
    };

    img.addEventListener('load', () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        if (!curW || !curH) {
          curW = img.naturalWidth;
          curH = img.naturalHeight;
          slideList[currentIdx].width = curW;
          slideList[currentIdx].height = curH;
          updateTitle();
        }
        setFit();
      }
    });

    const stepSlide = (delta) => {
      const nextIdx = currentIdx + delta;
      if (nextIdx < 0 || nextIdx >= slideList.length) return;
      loadSlide(nextIdx);
      onSelectIndex?.(nextIdx);
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
      } else if (isMulti && e.key === 'ArrowLeft') {
        stopBubble(e);
        stepSlide(-1);
      } else if (isMulti && e.key === 'ArrowRight') {
        stopBubble(e);
        stepSlide(1);
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
        onDownload(currentIdx);
      } else if (e.key.toLowerCase() === 'c') {
        stopBubble(e);
        onCopy(currentIdx);
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
      if (e.button !== 0 || e.target.closest('.xas-lb-nav')) return;
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
    actions.appendChild(makeBtn(t('lbCopy'), false, () => onCopy(currentIdx), 'content_copy'));
    actions.appendChild(makeBtn(t('lbDownload'), true, () => onDownload(currentIdx), 'download'));
    actions.appendChild(makeBtn(t('lbClose'), false, close, 'close'));

    header.appendChild(titleEl);
    header.appendChild(actions);
    overlay.appendChild(header);
    overlay.appendChild(viewport);
    overlay.appendChild(footer);

    document.body.appendChild(overlay);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onResize);

    loadSlide(currentIdx);
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
   * Manage the injected UI controls and stitched / mixed-gallery preview stage
   * for a single tweet gallery.
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

    const stageMedia = document.createElement('div');
    stageMedia.className = 'xas-stage-media';

    const previewImg = document.createElement('img');
    previewImg.className = 'xas-preview';
    previewImg.addEventListener('click', (e) => {
      stopBubble(e);
      callbacks.onOpenLightbox();
    });

    const prevNavBtn = document.createElement('button');
    prevNavBtn.type = 'button';
    prevNavBtn.className = 'xas-nav-btn xas-nav-prev';
    prevNavBtn.title = t('prevItemTitle');
    prevNavBtn.setAttribute('aria-label', t('prevItemTitle'));
    prevNavBtn.style.display = 'none';
    prevNavBtn.appendChild(createIcon('chevron_left', 22));
    prevNavBtn.addEventListener('click', (e) => {
      stopBubble(e);
      if (state.activeIndex > 0) {
        callbacks.onSelectGalleryItem?.(state.activeIndex - 1);
      }
    });

    const nextNavBtn = document.createElement('button');
    nextNavBtn.type = 'button';
    nextNavBtn.className = 'xas-nav-btn xas-nav-next';
    nextNavBtn.title = t('nextItemTitle');
    nextNavBtn.setAttribute('aria-label', t('nextItemTitle'));
    nextNavBtn.style.display = 'none';
    nextNavBtn.appendChild(createIcon('chevron_right', 22));
    nextNavBtn.addEventListener('click', (e) => {
      stopBubble(e);
      if (state.activeIndex + 1 < state.items.length) {
        callbacks.onSelectGalleryItem?.(state.activeIndex + 1);
      }
    });

    const metaBadge = document.createElement('div');
    metaBadge.className = 'xas-meta-badge';

    stageMedia.appendChild(previewImg);
    stageMedia.appendChild(prevNavBtn);
    stageMedia.appendChild(nextNavBtn);
    stageMedia.appendChild(metaBadge);

    const filmstrip = document.createElement('div');
    filmstrip.className = 'xas-gallery-strip';
    filmstrip.style.display = 'none';
    filmstrip.addEventListener('click', stopBubble);
    filmstrip.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && filmstrip.scrollWidth > filmstrip.clientWidth) {
          e.preventDefault();
          filmstrip.scrollLeft += e.deltaY;
        }
      },
      { passive: false },
    );

    stage.appendChild(stageMedia);
    stage.appendChild(filmstrip);

    container.appendChild(stage);
    container.appendChild(toolbar);

    const state = {
      active: false,
      busy: false,
      expanded: false,
      showOrderEditor: false,
      selectedSlot: null,
      items: [], // [{ type: 'stitched', ... } | { type: 'single', ... }]
      activeIndex: 0,
      suggested: null, // full or partial suggestion
    };

    const fullLayouts = getAvailableLayouts(urls.length);

    const getActiveItem = () => (state.active ? state.items[state.activeIndex] || null : null);

    const formatSuggestionLabel = (s) => {
      if (s.isPartial) {
        if (s.stitchedCount > 1) {
          return `${s.stitchedCount} ${t('multiGroupSuffix')}`;
        }
        const range = formatIndexRange(s.primaryGroup.indices);
        return `${t('partialSuggested')} #${range} (${getLayoutLabel(s.primaryGroup.layout)})`;
      }
      return `${t('suggested')} (${getLayoutLabel(s.layout)})`;
    };

    const updateStageView = () => {
      const item = getActiveItem();
      if (!item) return;

      const isMulti = state.items.length > 1;
      previewImg.src = item.type === 'stitched' ? item.objectUrl : item.url;

      prevNavBtn.style.display = isMulti && state.activeIndex > 0 ? 'inline-flex' : 'none';
      nextNavBtn.style.display = isMulti && state.activeIndex + 1 < state.items.length ? 'inline-flex' : 'none';

      metaBadge.textContent = '';
      const parts = [];
      if (item.type === 'stitched') {
        if (item.wasUnshuffled) {
          metaBadge.appendChild(createIcon('auto_awesome', 14));
          parts.push(t('unshuffledBadge'));
        }
        if (isMulti) parts.push(`#${formatIndexRange(item.indices)}`);
        parts.push(getLayoutLabel(item.layout));
        if (item.width > 0 && item.height > 0) parts.push(`${item.width}×${item.height}`);
      } else {
        parts.push(`#${item.index + 1}`);
        parts.push(t('singleSlide'));
        if (item.width > 0 && item.height > 0) parts.push(`${item.width}×${item.height}`);
      }
      if (isMulti) {
        parts.push(`${state.activeIndex + 1} / ${state.items.length}`);
      }
      const metaText = document.createElement('span');
      metaText.textContent = parts.join(' · ');
      metaBadge.appendChild(metaText);

      if (!isMulti) {
        filmstrip.style.display = 'none';
        filmstrip.textContent = '';
        return;
      }

      filmstrip.style.display = 'flex';
      filmstrip.textContent = '';
      state.items.forEach((entry, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isSelected = idx === state.activeIndex;
        btn.className =
          'xas-thumb' +
          (entry.type === 'stitched' ? ' xas-thumb-stitched' : '') +
          (isSelected ? ' xas-thumb-active' : '');
        const label =
          entry.type === 'stitched'
            ? `${t('stitch')} #${formatIndexRange(entry.indices)} (${getLayoutLabel(entry.layout)})`
            : `#${entry.index + 1}`;
        btn.title = label;
        btn.setAttribute('aria-label', label);

        const thumbImg = document.createElement('img');
        thumbImg.className = 'xas-thumb-img';
        thumbImg.src = entry.type === 'stitched' ? entry.objectUrl : entry.thumbUrl;
        thumbImg.alt = label;
        btn.appendChild(thumbImg);

        const tag = document.createElement('span');
        tag.className = 'xas-thumb-tag';
        if (entry.type === 'stitched') {
          tag.appendChild(createIcon('grid_view', 11));
          const tagText = document.createElement('span');
          tagText.textContent = formatIndexRange(entry.indices);
          tag.appendChild(tagText);
        } else {
          tag.textContent = String(entry.index + 1);
        }
        btn.appendChild(tag);

        btn.addEventListener('click', (e) => {
          stopBubble(e);
          if (idx !== state.activeIndex) {
            callbacks.onSelectGalleryItem?.(idx);
          }
        });

        filmstrip.appendChild(btn);
        if (isSelected) {
          btn.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        }
      });
    };

    const renderToolbar = () => {
      toolbar.textContent = '';
      toolbar.classList.toggle('xas-expanded', state.expanded || state.active);

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

      if (!state.active && !state.expanded) {
        pill.classList.add(state.suggested ? 'xas-suggested' : 'xas-collapsed');
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = state.suggested ? 'xas-btn xas-btn-accent' : 'xas-btn';
        if (state.suggested) {
          appendIconLabel(trigger, 'auto_awesome', formatSuggestionLabel(state.suggested), 15);
        } else {
          appendIconLabel(trigger, 'grid_view', t('stitch'), 15);
        }
        trigger.addEventListener('click', (e) => {
          stopBubble(e);
          if (state.suggested) {
            if (state.suggested.isPartial) {
              callbacks.onOpenMixedGallery?.(state.suggested.groups);
            } else {
              callbacks.onSelectLayout(
                state.suggested.layout,
                state.suggested.order,
                state.suggested.wasUnshuffled,
              );
            }
          } else {
            state.expanded = true;
            renderToolbar();
          }
        });
        pill.appendChild(trigger);
        toolbar.appendChild(pill);
        return;
      }

      const activeItem = getActiveItem();
      const isStitchedItem = Boolean(activeItem && activeItem.type === 'stitched');

      // Restore original view button (or collapse if not active)
      const origBtn = document.createElement('button');
      origBtn.type = 'button';
      origBtn.className = state.active ? 'xas-btn' : 'xas-btn xas-btn-active';
      origBtn.textContent = t('original');
      origBtn.addEventListener('click', (e) => {
        stopBubble(e);
        state.expanded = false;
        state.showOrderEditor = false;
        state.selectedSlot = null;
        if (state.active) {
          callbacks.onRestoreOriginal();
        } else {
          renderToolbar();
        }
      });
      pill.appendChild(origBtn);

      if (!state.active) {
        for (const layout of fullLayouts) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'xas-btn';
          btn.textContent = getLayoutLabel(layout);
          btn.addEventListener('click', (e) => {
            stopBubble(e);
            callbacks.onSelectLayout(layout, null, false);
          });
          pill.appendChild(btn);
        }

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
        if (isStitchedItem) {
          const groupLayouts = getAvailableLayouts(activeItem.indices.length);
          for (const layout of groupLayouts) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = activeItem.layout === layout ? 'xas-btn xas-btn-active' : 'xas-btn';
            btn.textContent = getLayoutLabel(layout);
            btn.addEventListener('click', (e) => {
              stopBubble(e);
              callbacks.onSelectLayout(layout, null, false);
            });
            pill.appendChild(btn);
          }
        }

        const sep = document.createElement('span');
        sep.className = 'xas-sep';
        pill.appendChild(sep);

        if (isStitchedItem) {
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
        }

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

      // Optional inline tile-order swapper bar for the active stitched item
      if (isStitchedItem && state.showOrderEditor) {
        const orderBar = document.createElement('div');
        orderBar.className = 'xas-order-bar';

        const hint = document.createElement('span');
        hint.className = 'xas-order-hint';
        hint.textContent = t('orderHint');
        orderBar.appendChild(hint);

        activeItem.order.forEach((localIdx, slotPos) => {
          const origTweetIdx = activeItem.indices[localIdx];
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className =
            state.selectedSlot === slotPos ? 'xas-slot-chip xas-slot-selected' : 'xas-slot-chip';
          chip.textContent = String(origTweetIdx + 1);
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
            const nextOrder = activeItem.order.slice();
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
          callbacks.onAutoSolve(activeItem.layout);
        });
        orderBar.appendChild(autoOrderBtn);

        const resetOrderBtn = document.createElement('button');
        resetOrderBtn.type = 'button';
        resetOrderBtn.className = 'xas-btn';
        appendIconLabel(resetOrderBtn, 'restart_alt', t('resetOrder'), 14);
        resetOrderBtn.addEventListener('click', (e) => {
          stopBubble(e);
          callbacks.onChangeOrder(Array.from({ length: activeItem.indices.length }, (_, i) => i));
        });
        orderBar.appendChild(resetOrderBtn);

        toolbar.appendChild(orderBar);
      }
    };

    renderToolbar();

    const showGallery = ({ items, activeIndex = 0 }) => {
      state.active = true;
      state.busy = false;
      state.items = items;
      state.activeIndex = Math.max(0, Math.min(items.length - 1, activeIndex));
      const current = getActiveItem();
      if (!current || current.type !== 'stitched') {
        state.showOrderEditor = false;
        state.selectedSlot = null;
      }

      updateStageView();
      stage.style.display = 'flex';
      container.classList.add('xas-active');
      renderToolbar();
    };

    return {
      setBusy(isBusy) {
        state.busy = isBusy;
        renderToolbar();
      },
      setSuggested(suggestion) {
        state.suggested = suggestion;
        renderToolbar();
      },
      showGallery,
      showOriginal() {
        state.active = false;
        state.busy = false;
        state.showOrderEditor = false;
        state.selectedSlot = null;
        state.items = [];
        state.activeIndex = 0;
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
  const STYLES_CSS = `
  .xas-root {
    position: relative !important;
  }

  .xas-root.xas-active {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
  }

  .xas-root.xas-active > :not(.xas-injected) {
    display: none !important;
  }

  .xas-stage {
    position: relative;
    width: 100%;
    border-radius: 16px;
    overflow: hidden;
    background: rgba(15, 20, 25, 0.35);
    border: 1px solid rgba(128, 128, 128, 0.22);
    display: flex;
    flex-direction: column;
  }

  .xas-stage-media {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 14, 18, 0.45);
  }

  .xas-preview {
    display: block;
    width: 100%;
    height: auto;
    max-height: 76vh;
    object-fit: contain;
    cursor: zoom-in;
    user-select: none;
    -webkit-user-drag: none;
  }

  .xas-nav-btn {
    appearance: none;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 26;
    width: 34px;
    height: 34px;
    padding: 0;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(15, 20, 25, 0.72);
    color: #eff3f4;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    opacity: 0;
    transition: opacity 0.16s ease, background 0.14s ease, transform 0.12s ease;
  }

  .xas-stage-media:hover .xas-nav-btn,
  .xas-root:hover .xas-nav-btn,
  .xas-nav-btn:focus-visible {
    opacity: 1;
  }

  .xas-nav-btn:hover {
    background: rgba(29, 155, 240, 0.88);
    border-color: rgba(255, 255, 255, 0.35);
  }

  .xas-nav-prev {
    left: 10px;
  }

  .xas-nav-next {
    right: 10px;
  }

  .xas-gallery-strip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 9px;
    background: rgba(15, 20, 25, 0.86);
    border-top: 1px solid rgba(255, 255, 255, 0.12);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
  }

  .xas-gallery-strip::-webkit-scrollbar {
    height: 5px;
  }

  .xas-gallery-strip::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.22);
    border-radius: 999px;
  }

  .xas-thumb {
    appearance: none;
    position: relative;
    flex: 0 0 auto;
    height: 52px;
    min-width: 40px;
    max-width: 120px;
    padding: 0;
    border-radius: 8px;
    overflow: hidden;
    border: 2px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.06);
    cursor: pointer;
    opacity: 0.72;
    transition: opacity 0.14s ease, border-color 0.14s ease, transform 0.12s ease;
  }

  .xas-thumb:hover {
    opacity: 0.96;
    border-color: rgba(255, 255, 255, 0.42);
  }

  .xas-thumb.xas-thumb-stitched {
    min-width: 72px;
  }

  .xas-thumb.xas-thumb-active {
    opacity: 1;
    border-color: #1d9bf0;
    box-shadow: 0 0 0 1px rgba(29, 155, 240, 0.55);
  }

  .xas-thumb-img {
    display: block;
    height: 100%;
    width: auto;
    max-width: 120px;
    min-width: 40px;
    object-fit: cover;
    pointer-events: none;
    user-select: none;
    -webkit-user-drag: none;
  }

  .xas-thumb-tag {
    position: absolute;
    left: 3px;
    bottom: 3px;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 5px;
    border-radius: 999px;
    background: rgba(15, 20, 25, 0.82);
    color: #eff3f4;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
  }

  .xas-thumb-stitched .xas-thumb-tag {
    background: rgba(29, 155, 240, 0.9);
    color: #ffffff;
  }

  .xas-toolbar {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 30;
    max-width: calc(100% - 16px);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 12px;
    line-height: 1;
    pointer-events: auto;
  }

  .xas-pill {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
    padding: 4px 6px;
    border-radius: 999px;
    background: rgba(15, 20, 25, 0.78);
    color: #eff3f4;
    border: 1px solid rgba(255, 255, 255, 0.16);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);
    opacity: 0.78;
    transition: opacity 0.16s ease, background 0.16s ease, border-color 0.16s ease;
  }

  .xas-root:hover .xas-pill,
  .xas-toolbar:hover .xas-pill,
  .xas-toolbar.xas-expanded .xas-pill,
  .xas-pill.xas-suggested {
    opacity: 1;
  }

  .xas-pill.xas-suggested {
    border-color: rgba(29, 155, 240, 0.75);
    background: rgba(15, 24, 34, 0.88);
  }

  .xas-pill.xas-collapsed {
    opacity: 0.52;
    padding: 3px 5px;
  }

  .xas-root:hover .xas-pill.xas-collapsed {
    opacity: 0.95;
  }

  .xas-icon {
    display: block;
    flex-shrink: 0;
    fill: currentColor;
  }

  .xas-btn {
    appearance: none;
    border: none;
    background: transparent;
    color: #eff3f4;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    height: 26px;
    padding: 0 9px;
    border-radius: 999px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    white-space: nowrap;
    transition: background 0.14s ease, color 0.14s ease;
  }

  .xas-btn.xas-btn-icon {
    width: 26px;
    padding: 0;
  }

  .xas-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .xas-btn:disabled {
    opacity: 0.45;
    cursor: wait;
  }

  .xas-btn.xas-btn-active {
    background: #1d9bf0;
    color: #ffffff;
  }

  .xas-btn.xas-btn-accent {
    color: #6cc5ff;
  }

  .xas-sep {
    width: 1px;
    height: 14px;
    background: rgba(255, 255, 255, 0.18);
    margin: 0 2px;
  }

  .xas-order-bar {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 5px 8px;
    border-radius: 12px;
    background: rgba(15, 20, 25, 0.9);
    color: #eff3f4;
    border: 1px solid rgba(255, 255, 255, 0.18);
    backdrop-filter: blur(10px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.38);
  }

  .xas-order-hint {
    font-size: 11px;
    color: #8b98a5;
    margin-right: 2px;
  }

  .xas-slot-chip {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.24);
    background: rgba(255, 255, 255, 0.08);
    color: #eff3f4;
    font: inherit;
    font-weight: 700;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.14s ease, border-color 0.14s ease, transform 0.1s ease;
  }

  .xas-slot-chip:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .xas-slot-chip.xas-slot-selected {
    background: #1d9bf0;
    border-color: #6cc5ff;
    color: #fff;
    transform: scale(1.06);
  }

  .xas-meta-badge {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 25;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 9px;
    border-radius: 999px;
    background: rgba(15, 20, 25, 0.72);
    color: #e7e9ea;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(8px);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.18s ease;
  }

  .xas-stage:hover .xas-meta-badge,
  .xas-root:hover .xas-meta-badge {
    opacity: 1;
  }

  .xas-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.28);
    border-top-color: #1d9bf0;
    border-radius: 50%;
    animation: xas-spin 0.75s linear infinite;
  }

  @keyframes xas-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Fullscreen Lightbox */
  .xas-lightbox {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    background: rgba(0, 0, 0, 0.92);
    backdrop-filter: blur(10px);
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #eff3f4;
    user-select: none;
  }

  .xas-lb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 18px;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0));
    z-index: 2;
  }

  .xas-lb-title {
    font-size: 13px;
    font-weight: 600;
    color: #e7e9ea;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .xas-lb-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .xas-lb-btn {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(25, 32, 40, 0.85);
    color: #eff3f4;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    white-space: nowrap;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .xas-lb-btn:hover {
    background: rgba(45, 58, 72, 0.95);
    border-color: rgba(255, 255, 255, 0.35);
  }

  .xas-lb-btn.xas-lb-primary {
    background: #1d9bf0;
    border-color: #1d9bf0;
    color: #fff;
  }

  .xas-lb-btn.xas-lb-primary:hover {
    background: #1a8cd8;
  }

  .xas-lb-viewport {
    flex: 1;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
  }

  .xas-lb-viewport.xas-dragging {
    cursor: grabbing;
  }

  .xas-lb-nav {
    appearance: none;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 4;
    width: 42px;
    height: 42px;
    padding: 0;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(20, 27, 34, 0.78);
    color: #eff3f4;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(8px);
    transition: background 0.14s ease, border-color 0.14s ease;
  }

  .xas-lb-nav:hover {
    background: rgba(29, 155, 240, 0.88);
    border-color: rgba(255, 255, 255, 0.45);
  }

  .xas-lb-prev {
    left: 16px;
  }

  .xas-lb-next {
    right: 16px;
  }

  .xas-lb-img {
    max-width: none;
    max-height: none;
    transform-origin: center center;
    will-change: transform;
    -webkit-user-drag: none;
    user-select: none;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.65);
  }

  .xas-lb-footer {
    padding: 8px 16px;
    text-align: center;
    font-size: 11px;
    color: #8b98a5;
    pointer-events: none;
  }

  /* Settings Modal */
  .xas-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483100;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  .xas-modal {
    width: 100%;
    max-width: 440px;
    background: #15202b;
    color: #eff3f4;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }

  .xas-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .xas-modal-head h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
  }

  .xas-modal-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .xas-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
  }

  .xas-field-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }

  .xas-field-desc {
    font-size: 11px;
    color: #8b98a5;
    margin-top: 2px;
  }

  .xas-select,
  .xas-input {
    background: #1e2d3d;
    color: #eff3f4;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    padding: 6px 10px;
    font: inherit;
    font-size: 13px;
  }

  .xas-checkbox {
    width: 18px;
    height: 18px;
    accent-color: #1d9bf0;
    cursor: pointer;
  }

  .xas-modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  /* Toast */
  .xas-toast {
    position: fixed;
    left: 50%;
    bottom: 26px;
    transform: translateX(-50%) translateY(12px);
    z-index: 2147483200;
    padding: 10px 16px;
    border-radius: 999px;
    background: rgba(15, 20, 25, 0.94);
    color: #eff3f4;
    border: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    font-weight: 600;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease, transform 0.18s ease;
  }

  .xas-toast.xas-toast-visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  .xas-toast.xas-toast-error {
    border-color: rgba(244, 33, 46, 0.7);
    color: #ff9aa2;
  }
  `;

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
