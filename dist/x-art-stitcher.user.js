// ==UserScript==
// @name              X Art Stitcher
// @name:zh-CN        X 画师拼图自动还原
// @namespace         https://github.com/anfsity/x-art-stitcher
// @version           1.0.0
// @description       Automatically detect, unshuffle, and stitch multi-image artist artworks on X (Twitter), plus recognize GIFs and short silent videos for instant MP4-to-GIF / MP4 export with fullscreen lightbox, lossless download, and clipboard copy.
// @description:zh-CN 自动识别并拼合 X (Twitter) 上画师发布的多图/四宫格/长图/多图轮播及防 AI 乱序切片作品，并自动识别 GIF 与类 GIF 短视频，支持浏览器端无损转存 GIF / 下载 MP4 原视频与全屏高清灯箱预览。
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
// @connect           video.twimg.com
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
    enableGifTools: true,
    autoDetectGifVideos: true,
    showOnRegularVideos: true,
    gifFps: 15, // 10 | 15 | 20 | 25
    gifMaxWidth: 540, // 480 | 540 | 720 | 0 (original)
    gifQuality: 'balanced', // 'fast' | 'balanced' | 'high'
    gifMaxDuration: 15, // 8 | 15 | 25 (seconds)
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
    if (/format=mp4|\.mp4(?:$|[?:])/i.test(fallbackUrl)) return 'video/mp4';
    if (/format=gif|\.gif(?:$|[?:])/i.test(fallbackUrl)) return 'image/gif';
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

  function fetchRangeBuffer(url, startByte = 0, endByte = 65535) {
    const rangeHeader = `bytes=${startByte}-${endByte}`;
    return new Promise((resolve, reject) => {
      const gmRequest =
        typeof GM_xmlhttpRequest === 'function'
          ? GM_xmlhttpRequest
          : typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function'
            ? GM.xmlHttpRequest
            : null;

      if (!gmRequest) {
        fetch(url, { mode: 'cors', headers: { Range: rangeHeader } })
          .then(async (res) => {
            if (res.status !== 200 && res.status !== 206) {
              throw new Error(`HTTP ${res.status}`);
            }
            resolve(await res.arrayBuffer());
          })
          .catch(reject);
        return;
      }

      gmRequest({
        method: 'GET',
        url,
        headers: { Range: rangeHeader },
        responseType: 'arraybuffer',
        timeout: 10000,
        onload(res) {
          if ((res.status === 200 || res.status === 206) && res.response) {
            resolve(res.response);
          } else {
            reject(new Error(`HTTP ${res.status} for range ${url}`));
          }
        },
        onerror(err) {
          reject(new Error(`Network error for ${url}: ${err?.error || 'unknown'}`));
        },
        ontimeout() {
          reject(new Error(`Timeout fetching range ${url}`));
        },
      });
    });
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

  function isTweetVideoUrl(src) {
    if (!src || typeof src !== 'string') return false;
    try {
      const u = new URL(src);
      return (
        u.hostname === 'video.twimg.com' ||
        (u.hostname.endsWith('.twimg.com') && u.pathname.includes('video'))
      );
    } catch (_) {
      return false;
    }
  }

  function extractVideoMediaKey(src) {
    if (!src || typeof src !== 'string') return null;
    try {
      const u = new URL(src);
      const tweetVideoMatch = u.pathname.match(/\/tweet_video(?:_thumb)?\/([^/.?]+)/i);
      if (tweetVideoMatch) return `tweet_video:${tweetVideoMatch[1]}`;

      const extMatch = u.pathname.match(/\/ext_tw_video(?:_thumb)?\/(\d+)\//i);
      if (extMatch) return `ext_tw_video:${extMatch[1]}`;

      const ampMatch = u.pathname.match(/\/amplify_video(?:_thumb)?\/(\d+)\//i);
      if (ampMatch) return `amplify_video:${ampMatch[1]}`;

      if (u.hostname === 'video.twimg.com') {
        return u.pathname.replace(/\.[a-z0-9]+$/i, '');
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function parseVariantDimensions(url) {
    if (!url || typeof url !== 'string') return { width: 0, height: 0 };
    const match = url.match(/\/(\d{2,4})x(\d{2,4})\//);
    if (!match) return { width: 0, height: 0 };
    return { width: Number(match[1]), height: Number(match[2]) };
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

  // --- mp4.js ---
  const MAX_STTS_SAMPLES = 6000;

  function readFourCC(view, offset) {
    return String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
  }

  function readUint64(view, offset) {
    const hi = view.getUint32(offset, false);
    const lo = view.getUint32(offset + 4, false);
    return hi * 4294967296 + lo;
  }

  function iterBoxes(view, start, end, onBox) {
    let offset = start;
    while (offset + 8 <= end) {
      const size32 = view.getUint32(offset, false);
      const type = readFourCC(view, offset + 4);
      let headerSize = 8;
      let boxSize = size32;

      if (size32 === 1) {
        if (offset + 16 > end) {
          onBox({ type, start: offset, headerSize: 16, boxEnd: end, truncated: true });
          break;
        }
        boxSize = readUint64(view, offset + 8);
        headerSize = 16;
      } else if (size32 === 0) {
        boxSize = end - offset;
      }

      if (!Number.isFinite(boxSize) || boxSize < headerSize) break;
      const rawEnd = offset + boxSize;
      const truncated = rawEnd > end;
      const boxEnd = truncated ? end : rawEnd;

      onBox({ type, start: offset, headerSize, boxEnd, truncated });
      if (truncated || boxEnd <= offset) break;
      offset = boxEnd;
    }
  }

  function parseTrackBox(view, trakStart, trakEnd) {
    const track = {
      handlerType: '',
      timescale: 0,
      mdhdDuration: 0,
      width: 0,
      height: 0,
      totalSamples: 0,
      totalDtsTicks: 0,
      dtsTicks: [],
      cttsOffsets: [],
    };

    const walkStbl = (stblStart, stblEnd) => {
      iterBoxes(view, stblStart, stblEnd, ({ type, start, headerSize, boxEnd }) => {
        const payload = start + headerSize;
        if (type === 'stts' && payload + 8 <= boxEnd) {
          const entryCount = view.getUint32(payload + 4, false);
          let pos = payload + 8;
          for (let i = 0; i < entryCount && pos + 8 <= boxEnd; i++, pos += 8) {
            const sampleCount = view.getUint32(pos, false);
            const sampleDelta = view.getUint32(pos + 4, false);
            track.totalSamples += sampleCount;
            const remaining = MAX_STTS_SAMPLES - track.dtsTicks.length;
            const expandCount = Math.min(sampleCount, remaining);
            for (let s = 0; s < expandCount; s++) {
              track.dtsTicks.push(track.totalDtsTicks);
              track.totalDtsTicks += sampleDelta;
            }
            if (sampleCount > expandCount) {
              track.totalDtsTicks += (sampleCount - expandCount) * sampleDelta;
            }
          }
        } else if (type === 'ctts' && payload + 8 <= boxEnd) {
          const version = view.getUint8(payload);
          const entryCount = view.getUint32(payload + 4, false);
          let pos = payload + 8;
          for (let i = 0; i < entryCount && pos + 8 <= boxEnd; i++, pos += 8) {
            const sampleCount = view.getUint32(pos, false);
            const sampleOffset =
              version === 0 ? view.getUint32(pos + 4, false) : view.getInt32(pos + 4, false);
            const remaining = MAX_STTS_SAMPLES - track.cttsOffsets.length;
            const expandCount = Math.min(sampleCount, remaining);
            for (let s = 0; s < expandCount; s++) {
              track.cttsOffsets.push(sampleOffset);
            }
            if (track.cttsOffsets.length >= MAX_STTS_SAMPLES) break;
          }
        }
      });
    };

    const walkMinf = (minfStart, minfEnd) => {
      iterBoxes(view, minfStart, minfEnd, ({ type, start, headerSize, boxEnd }) => {
        if (type === 'stbl') walkStbl(start + headerSize, boxEnd);
      });
    };

    const walkMdia = (mdiaStart, mdiaEnd) => {
      iterBoxes(view, mdiaStart, mdiaEnd, ({ type, start, headerSize, boxEnd }) => {
        const payload = start + headerSize;
        if (type === 'mdhd' && payload + 20 <= boxEnd) {
          const version = view.getUint8(payload);
          if (version === 0) {
            track.timescale = view.getUint32(payload + 12, false);
            track.mdhdDuration = view.getUint32(payload + 16, false);
          } else if (version === 1 && payload + 32 <= boxEnd) {
            track.timescale = view.getUint32(payload + 20, false);
            track.mdhdDuration = readUint64(view, payload + 24);
          }
        } else if (type === 'hdlr' && payload + 12 <= boxEnd) {
          track.handlerType = readFourCC(view, payload + 8);
        } else if (type === 'minf') {
          walkMinf(payload, boxEnd);
        }
      });
    };

    iterBoxes(view, trakStart, trakEnd, ({ type, start, headerSize, boxEnd }) => {
      const payload = start + headerSize;
      if (type === 'tkhd' && payload + 84 <= boxEnd) {
        const version = view.getUint8(payload);
        if (version === 0) {
          track.width = view.getUint32(payload + 76, false) / 65536;
          track.height = view.getUint32(payload + 80, false) / 65536;
        } else if (version === 1 && payload + 96 <= boxEnd) {
          track.width = view.getUint32(payload + 88, false) / 65536;
          track.height = view.getUint32(payload + 92, false) / 65536;
        }
      } else if (type === 'mdia') {
        walkMdia(payload, boxEnd);
      }
    });

    return track;
  }

  /**
   * Inspect ISO-BMFF (MP4) header boxes using zero external dependencies.
   * Gracefully detects truncated `moov` atoms in partial HTTP Range responses.
   */
  function parseMp4Metadata(buffer) {
    const bytes =
      buffer instanceof Uint8Array
        ? buffer
        : ArrayBuffer.isView(buffer)
          ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
          : new Uint8Array(buffer || 0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let hasMoov = false;
    let complete = false;
    let hasAudio = false;
    let hasVideo = false;
    let primaryVideo = null;

    iterBoxes(view, 0, bytes.byteLength, ({ type, start, headerSize, boxEnd, truncated }) => {
      if (type !== 'moov') return;
      hasMoov = true;
      complete = !truncated;
      if (!complete) return;

      iterBoxes(view, start + headerSize, boxEnd, (child) => {
        if (child.type !== 'trak' || child.truncated) return;
        const track = parseTrackBox(view, child.start + child.headerSize, child.boxEnd);
        if (track.handlerType === 'soun') {
          hasAudio = true;
        } else if (track.handlerType === 'vide') {
          hasVideo = true;
          if (!primaryVideo || (track.totalSamples > 0 && primaryVideo.totalSamples === 0)) {
            primaryVideo = track;
          }
        }
      });
    });

    if (!primaryVideo) {
      return {
        hasMoov,
        complete,
        hasAudio,
        hasVideo,
        durationSec: 0,
        width: 0,
        height: 0,
        frameCount: 0,
        avgFps: 0,
        frameTimestamps: [],
      };
    }

    const timescale = primaryVideo.timescale || 0;
    let durationSec = 0;
    if (timescale > 0) {
      if (primaryVideo.mdhdDuration > 0) {
        durationSec = primaryVideo.mdhdDuration / timescale;
      } else if (primaryVideo.totalDtsTicks > 0) {
        durationSec = primaryVideo.totalDtsTicks / timescale;
      }
    }

    const frameTimestamps = [];
    if (timescale > 0 && primaryVideo.dtsTicks.length > 0) {
      const ptsTicks = primaryVideo.dtsTicks.map((dts, i) => {
        const offset = i < primaryVideo.cttsOffsets.length ? primaryVideo.cttsOffsets[i] : 0;
        return dts + offset;
      });
      ptsTicks.sort((a, b) => a - b);
      const baseTick = ptsTicks[0];
      for (let i = 0; i < ptsTicks.length; i++) {
        frameTimestamps.push((ptsTicks[i] - baseTick) / timescale);
      }
    }

    const frameCount = primaryVideo.totalSamples || frameTimestamps.length;
    let avgFps = 0;
    if (durationSec > 0 && frameCount > 0) {
      avgFps = frameCount / durationSec;
    } else if (frameTimestamps.length >= 2) {
      const span = frameTimestamps[frameTimestamps.length - 1] - frameTimestamps[0];
      if (span > 0) avgFps = (frameTimestamps.length - 1) / span;
    }

    return {
      hasMoov,
      complete,
      hasAudio,
      hasVideo,
      durationSec,
      width: Math.round(primaryVideo.width),
      height: Math.round(primaryVideo.height),
      frameCount,
      avgFps,
      frameTimestamps,
    };
  }

  /**
   * Plan deterministic video seek timestamps and GIF centisecond frame delays.
   * Preserves native cadence for low-FPS GIFs and snaps downsampled timestamps to
   * real frame presentation times to eliminate judder.
   */
  function planFrameSchedule(
    mp4Meta,
    fallbackDurationSec,
    { targetFps = 15, maxDurationSec = 15, maxFrames = 240 } = {},
  ) {
    const safeFps = Math.max(1, Number(targetFps) || 15);
    const safeMaxDuration = Math.max(0.1, Number(maxDurationSec) || 15);
    const safeMaxFrames = Math.max(1, Number(maxFrames) || 240);

    let totalDuration =
      Number.isFinite(fallbackDurationSec) && fallbackDurationSec > 0
        ? fallbackDurationSec
        : mp4Meta?.durationSec || 0;

    const nativePts = Array.isArray(mp4Meta?.frameTimestamps) ? mp4Meta.frameTimestamps : [];
    if (totalDuration <= 0 && nativePts.length >= 2) {
      const stepEst =
        (nativePts[nativePts.length - 1] - nativePts[0]) / Math.max(1, nativePts.length - 1);
      totalDuration = nativePts[nativePts.length - 1] + stepEst;
    }
    if (totalDuration <= 0) totalDuration = 1 / safeFps;

    const effectiveDuration = Math.min(totalDuration, safeMaxDuration);
    const truncated = totalDuration > safeMaxDuration + 0.15;

    let timestamps = [];
    if (nativePts.length >= 2) {
      const filtered = nativePts.filter((t) => t < effectiveDuration - 0.001);
      if (filtered.length === 0) filtered.push(nativePts[0]);

      const nativeFps =
        mp4Meta.avgFps > 0
          ? mp4Meta.avgFps
          : filtered.length / Math.max(0.01, effectiveDuration);

      if (nativeFps <= safeFps * 1.15 && filtered.length <= safeMaxFrames) {
        timestamps = filtered;
      } else {
        const targetStep = 1 / safeFps;
        let cursor = 0;
        let lastPickedIdx = -1;
        for (let k = 0; k < safeMaxFrames; k++) {
          const idealT = k * targetStep;
          if (idealT >= effectiveDuration - 0.001 && k > 0) break;

          while (cursor + 1 < filtered.length && filtered[cursor + 1] <= idealT) {
            cursor++;
          }
          let bestIdx = cursor;
          if (
            cursor + 1 < filtered.length &&
            Math.abs(filtered[cursor + 1] - idealT) < Math.abs(filtered[cursor] - idealT)
          ) {
            bestIdx = cursor + 1;
          }
          if (bestIdx > lastPickedIdx) {
            timestamps.push(filtered[bestIdx]);
            lastPickedIdx = bestIdx;
          }
        }
        if (timestamps.length === 0) {
          timestamps.push(filtered[0]);
        }
      }
    } else {
      const step = 1 / safeFps;
      for (let k = 0; k < safeMaxFrames; k++) {
        const t = k * step;
        if (t >= effectiveDuration - 0.001 && k > 0) break;
        timestamps.push(t);
      }
      if (timestamps.length === 0) timestamps.push(0);
    }

    const diffs = [];
    for (let i = 0; i + 1 < timestamps.length; i++) {
      diffs.push(Math.max(0.02, timestamps[i + 1] - timestamps[i]));
    }
    const sortedDiffs = diffs.slice().sort((a, b) => a - b);
    const medianStep =
      sortedDiffs.length > 0 ? sortedDiffs[Math.floor(sortedDiffs.length / 2)] : 1 / safeFps;

    const delaysCs = new Array(timestamps.length);
    for (let i = 0; i < timestamps.length; i++) {
      let dt;
      if (i + 1 < timestamps.length) {
        dt = timestamps[i + 1] - timestamps[i];
      } else {
        const tail = effectiveDuration - timestamps[i];
        dt = tail >= medianStep * 0.5 && tail <= medianStep * 2 ? tail : medianStep;
      }
      delaysCs[i] = Math.max(2, Math.min(65535, Math.round(dt * 100)));
    }

    return {
      timestamps,
      delaysCs,
      effectiveDuration,
      truncated,
    };
  }

  /**
   * Classify an X video entry into:
   * - 'native_gif': X's own animated_gif / tweet_video posts
   * - 'gif_like_video': Short silent MP4 clips verified via ISO-BMFF probe
   * - 'video': Regular video with audio or longer duration
   */
  function classifyGifMedia({
    type,
    mp4Url,
    posterUrl,
    hasGifBadge,
    durationMs,
    mp4Probe,
    maxAutoDurationSec = 12,
  }) {
    if (
      type === 'animated_gif' ||
      hasGifBadge ||
      (typeof mp4Url === 'string' && /\/tweet_video\//i.test(mp4Url)) ||
      (typeof posterUrl === 'string' && /\/tweet_video_thumb\//i.test(posterUrl))
    ) {
      return 'native_gif';
    }

    if (mp4Probe?.complete && mp4Probe.hasVideo && !mp4Probe.hasAudio) {
      const durationSec =
        mp4Probe.durationSec > 0
          ? mp4Probe.durationSec
          : Number.isFinite(durationMs) && durationMs > 0
            ? durationMs / 1000
            : 0;
      if (durationSec > 0 && durationSec <= maxAutoDurationSec) {
        return 'gif_like_video';
      }
    }

    return 'video';
  }

  // --- gif.js ---
  const GIF_TRANSPARENT_IDX = 255;
  const GIF_MAX_PALETTE_COLORS = 255;
  const LZW_HASH_SIZE = 5003;

  const BAYER_4X4 = [
    -7.5, 0.5, -5.5, 2.5,
    4.5, -3.5, 6.5, -1.5,
    -4.5, 3.5, -6.5, 1.5,
    7.5, -0.5, 5.5, -2.5,
  ];

  function buildMedianCutPalette(samples, maxColors = GIF_MAX_PALETTE_COLORS) {
    const counts = new Uint32Array(32768);
    const sumR = new Float64Array(32768);
    const sumG = new Float64Array(32768);
    const sumB = new Float64Array(32768);

    const sampleCount = Math.floor(samples.length / 3);
    for (let i = 0; i < sampleCount; i++) {
      const base = i * 3;
      const r = samples[base];
      const g = samples[base + 1];
      const b = samples[base + 2];
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      counts[bin]++;
      sumR[bin] += r;
      sumG[bin] += g;
      sumB[bin] += b;
    }

    const activeBins = [];
    for (let bin = 0; bin < 32768; bin++) {
      if (counts[bin] > 0) activeBins.push(bin);
    }

    const palette = new Uint8Array(256 * 3);
    const lut = new Int16Array(32768).fill(-1);

    if (activeBins.length === 0) {
      return { palette, colorCount: 1, lut };
    }

    if (activeBins.length <= maxColors) {
      for (let i = 0; i < activeBins.length; i++) {
        const bin = activeBins[i];
        const c = counts[bin];
        palette[i * 3] = Math.round(sumR[bin] / c);
        palette[i * 3 + 1] = Math.round(sumG[bin] / c);
        palette[i * 3 + 2] = Math.round(sumB[bin] / c);
        lut[bin] = i;
      }
      return { palette, colorCount: activeBins.length, lut };
    }

    const binsArr = new Int32Array(activeBins);

    const makeBox = (start, end) => {
      let minR = 31;
      let maxR = 0;
      let minG = 31;
      let maxG = 0;
      let minB = 31;
      let maxB = 0;
      let weight = 0;
      for (let i = start; i < end; i++) {
        const bin = binsArr[i];
        const r5 = (bin >> 10) & 31;
        const g5 = (bin >> 5) & 31;
        const b5 = bin & 31;
        if (r5 < minR) minR = r5;
        if (r5 > maxR) maxR = r5;
        if (g5 < minG) minG = g5;
        if (g5 > maxG) maxG = g5;
        if (b5 < minB) minB = b5;
        if (b5 > maxB) maxB = b5;
        weight += counts[bin];
      }
      const rangeR = maxR - minR;
      const rangeG = maxG - minG;
      const rangeB = maxB - minB;
      const maxRange = Math.max(rangeR, rangeG, rangeB);
      const axis = rangeR >= rangeG && rangeR >= rangeB ? 0 : rangeG >= rangeB ? 1 : 2;
      return { start, end, weight, maxRange, axis };
    };

    const boxes = [makeBox(0, binsArr.length)];

    while (boxes.length < maxColors) {
      let bestIdx = -1;
      let bestScore = -1;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.end - b.start < 2) continue;
        if (b.maxRange > bestScore) {
          bestScore = b.maxRange;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;

      const box = boxes[bestIdx];
      const slice = Array.from(binsArr.subarray(box.start, box.end));
      const shift = box.axis === 0 ? 10 : box.axis === 1 ? 5 : 0;
      slice.sort((a, b) => ((a >> shift) & 31) - ((b >> shift) & 31));
      for (let i = 0; i < slice.length; i++) {
        binsArr[box.start + i] = slice[i];
      }

      const halfWeight = box.weight * 0.5;
      let accum = 0;
      let split = box.start + 1;
      for (let i = box.start; i < box.end - 1; i++) {
        accum += counts[binsArr[i]];
        split = i + 1;
        if (accum >= halfWeight) break;
      }

      boxes[bestIdx] = makeBox(box.start, split);
      boxes.push(makeBox(split, box.end));
    }

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      let rTotal = 0;
      let gTotal = 0;
      let bTotal = 0;
      let wTotal = 0;
      for (let j = box.start; j < box.end; j++) {
        const bin = binsArr[j];
        rTotal += sumR[bin];
        gTotal += sumG[bin];
        bTotal += sumB[bin];
        wTotal += counts[bin];
      }
      if (wTotal > 0) {
        palette[i * 3] = Math.round(rTotal / wTotal);
        palette[i * 3 + 1] = Math.round(gTotal / wTotal);
        palette[i * 3 + 2] = Math.round(bTotal / wTotal);
      }
      for (let j = box.start; j < box.end; j++) {
        lut[binsArr[j]] = i;
      }
    }

    return { palette, colorCount: boxes.length, lut };
  }

  function lookupPaletteColor(r, g, b, paletteObj) {
    const r5 = r >> 3;
    const g5 = g >> 3;
    const b5 = b >> 3;
    const bin = (r5 << 10) | (g5 << 5) | b5;
    let idx = paletteObj.lut[bin];
    if (idx !== -1) return idx;

    const { palette, colorCount } = paletteObj;
    const qr = (r5 << 3) | 4;
    const qg = (g5 << 3) | 4;
    const qb = (b5 << 3) | 4;
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < colorCount; i++) {
      const pBase = i * 3;
      const dr = qr - palette[pBase];
      const dg = qg - palette[pBase + 1];
      const db = qb - palette[pBase + 2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    paletteObj.lut[bin] = bestIdx;
    return bestIdx;
  }

  function gifLzwEncode(indices, minCodeSize = 8) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    const hashKeys = new Int32Array(LZW_HASH_SIZE).fill(-1);
    const hashVals = new Int32Array(LZW_HASH_SIZE);

    const blocks = [];
    const subBlock = new Uint8Array(256);
    let subLen = 0;
    let bitBuf = 0;
    let bitCount = 0;

    const flushSubBlock = () => {
      if (subLen === 0) return;
      const chunk = new Uint8Array(subLen + 1);
      chunk[0] = subLen;
      chunk.set(subBlock.subarray(0, subLen), 1);
      blocks.push(chunk);
      subLen = 0;
    };

    const emitBits = (code, size) => {
      bitBuf |= code << bitCount;
      bitCount += size;
      while (bitCount >= 8) {
        subBlock[subLen++] = bitBuf & 0xff;
        bitBuf >>>= 8;
        bitCount -= 8;
        if (subLen === 255) flushSubBlock();
      }
    };

    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;

    emitBits(clearCode, codeSize);

    if (indices.length > 0) {
      let prefix = indices[0];
      for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const combo = (prefix << 8) | k;
        let h = ((prefix << 4) ^ k) % LZW_HASH_SIZE;
        const step = 1 + (combo % (LZW_HASH_SIZE - 2));

        while (hashKeys[h] !== -1 && hashKeys[h] !== combo) {
          h -= step;
          if (h < 0) h += LZW_HASH_SIZE;
        }

        if (hashKeys[h] === combo) {
          prefix = hashVals[h];
        } else {
          emitBits(prefix, codeSize);
          if (nextCode < 4096) {
            hashKeys[h] = combo;
            hashVals[h] = nextCode;
            nextCode++;
            if (nextCode > 1 << codeSize && codeSize < 12) {
              codeSize++;
            }
          } else {
            emitBits(clearCode, codeSize);
            hashKeys.fill(-1);
            codeSize = minCodeSize + 1;
            nextCode = eoiCode + 1;
          }
          prefix = k;
        }
      }
      emitBits(prefix, codeSize);
    }

    emitBits(eoiCode, codeSize);

    if (bitCount > 0) {
      subBlock[subLen++] = bitBuf & 0xff;
    }
    flushSubBlock();
    blocks.push(new Uint8Array([0]));

    let totalLen = 0;
    for (let i = 0; i < blocks.length; i++) totalLen += blocks[i].length;
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (let i = 0; i < blocks.length; i++) {
      out.set(blocks[i], pos);
      pos += blocks[i].length;
    }
    return out;
  }

  function sampleGlobalRgb(frames, width, height, maxTotalSamples = 180000) {
    const totalPixels = frames.length * width * height;
    const stride = Math.max(1, Math.floor(totalPixels / maxTotalSamples));
    const estCount = Math.ceil(totalPixels / stride);
    const samples = new Uint8Array(estCount * 3);
    let writeIdx = 0;
    let globalPixel = 0;

    for (let f = 0; f < frames.length; f++) {
      const data = frames[f].data;
      const pxCount = width * height;
      for (let p = 0; p < pxCount; p++) {
        if (globalPixel % stride === 0 && writeIdx + 3 <= samples.length) {
          const s = p * 4;
          samples[writeIdx++] = data[s];
          samples[writeIdx++] = data[s + 1];
          samples[writeIdx++] = data[s + 2];
        }
        globalPixel++;
      }
    }
    return samples.subarray(0, writeIdx);
  }

  function sampleRectRgb(data, width, left, top, boxW, boxH, maxSamples = 90000) {
    const total = boxW * boxH;
    const stride = Math.max(1, Math.floor(total / maxSamples));
    const samples = new Uint8Array(Math.ceil(total / stride) * 3);
    let writeIdx = 0;
    let counter = 0;

    for (let y = top; y < top + boxH; y++) {
      const rowBase = y * width;
      for (let x = left; x < left + boxW; x++) {
        if (counter % stride === 0 && writeIdx + 3 <= samples.length) {
          const s = (rowBase + x) * 4;
          samples[writeIdx++] = data[s];
          samples[writeIdx++] = data[s + 1];
          samples[writeIdx++] = data[s + 2];
        }
        counter++;
      }
    }
    return samples.subarray(0, writeIdx);
  }

  function clampRgbByte(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function mapRegionPixels({
    data,
    prevCanvas,
    width,
    left,
    top,
    boxW,
    boxH,
    paletteObj,
    ditherAmp,
    diffTolerance,
    allowTransparency,
  }) {
    const indices = new Uint8Array(boxW * boxH);
    let sqErrSum = 0;
    let opaqueCount = 0;
    let outPos = 0;

    for (let y = top; y < top + boxH; y++) {
      const rowBase = y * width;
      const bayerRow = (y & 3) * 4;
      for (let x = left; x < left + boxW; x++) {
        const pIdx = (rowBase + x) * 4;
        const r = data[pIdx];
        const g = data[pIdx + 1];
        const b = data[pIdx + 2];

        if (allowTransparency) {
          const diff =
            Math.abs(r - prevCanvas[pIdx]) +
            Math.abs(g - prevCanvas[pIdx + 1]) +
            Math.abs(b - prevCanvas[pIdx + 2]);
          if (diff <= diffTolerance) {
            indices[outPos++] = GIF_TRANSPARENT_IDX;
            continue;
          }
        }

        const dither = ditherAmp > 0 ? (BAYER_4X4[bayerRow + (x & 3)] / 7.5) * ditherAmp : 0;
        const dr = clampRgbByte(Math.round(r + dither));
        const dg = clampRgbByte(Math.round(g + dither));
        const db = clampRgbByte(Math.round(b + dither));

        const colorIdx = lookupPaletteColor(dr, dg, db, paletteObj);
        indices[outPos++] = colorIdx;

        const pBase = colorIdx * 3;
        const qr = paletteObj.palette[pBase];
        const qg = paletteObj.palette[pBase + 1];
        const qb = paletteObj.palette[pBase + 2];

        const errR = r - qr;
        const errG = g - qg;
        const errB = b - qb;
        sqErrSum += errR * errR + errG * errG + errB * errB;
        opaqueCount++;
      }
    }

    return {
      indices,
      meanSqError: opaqueCount > 0 ? sqErrSum / opaqueCount : 0,
    };
  }

  function commitMappedRegionToCanvas(prevCanvas, width, left, top, boxW, boxH, indices, palette) {
    let pos = 0;
    for (let y = top; y < top + boxH; y++) {
      const rowBase = y * width;
      for (let x = left; x < left + boxW; x++) {
        const colorIdx = indices[pos++];
        if (colorIdx === GIF_TRANSPARENT_IDX) continue;
        const cIdx = (rowBase + x) * 4;
        const pBase = colorIdx * 3;
        prevCanvas[cIdx] = palette[pBase];
        prevCanvas[cIdx + 1] = palette[pBase + 1];
        prevCanvas[cIdx + 2] = palette[pBase + 2];
        prevCanvas[cIdx + 3] = 255;
      }
    }
  }

  function writeUint16LE(buf, offset, val) {
    buf[offset] = val & 0xff;
    buf[offset + 1] = (val >> 8) & 0xff;
  }

  function yieldTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Encode RGBA frames into a looping GIF89a byte stream with Median-Cut
   * quantization, ordered Bayer dithering, inter-frame delta cropping,
   * duplicate-frame delay merging, and LZW compression.
   */
  async function encodeGifFrames(
    frames,
    { width, height, loop = 0, quality = 'balanced', onProgress = null, isCancelled = null } = {},
  ) {
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error('No frames provided for GIF encoding');
    }
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));

    const ditherAmp = quality === 'fast' ? 0 : quality === 'high' ? 10 : 8;
    const diffTolerance = quality === 'fast' ? 18 : quality === 'high' ? 4 : 10;

    const globalSamples = sampleGlobalRgb(frames, w, h);
    const globalPaletteObj = buildMedianCutPalette(globalSamples, GIF_MAX_PALETTE_COLORS);

    const prevCanvas = new Uint8ClampedArray(w * h * 4);
    const emittedFrames = [];

    for (let f = 0; f < frames.length; f++) {
      if (isCancelled?.()) {
        throw new Error('Cancelled');
      }

      const frame = frames[f];
      const data = frame.data;
      const delayCs = Math.max(2, Math.min(65535, Math.round(frame.delayCs || 10)));

      let left = 0;
      let top = 0;
      let boxW = w;
      let boxH = h;
      let allowTransparency = false;

      if (f > 0) {
        allowTransparency = true;
        let minX = w;
        let minY = h;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < h; y++) {
          const rowBase = y * w;
          for (let x = 0; x < w; x++) {
            const pIdx = (rowBase + x) * 4;
            const diff =
              Math.abs(data[pIdx] - prevCanvas[pIdx]) +
              Math.abs(data[pIdx + 1] - prevCanvas[pIdx + 1]) +
              Math.abs(data[pIdx + 2] - prevCanvas[pIdx + 2]);
            if (diff > diffTolerance) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (maxX < minX || maxY < minY) {
          const prev = emittedFrames[emittedFrames.length - 1];
          if (prev && prev.delayCs + delayCs <= 65535) {
            prev.delayCs += delayCs;
            onProgress?.({ stage: 'encode', progress: (f + 1) / frames.length, frame: f + 1, total: frames.length });
            continue;
          }
          left = 0;
          top = 0;
          boxW = 1;
          boxH = 1;
        } else {
          left = minX;
          top = minY;
          boxW = maxX - minX + 1;
          boxH = maxY - minY + 1;
        }
      }

      let paletteObj = globalPaletteObj;
      let useLocalPalette = false;

      if (quality === 'high') {
        const rectSamples = sampleRectRgb(data, w, left, top, boxW, boxH);
        paletteObj = buildMedianCutPalette(rectSamples, GIF_MAX_PALETTE_COLORS);
        useLocalPalette = true;
      }

      let mapped = mapRegionPixels({
        data,
        prevCanvas,
        width: w,
        left,
        top,
        boxW,
        boxH,
        paletteObj,
        ditherAmp,
        diffTolerance,
        allowTransparency,
      });

      if (quality === 'balanced' && mapped.meanSqError > 750) {
        const rectSamples = sampleRectRgb(data, w, left, top, boxW, boxH);
        paletteObj = buildMedianCutPalette(rectSamples, GIF_MAX_PALETTE_COLORS);
        useLocalPalette = true;
        mapped = mapRegionPixels({
          data,
          prevCanvas,
          width: w,
          left,
          top,
          boxW,
          boxH,
          paletteObj,
          ditherAmp,
          diffTolerance,
          allowTransparency,
        });
      }

      commitMappedRegionToCanvas(prevCanvas, w, left, top, boxW, boxH, mapped.indices, paletteObj.palette);
      const lzwData = gifLzwEncode(mapped.indices, 8);

      emittedFrames.push({
        left,
        top,
        boxW,
        boxH,
        delayCs,
        allowTransparency,
        localPalette: useLocalPalette ? paletteObj.palette : null,
        lzwData,
      });

      onProgress?.({ stage: 'encode', progress: (f + 1) / frames.length, frame: f + 1, total: frames.length });
      if (f % 2 === 1 && f + 1 < frames.length) {
        await yieldTick();
      }
    }

    // Assemble GIF89a binary stream
    let totalBytes = 6 + 7 + 768 + (loop >= 0 ? 19 : 0) + 1;
    for (let i = 0; i < emittedFrames.length; i++) {
      const ef = emittedFrames[i];
      totalBytes += 8 + 10 + (ef.localPalette ? 768 : 0) + 1 + ef.lzwData.length;
    }

    const out = new Uint8Array(totalBytes);
    let pos = 0;

    // Header: GIF89a
    out[pos++] = 0x47;
    out[pos++] = 0x49;
    out[pos++] = 0x46;
    out[pos++] = 0x38;
    out[pos++] = 0x39;
    out[pos++] = 0x61;

    // Logical Screen Descriptor (Global Color Table = 256 colors)
    writeUint16LE(out, pos, w);
    pos += 2;
    writeUint16LE(out, pos, h);
    pos += 2;
    out[pos++] = 0xf7;
    out[pos++] = 0x00;
    out[pos++] = 0x00;

    // Global Color Table
    out.set(globalPaletteObj.palette, pos);
    pos += 768;

    // Netscape 2.0 Application Extension for looping
    if (loop >= 0) {
      out[pos++] = 0x21;
      out[pos++] = 0xff;
      out[pos++] = 0x0b;
      const netscape = 'NETSCAPE2.0';
      for (let i = 0; i < netscape.length; i++) {
        out[pos++] = netscape.charCodeAt(i);
      }
      out[pos++] = 0x03;
      out[pos++] = 0x01;
      writeUint16LE(out, pos, Math.min(65535, Math.max(0, loop)));
      pos += 2;
      out[pos++] = 0x00;
    }

    for (let i = 0; i < emittedFrames.length; i++) {
      const ef = emittedFrames[i];

      // Graphic Control Extension
      out[pos++] = 0x21;
      out[pos++] = 0xf9;
      out[pos++] = 0x04;
      out[pos++] = ef.allowTransparency ? 0x05 : 0x04;
      writeUint16LE(out, pos, ef.delayCs);
      pos += 2;
      out[pos++] = ef.allowTransparency ? GIF_TRANSPARENT_IDX : 0x00;
      out[pos++] = 0x00;

      // Image Descriptor
      out[pos++] = 0x2c;
      writeUint16LE(out, pos, ef.left);
      pos += 2;
      writeUint16LE(out, pos, ef.top);
      pos += 2;
      writeUint16LE(out, pos, ef.boxW);
      pos += 2;
      writeUint16LE(out, pos, ef.boxH);
      pos += 2;
      out[pos++] = ef.localPalette ? 0x87 : 0x00;

      if (ef.localPalette) {
        out.set(ef.localPalette, pos);
        pos += 768;
      }

      // LZW Minimum Code Size + Sub-blocks
      out[pos++] = 0x08;
      out.set(ef.lzwData, pos);
      pos += ef.lzwData.length;
    }

    // GIF Trailer
    out[pos++] = 0x3b;
    return out;
  }

  function waitVideoLoaded(video, timeoutMs = 12000) {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
      };
      const onReady = () => {
        if (settled) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          settled = true;
          cleanup();
          resolve();
        }
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Failed to decode MP4 video'));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Timed out loading MP4 video'));
      }, timeoutMs);

      video.addEventListener('loadeddata', onReady);
      video.addEventListener('canplay', onReady);
      video.addEventListener('error', onError);
    });
  }

  function seekVideoFrame(video, targetTime, timeoutMs = 4000) {
    if (Math.abs(video.currentTime - targetTime) < 0.0005 && video.readyState >= 2) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };
      const onSeeked = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Video seek failed'));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Video seek timed out'));
      }, timeoutMs);

      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.currentTime = targetTime;
    });
  }

  /**
   * Transcode an MP4 Blob into a GIF89a Blob locally in the browser using exact
   * MP4 frame timestamps when available.
   */
  async function transcodeMp4BlobToGif(
    mp4Blob,
    {
      fps = 15,
      maxWidth = 540,
      quality = 'balanced',
      maxDurationSec = 15,
      onProgress = null,
      isCancelled = null,
    } = {},
  ) {
    if (!mp4Blob) throw new Error('Missing MP4 blob');
    if (isCancelled?.()) throw new Error('Cancelled');

    const arrayBuffer = await mp4Blob.arrayBuffer();
    const mp4Meta = parseMp4Metadata(arrayBuffer);

    const objectUrl = URL.createObjectURL(mp4Blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;

    try {
      await waitVideoLoaded(video, 12000);
      if (isCancelled?.()) throw new Error('Cancelled');

      const srcW = Math.max(1, video.videoWidth || mp4Meta.width || 480);
      const srcH = Math.max(1, video.videoHeight || mp4Meta.height || 480);
      const scale = maxWidth > 0 && srcW > maxWidth ? maxWidth / srcW : 1;
      const outW = Math.max(1, Math.round(srcW * scale));
      const outH = Math.max(1, Math.round(srcH * scale));

      const schedule = planFrameSchedule(mp4Meta, video.duration, {
        targetFps: fps,
        maxDurationSec,
      });

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const totalFrames = schedule.timestamps.length;
      const frames = new Array(totalFrames);
      const maxSeekTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.005) : 0;

      for (let i = 0; i < totalFrames; i++) {
        if (isCancelled?.()) throw new Error('Cancelled');

        const seekT = Math.max(0, Math.min(schedule.timestamps[i], maxSeekTime));
        await seekVideoFrame(video, seekT, 4000);
        ctx.drawImage(video, 0, 0, outW, outH);
        const imageData = ctx.getImageData(0, 0, outW, outH);
        frames[i] = {
          data: imageData.data,
          delayCs: schedule.delaysCs[i],
        };

        onProgress?.({
          stage: 'extract',
          progress: (i + 1) / totalFrames,
          frame: i + 1,
          total: totalFrames,
        });

        if (i % 4 === 3 && i + 1 < totalFrames) {
          await yieldTick();
        }
      }

      const gifBytes = await encodeGifFrames(frames, {
        width: outW,
        height: outH,
        loop: 0,
        quality,
        onProgress,
        isCancelled,
      });

      return {
        blob: new Blob([gifBytes], { type: 'image/gif' }),
        width: outW,
        height: outH,
        frameCount: totalFrames,
        durationSec: schedule.effectiveDuration,
        truncated: schedule.truncated,
      };
    } finally {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch (_) {
        // Ignore media cleanup errors.
      }
      URL.revokeObjectURL(objectUrl);
    }
  }

  // --- interceptor.js ---
  const MAX_REGISTRY_ENTRIES = 1200;
  const MAX_VIDEO_KEY_ENTRIES = 2400;
  const tweetMediaRegistry = new Map();
  const tweetVideoRegistry = new Map();
  const videoByMediaKeyRegistry = new Map();
  const captureListeners = new Set();

  function setBoundedEntry(map, key, val, limit) {
    if (map.has(key)) {
      map.delete(key);
    }
    map.set(key, val);
    while (map.size > limit) {
      const oldestKey = map.keys().next().value;
      map.delete(oldestKey);
    }
  }

  function storeTweetMedia(tweetId, entry) {
    if (!tweetId || !entry || !Array.isArray(entry.photos) || entry.photos.length < 2) return false;
    const existing = tweetMediaRegistry.get(tweetId);
    if (existing && existing.photos.length >= entry.photos.length) return false;

    setBoundedEntry(tweetMediaRegistry, tweetId, entry, MAX_REGISTRY_ENTRIES);
    return true;
  }

  function indexVideosByMediaKey(tweetId, handle, videos) {
    for (const video of videos) {
      if (!video.mediaKey) continue;
      const existing = videoByMediaKeyRegistry.get(video.mediaKey);
      if (existing && existing.variants.length >= video.variants.length) continue;
      setBoundedEntry(
        videoByMediaKeyRegistry,
        video.mediaKey,
        { ...video, handle: handle || existing?.handle || null, tweetId },
        MAX_VIDEO_KEY_ENTRIES,
      );
    }
  }

  function storeTweetVideos(tweetId, entry) {
    if (!tweetId || !entry || !Array.isArray(entry.videos) || entry.videos.length === 0) return false;
    indexVideosByMediaKey(tweetId, entry.handle, entry.videos);
    const existing = tweetVideoRegistry.get(tweetId);
    if (existing && existing.videos.length >= entry.videos.length) return false;

    setBoundedEntry(tweetVideoRegistry, tweetId, entry, MAX_REGISTRY_ENTRIES);
    return true;
  }

  function getRegisteredTweetMedia(tweetId) {
    if (!tweetId) return null;
    return tweetMediaRegistry.get(String(tweetId)) || null;
  }

  function getRegisteredTweetVideos(tweetId) {
    if (!tweetId) return null;
    return tweetVideoRegistry.get(String(tweetId)) || null;
  }

  function getRegisteredVideoByMediaKey(mediaKey) {
    if (!mediaKey) return null;
    return videoByMediaKeyRegistry.get(String(mediaKey)) || null;
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

  function normalizeVideoMediaList(mediaList) {
    if (!Array.isArray(mediaList) || mediaList.length === 0) return null;
    const videos = [];
    for (const item of mediaList) {
      if (!item || (item.type !== 'animated_gif' && item.type !== 'video')) continue;
      const rawVariants = item.video_info?.variants;
      if (!Array.isArray(rawVariants) || rawVariants.length === 0) continue;

      const variants = rawVariants
        .filter((v) => v && v.content_type === 'video/mp4' && typeof v.url === 'string' && v.url)
        .map((v) => ({
          url: v.url,
          bitrate: Number(v.bitrate) || 0,
          ...parseVariantDimensions(v.url),
        }))
        .sort((a, b) => b.bitrate - a.bitrate);

      if (variants.length === 0) continue;

      const posterUrl = item.media_url_https || item.media_url || null;
      const bestMp4Url = variants[0].url;
      const mediaKey = extractVideoMediaKey(posterUrl) || extractVideoMediaKey(bestMp4Url);
      const width = Number(item.original_info?.width) || variants[0].width || 0;
      const height = Number(item.original_info?.height) || variants[0].height || 0;
      const durationMs = Number(item.video_info?.duration_millis) || 0;
      const mediaId = item.id_str ? String(item.id_str) : null;

      videos.push({
        mediaId,
        mediaKey,
        type: item.type,
        posterUrl,
        width,
        height,
        durationMs,
        variants,
        bestMp4Url,
      });
    }
    return videos.length > 0 ? videos : null;
  }

  /**
   * Recursively walk an X GraphQL or REST JSON payload and index every multi-photo
   * and video/GIF tweet by rest_id. This captures all photos and MP4 variants
   * even when X virtualizes 5-20 image carousels or HLS playback in the DOM.
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
        const handle = extractScreenName(cur);
        const idStr = String(tweetId);
        let storedThisTweet = false;

        const photos = normalizePhotoMediaList(mediaList);
        if (photos && storeTweetMedia(idStr, { handle, photos })) {
          storedThisTweet = true;
        }

        const videos = normalizeVideoMediaList(mediaList);
        if (videos && storeTweetVideos(idStr, { handle, videos })) {
          storedThisTweet = true;
        }

        if (storedThisTweet) added++;
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
    if (!text.includes('pbs.twimg.com/media/') && !text.includes('video.twimg.com/')) return;
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

  function walkReactFiberForTweet(article, targetTweetId, extractMedia) {
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
            const result = extractMedia(cand, id, mediaList);
            if (result) return result;
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

  /**
   * Fallback media extractor that reads tweet media entities directly from X's
   * React Fiber tree on an <article> node when a tweet rendered before network
   * interception attached.
   */
  function extractTweetMediaFromReactFiber(article, targetTweetId = null) {
    return walkReactFiberForTweet(article, targetTweetId, (cand, id, mediaList) => {
      const photos = normalizePhotoMediaList(mediaList);
      if (!photos) return null;
      const handle = extractScreenName(cand);
      if (id) storeTweetMedia(String(id), { handle, photos });
      return { handle, photos };
    });
  }

  /**
   * Fallback video/GIF extractor that reads tweet video entities from X's
   * React Fiber tree when a tweet rendered before network interception attached.
   */
  function extractTweetVideosFromReactFiber(article, targetTweetId = null) {
    return walkReactFiberForTweet(article, targetTweetId, (cand, id, mediaList) => {
      const videos = normalizeVideoMediaList(mediaList);
      if (!videos) return null;
      const handle = extractScreenName(cand);
      if (id) storeTweetVideos(String(id), { handle, videos });
      return { handle, videos };
    });
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

  function detectGifBadgeInContainer(container, videoEl) {
    const containerLabel = container.getAttribute?.('aria-label') || '';
    const videoLabel = videoEl?.getAttribute?.('aria-label') || '';
    const playerEl = container.querySelector('[data-testid="videoPlayer"]');
    const playerLabel = playerEl?.getAttribute?.('aria-label') || '';
    if (/\bGIF\b/i.test(containerLabel) || /\bGIF\b/i.test(videoLabel) || /\bGIF\b/i.test(playerLabel)) {
      return true;
    }

    const badges = container.querySelectorAll('span, div');
    for (const el of badges) {
      if (el.closest('.xas-injected, button, [role="button"]')) continue;
      if (el.children.length === 0 && el.textContent?.trim() === 'GIF') {
        return true;
      }
    }
    return false;
  }

  function resolveVideoStatusInfo(container, fallbackMeta) {
    const isQuoted = Boolean(container.closest('[tabindex="0"][role="link"]'));
    const anchor = container.closest('a[href*="/status/"]');
    let parsed = anchor ? parseStatusHref(anchor.getAttribute('href')) : null;
    if (!parsed && isQuoted) {
      const quoteCard = container.closest('[tabindex="0"][role="link"]');
      const quoteLink =
        quoteCard?.querySelector('time')?.closest('a[href*="/status/"]') ||
        quoteCard?.querySelector('a[href*="/status/"]');
      if (quoteLink) parsed = parseStatusHref(quoteLink.getAttribute('href'));
    }
    const handle = parsed?.handle || fallbackMeta.handle;
    const tweetId =
      parsed?.tweetId || (isQuoted ? `${fallbackMeta.tweetId}_quote` : fallbackMeta.tweetId);
    return { isQuoted, handle, tweetId };
  }

  function collectVideoPlayerContainers(article) {
    const compNodes = Array.from(article.querySelectorAll('[data-testid="videoComponent"]'));
    const playerNodes = Array.from(article.querySelectorAll('[data-testid="videoPlayer"]'));
    const candidates = [];

    for (const node of compNodes) {
      if (node.closest('.xas-injected') || node.closest('[data-testid="card.wrapper"]')) continue;
      candidates.push(node);
    }
    for (const node of playerNodes) {
      if (node.closest('.xas-injected') || node.closest('[data-testid="card.wrapper"]')) continue;
      if (candidates.some((c) => c === node || c.contains(node) || node.contains(c))) continue;
      candidates.push(node);
    }

    return candidates.filter((node) => !candidates.some((other) => other !== node && other.contains(node)));
  }

  /**
   * Scan a tweet <article> for X GIFs and videos, correlating DOM video players
   * with GraphQL / React Fiber MP4 variant metadata.
   */
  function extractVideosFromArticle(article) {
    const containers = collectVideoPlayerContainers(article);
    if (containers.length === 0) return [];

    const fallbackMeta = getFallbackStatusInfo(article);
    const perTweetIndices = new Map();
    const preliminary = [];

    for (const container of containers) {
      const { isQuoted, handle, tweetId } = resolveVideoStatusInfo(container, fallbackMeta);
      const videoIndex = perTweetIndices.get(tweetId) || 0;
      perTweetIndices.set(tweetId, videoIndex + 1);

      const videoEl = container.querySelector('video');
      const sourceSrc = videoEl?.querySelector('source')?.getAttribute('src') || '';
      const rawVideoSrc =
        videoEl?.currentSrc || videoEl?.getAttribute('src') || videoEl?.src || sourceSrc || '';
      const directMp4Url =
        isTweetVideoUrl(rawVideoSrc) &&
        !/\.m3u8(?:$|\?)/i.test(rawVideoSrc) &&
        !rawVideoSrc.startsWith('blob:')
          ? rawVideoSrc
          : null;

      const posterAttr = videoEl?.getAttribute('poster') || videoEl?.poster || '';
      const posterImg = container.querySelector('img');
      const posterImgSrc = posterImg?.getAttribute('src') || posterImg?.src || '';

      const domMediaKey =
        extractVideoMediaKey(directMp4Url) ||
        extractVideoMediaKey(posterAttr) ||
        extractVideoMediaKey(posterImgSrc);

      const hasGifBadge = detectGifBadgeInContainer(container, videoEl);

      const byKey = domMediaKey ? getRegisteredVideoByMediaKey(domMediaKey) : null;
      const byTweet = getRegisteredTweetVideos(tweetId);
      const byFiber = !byKey && !byTweet && !isQuoted ? extractTweetVideosFromReactFiber(article, tweetId) : null;
      const tweetEntry = byTweet || byFiber;

      let metaItem = null;
      let resolvedHandle = handle;

      if (byKey) {
        metaItem = byKey;
        if (byKey.handle) resolvedHandle = byKey.handle;
      } else if (tweetEntry && Array.isArray(tweetEntry.videos) && tweetEntry.videos.length > 0) {
        metaItem =
          (domMediaKey && tweetEntry.videos.find((v) => v.mediaKey === domMediaKey)) ||
          tweetEntry.videos[videoIndex] ||
          (tweetEntry.videos.length === 1 ? tweetEntry.videos[0] : null);
        if (tweetEntry.handle) resolvedHandle = tweetEntry.handle;
      } else if (directMp4Url) {
        const dims = parseVariantDimensions(directMp4Url);
        metaItem = {
          mediaId: null,
          mediaKey: domMediaKey || extractVideoMediaKey(directMp4Url) || directMp4Url,
          type: hasGifBadge || /\/tweet_video\//i.test(directMp4Url) ? 'animated_gif' : 'video',
          posterUrl: posterAttr || posterImgSrc || null,
          width: videoEl?.videoWidth || dims.width || 0,
          height: videoEl?.videoHeight || dims.height || 0,
          durationMs:
            Number.isFinite(videoEl?.duration) && videoEl.duration > 0
              ? Math.round(videoEl.duration * 1000)
              : 0,
          variants: [{ url: directMp4Url, bitrate: 0, ...dims }],
          bestMp4Url: directMp4Url,
        };
      }

      if (!metaItem || !Array.isArray(metaItem.variants) || metaItem.variants.length === 0) {
        continue;
      }

      const durationMs =
        metaItem.durationMs > 0
          ? metaItem.durationMs
          : Number.isFinite(videoEl?.duration) && videoEl.duration > 0
            ? Math.round(videoEl.duration * 1000)
            : 0;

      const mediaKey = metaItem.mediaKey || domMediaKey || extractVideoMediaKey(metaItem.bestMp4Url);
      const signature = [
        tweetId,
        mediaKey || 'nokey',
        metaItem.bestMp4Url,
        metaItem.variants.length,
        hasGifBadge ? 'gif' : 'v',
      ].join('|');

      preliminary.push({
        article,
        container,
        handle: resolvedHandle,
        tweetId,
        isQuoted,
        signature,
        mediaKey,
        videoIndex,
        type: metaItem.type,
        posterUrl: metaItem.posterUrl || posterAttr || posterImgSrc || null,
        durationMs,
        width: metaItem.width || videoEl?.videoWidth || 0,
        height: metaItem.height || videoEl?.videoHeight || 0,
        variants: metaItem.variants,
        bestMp4Url: metaItem.bestMp4Url,
        hasGifBadge,
      });
    }

    return preliminary.map((item) => ({
      ...item,
      videoCount: perTweetIndices.get(item.tweetId) || 1,
    }));
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
    gif_box:
      'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM9.5 13v-1h1v1c0 .55-.45 1-1 1h-1c-.55 0-1-.45-1-1v-2c0-.55.45-1 1-1h1c.55 0 1 .45 1 1h-1v-1h-1v2h1zm3 1h-1v-4h1v4zm4-3h-2v.5H16v1h-1.5V14h-1v-4h3v1z',
    movie:
      'M4 6.47L5.76 10H20v8H4V6.47M22 4h-4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    tune:
      'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
    stop: 'M6 6h12v12H6z',
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
    settingsSubtitle: IS_ZH
      ? '拼图检测、GIF 转存与导出偏好设置'
      : 'Stitching, GIF conversion & export preferences',
    sectionStitching: IS_ZH ? '画作拼图' : 'Artwork Stitching',
    sectionGifVideo: IS_ZH ? 'GIF 与视频导出' : 'GIF & Video Export',
    sectionOutput: IS_ZH ? '输出与高级设置' : 'Output & Advanced',
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
    optSensitivityDesc: IS_ZH
      ? '控制边缘拼接判定阈值与抗压缩容差'
      : 'Controls seam-matching strictness and compression tolerance',
    sensStrict: IS_ZH ? '严格' : 'Strict',
    sensNormal: IS_ZH ? '标准' : 'Normal',
    sensLoose: IS_ZH ? '宽松' : 'Loose',
    optEnableGifTools: IS_ZH ? '启用 GIF / 视频导出工具' : 'Enable GIF & video export tools',
    optEnableGifToolsDesc: IS_ZH
      ? '在 X 的 GIF 与视频播放器右上角显示转存 GIF / 下载 MP4 悬浮控制条'
      : 'Show floating GIF conversion and MP4 download controls on X videos',
    optAutoDetectGifVideos: IS_ZH ? '自动识别类 GIF 无声短视频' : 'Auto-detect GIF-like silent videos',
    optAutoDetectGifVideosDesc: IS_ZH
      ? '自动探测短时无音轨视频的 MP4 头信息并高亮提示转存为 GIF'
      : 'Probe short silent MP4 headers and highlight them for instant GIF export',
    optShowOnRegularVideos: IS_ZH ? '在普通视频上显示折叠按钮' : 'Show compact button on regular videos',
    optShowOnRegularVideosDesc: IS_ZH
      ? '为包含音轨或较长的普通视频提供轻量化 GIF / MP4 导出入口'
      : 'Keep a subtle collapsed GIF / MP4 pill on regular videos',
    optGifFps: IS_ZH ? 'GIF 导出帧率' : 'GIF frame rate',
    optGifFpsDesc: IS_ZH
      ? '原生 GIF 会尽量保留原有帧节奏，高帧率视频将平滑降采样'
      : 'Native GIFs preserve cadence when possible; higher FPS clips resample smoothly',
    optGifMaxWidth: IS_ZH ? 'GIF 最大宽度' : 'GIF max width',
    optGifMaxWidthDesc: IS_ZH
      ? '超过该宽度的视频将按比例缩小，以平衡清晰度与文件体积'
      : 'Downscales wider videos proportionally to balance sharpness and file size',
    optWidthOrig: IS_ZH ? '原尺寸' : 'Orig',
    optGifQuality: IS_ZH ? 'GIF 编码质量' : 'GIF encoding quality',
    optGifQualityDesc: IS_ZH
      ? '“均衡”使用有序抖动与帧间差分裁剪；“高画质”每帧独立生成调色板'
      : 'Balanced uses ordered dithering & delta cropping; High builds per-frame palettes',
    qualFast: IS_ZH ? '极速' : 'Fast',
    qualBalanced: IS_ZH ? '均衡' : 'Balanced',
    qualHigh: IS_ZH ? '高画质' : 'High',
    optGifMaxDuration: IS_ZH ? 'GIF 最大截取时长' : 'Max GIF clip duration',
    optGifMaxDurationDesc: IS_ZH
      ? '超长视频将截取前若干秒进行转码，防止浏览器内存占用过高'
      : 'Clips longer than this limit export only the opening segment',
    optFormat: IS_ZH ? '图片下载格式' : 'Image download format',
    optFormatDesc: IS_ZH
      ? '适用于拼合画作及单图下载（GIF 导出固定为 .gif）'
      : 'Applies to stitched and standalone images (GIF export always outputs .gif)',
    optTemplate: IS_ZH ? '下载文件名模板' : 'Filename template',
    optTemplateDesc: IS_ZH
      ? '可用占位符: {handle}, {tweetId}, {layout}'
      : 'Placeholders: {handle}, {tweetId}, {layout}',
    previewPrefix: IS_ZH ? '预览: ' : 'Preview: ',
    optDebug: IS_ZH ? '控制台输出调试日志' : 'Console debug logging',
    optDebugDesc: IS_ZH
      ? '在浏览器开发者工具中记录检测分数与视频探测信息'
      : 'Print detection scores and MP4 probe metadata to console',
    save: IS_ZH ? '保存' : 'Save',
    cancel: IS_ZH ? '取消' : 'Cancel',
    gifLabel: 'GIF',
    mp4Label: 'MP4',
    exportGifLabel: IS_ZH ? '导出 GIF' : 'Export GIF',
    saveGifTitle: IS_ZH ? '转码并下载 .gif 动图' : 'Convert and download as .gif',
    saveGifLikeTitle: IS_ZH
      ? '检测到无声类 GIF 短视频 — 点击转码下载 .gif'
      : 'Silent GIF-like video detected — click to save .gif',
    expandVideoToolsTitle: IS_ZH ? '展开 GIF / MP4 导出选项' : 'Expand GIF / MP4 export controls',
    collapseVideoToolsTitle: IS_ZH ? '收起' : 'Collapse',
    downloadMp4Title: IS_ZH ? '下载原始 .mp4 视频' : 'Download raw .mp4 video',
    cancelGifTitle: IS_ZH ? '取消当前任务' : 'Cancel current task',
    stageFetch: IS_ZH ? '获取视频中...' : 'Fetching MP4...',
    stageExtract: IS_ZH ? '抽帧' : 'Extracting',
    stageEncode: IS_ZH ? '编码 GIF' : 'Encoding GIF',
    gifCancelled: IS_ZH ? '已取消 GIF 导出' : 'GIF export cancelled',
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

  function isPageLightTheme() {
    try {
      for (const el of [document.body, document.documentElement]) {
        if (!el) continue;
        const bg = window.getComputedStyle(el).backgroundColor;
        const match = bg && bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
        if (!match) continue;
        const alpha = match[4] !== undefined ? Number(match[4]) : 1;
        if (alpha === 0) continue;
        const lum = (0.299 * Number(match[1]) + 0.587 * Number(match[2]) + 0.114 * Number(match[3])) / 255;
        return lum > 0.5;
      }
    } catch (_) {
      // Default to dark tonal theme if computed style is unavailable.
    }
    return false;
  }

  let activeModalCleanup = null;

  function openSettingsModal(currentConfig, onSave) {
    if (activeModalCleanup) {
      activeModalCleanup();
    } else {
      const existing = document.querySelector('.xas-modal-backdrop');
      if (existing) existing.remove();
    }

    const backdrop = document.createElement('div');
    backdrop.className = isPageLightTheme()
      ? 'xas-modal-backdrop xas-theme-light'
      : 'xas-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'xas-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'xas-settings-title');

    const closeModal = () => {
      window.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      if (activeModalCleanup === closeModal) activeModalCleanup = null;
    };
    activeModalCleanup = closeModal;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        stopBubble(e);
        closeModal();
      }
    };

    const head = document.createElement('div');
    head.className = 'xas-modal-head';

    const headIcon = document.createElement('div');
    headIcon.className = 'xas-m3-head-icon';
    headIcon.appendChild(createIcon('tune', 20));

    const headText = document.createElement('div');
    headText.className = 'xas-m3-head-text';
    const heading = document.createElement('h3');
    heading.id = 'xas-settings-title';
    heading.textContent = t('settingsHeading');
    const subtitle = document.createElement('div');
    subtitle.className = 'xas-m3-head-subtitle';
    subtitle.textContent = t('settingsSubtitle');
    headText.appendChild(heading);
    headText.appendChild(subtitle);

    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'xas-m3-icon-btn';
    closeX.title = t('lbClose');
    closeX.setAttribute('aria-label', t('lbClose'));
    closeX.appendChild(createIcon('close', 20));
    closeX.addEventListener('click', closeModal);

    head.appendChild(headIcon);
    head.appendChild(headText);
    head.appendChild(closeX);

    const body = document.createElement('div');
    body.className = 'xas-modal-body';

    const draft = { ...currentConfig };
    const previewListeners = [];

    const createSection = (titleText) => {
      const section = document.createElement('div');
      section.className = 'xas-m3-section';
      const titleEl = document.createElement('div');
      titleEl.className = 'xas-m3-section-title';
      titleEl.textContent = titleText;
      const card = document.createElement('div');
      card.className = 'xas-m3-card';
      section.appendChild(titleEl);
      section.appendChild(card);
      body.appendChild(section);
      return card;
    };

    const addSwitchRow = (card, label, desc, key) => {
      const row = document.createElement('label');
      row.className = 'xas-m3-row';

      const copy = document.createElement('div');
      copy.className = 'xas-m3-row-copy';
      const titleDiv = document.createElement('div');
      titleDiv.className = 'xas-m3-row-title';
      titleDiv.textContent = label;
      copy.appendChild(titleDiv);
      if (desc) {
        const descDiv = document.createElement('div');
        descDiv.className = 'xas-m3-row-desc';
        descDiv.textContent = desc;
        copy.appendChild(descDiv);
      }

      const switchWrap = document.createElement('span');
      switchWrap.className = 'xas-m3-switch';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'xas-m3-switch-input';
      input.checked = Boolean(draft[key]);
      input.setAttribute('role', 'switch');
      input.setAttribute('aria-checked', String(input.checked));

      const track = document.createElement('span');
      track.className = 'xas-m3-switch-track';
      const thumb = document.createElement('span');
      thumb.className = 'xas-m3-switch-thumb';
      thumb.appendChild(createIcon('check', 14));
      track.appendChild(thumb);

      input.addEventListener('change', () => {
        draft[key] = input.checked;
        input.setAttribute('aria-checked', String(input.checked));
      });

      switchWrap.appendChild(input);
      switchWrap.appendChild(track);
      row.appendChild(copy);
      row.appendChild(switchWrap);
      card.appendChild(row);
    };

    const addSegmentedRow = (card, label, desc, key, options) => {
      const row = document.createElement('div');
      row.className = 'xas-m3-row-stack';

      const copy = document.createElement('div');
      copy.className = 'xas-m3-row-copy';
      const titleDiv = document.createElement('div');
      titleDiv.className = 'xas-m3-row-title';
      titleDiv.textContent = label;
      copy.appendChild(titleDiv);
      if (desc) {
        const descDiv = document.createElement('div');
        descDiv.className = 'xas-m3-row-desc';
        descDiv.textContent = desc;
        copy.appendChild(descDiv);
      }

      const group = document.createElement('div');
      group.className = 'xas-m3-segmented';
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', label);

      const buttons = [];
      const syncActive = () => {
        for (const item of buttons) {
          const isSelected = draft[key] === item.value;
          item.btn.classList.toggle('xas-m3-seg-active', isSelected);
          item.btn.setAttribute('aria-checked', String(isSelected));
          item.checkEl.style.display = isSelected ? 'block' : 'none';
        }
      };

      for (const opt of options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'xas-m3-seg-btn';
        btn.setAttribute('role', 'radio');

        const checkEl = createIcon('check', 14);
        const textSpan = document.createElement('span');
        textSpan.textContent = opt.label;
        btn.appendChild(checkEl);
        btn.appendChild(textSpan);

        btn.addEventListener('click', () => {
          draft[key] = opt.value;
          syncActive();
          for (const listener of previewListeners) listener();
        });

        buttons.push({ btn, checkEl, value: opt.value });
        group.appendChild(btn);
      }

      syncActive();
      row.appendChild(copy);
      row.appendChild(group);
      card.appendChild(row);
    };

    const addTextFieldRow = (card, label, desc, key, previewFormatter) => {
      const row = document.createElement('label');
      row.className = 'xas-m3-row-stack';

      const copy = document.createElement('div');
      copy.className = 'xas-m3-row-copy';
      const titleDiv = document.createElement('div');
      titleDiv.className = 'xas-m3-row-title';
      titleDiv.textContent = label;
      copy.appendChild(titleDiv);
      if (desc) {
        const descDiv = document.createElement('div');
        descDiv.className = 'xas-m3-row-desc';
        descDiv.textContent = desc;
        copy.appendChild(descDiv);
      }

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'xas-m3-textfield';
      input.value = draft[key] || '';

      const previewEl = document.createElement('div');
      previewEl.className = 'xas-m3-preview-line';
      const updatePreview = () => {
        if (previewFormatter) {
          previewEl.textContent = previewFormatter(draft);
        }
      };
      updatePreview();
      previewListeners.push(updatePreview);

      input.addEventListener('input', () => {
        draft[key] = input.value;
        updatePreview();
      });

      row.appendChild(copy);
      row.appendChild(input);
      if (previewFormatter) row.appendChild(previewEl);
      card.appendChild(row);
    };

    const stitchingCard = createSection(t('sectionStitching'));
    addSwitchRow(stitchingCard, t('optAutoDetect'), t('optAutoDetectDesc'), 'autoDetect');
    addSwitchRow(stitchingCard, t('optAutoStitch'), t('optAutoStitchDesc'), 'autoStitch');
    addSwitchRow(stitchingCard, t('optAutoUnshuffle'), t('optAutoUnshuffleDesc'), 'autoUnshuffle');
    addSegmentedRow(stitchingCard, t('optSensitivity'), t('optSensitivityDesc'), 'sensitivity', [
      { value: 'strict', label: t('sensStrict') },
      { value: 'normal', label: t('sensNormal') },
      { value: 'loose', label: t('sensLoose') },
    ]);

    const gifCard = createSection(t('sectionGifVideo'));
    addSwitchRow(gifCard, t('optEnableGifTools'), t('optEnableGifToolsDesc'), 'enableGifTools');
    addSwitchRow(
      gifCard,
      t('optAutoDetectGifVideos'),
      t('optAutoDetectGifVideosDesc'),
      'autoDetectGifVideos',
    );
    addSwitchRow(
      gifCard,
      t('optShowOnRegularVideos'),
      t('optShowOnRegularVideosDesc'),
      'showOnRegularVideos',
    );
    addSegmentedRow(gifCard, t('optGifFps'), t('optGifFpsDesc'), 'gifFps', [
      { value: 10, label: '10 fps' },
      { value: 15, label: '15 fps' },
      { value: 20, label: '20 fps' },
      { value: 25, label: '25 fps' },
    ]);
    addSegmentedRow(gifCard, t('optGifMaxWidth'), t('optGifMaxWidthDesc'), 'gifMaxWidth', [
      { value: 480, label: '480px' },
      { value: 540, label: '540px' },
      { value: 720, label: '720px' },
      { value: 0, label: t('optWidthOrig') },
    ]);
    addSegmentedRow(gifCard, t('optGifQuality'), t('optGifQualityDesc'), 'gifQuality', [
      { value: 'fast', label: t('qualFast') },
      { value: 'balanced', label: t('qualBalanced') },
      { value: 'high', label: t('qualHigh') },
    ]);
    addSegmentedRow(gifCard, t('optGifMaxDuration'), t('optGifMaxDurationDesc'), 'gifMaxDuration', [
      { value: 8, label: '8s' },
      { value: 15, label: '15s' },
      { value: 25, label: '25s' },
    ]);

    const outputCard = createSection(t('sectionOutput'));
    addSegmentedRow(outputCard, t('optFormat'), t('optFormatDesc'), 'downloadFormat', [
      { value: 'png', label: 'PNG' },
      { value: 'jpeg', label: 'JPEG (95%)' },
      { value: 'webp', label: 'WebP (95%)' },
    ]);
    addTextFieldRow(
      outputCard,
      t('optTemplate'),
      t('optTemplateDesc'),
      'filenameTemplate',
      (d) =>
        `${t('previewPrefix')}${formatFilename(d.filenameTemplate, {
          handle: 'artist',
          tweetId: '189000123',
          layout: '2x2',
          ext: d.downloadFormat || 'png',
        })}`,
    );
    addSwitchRow(outputCard, t('optDebug'), t('optDebugDesc'), 'debug');

    const foot = document.createElement('div');
    foot.className = 'xas-modal-foot';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'xas-m3-text-btn';
    cancelBtn.textContent = t('cancel');
    cancelBtn.addEventListener('click', closeModal);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'xas-m3-filled-btn';
    saveBtn.appendChild(createIcon('check', 16));
    const saveLabel = document.createElement('span');
    saveLabel.textContent = t('save');
    saveBtn.appendChild(saveLabel);
    saveBtn.addEventListener('click', () => {
      onSave(draft);
      closeModal();
    });

    foot.appendChild(cancelBtn);
    foot.appendChild(saveBtn);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    backdrop.appendChild(modal);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    window.addEventListener('keydown', onKeyDown, true);
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

  function formatVideoProgressText(info) {
    if (!info) return '';
    if (info.stage === 'fetch') return t('stageFetch');
    const pct =
      typeof info.progress === 'number' ? `${Math.round(info.progress * 100)}%` : '';
    if (info.stage === 'extract') {
      return `${t('stageExtract')} ${pct}`.trim();
    }
    if (info.stage === 'encode') {
      return `${t('stageEncode')} ${pct}`.trim();
    }
    return pct || t('stageFetch');
  }

  /**
   * Manage the floating GIF / MP4 export toolbar overlaid on an X GIF or video player.
   */
  function createVideoUI(videoTarget, callbacks) {
    const { container } = videoTarget;
    container.classList.add('xas-video-root');

    const toolbar = document.createElement('div');
    toolbar.className = 'xas-injected xas-video-toolbar';

    for (const evtName of ['click', 'pointerdown', 'mousedown', 'touchstart']) {
      toolbar.addEventListener(evtName, (e) => {
        if (evtName === 'click') {
          stopBubble(e);
        } else {
          e.stopPropagation();
        }
      });
    }

    container.appendChild(toolbar);

    const state = {
      classification: videoTarget.classification || 'video',
      expanded: false,
      visible: videoTarget.visible !== false,
      busy: null, // null | { stage, progress, frame, total }
    };

    let progressLabelEl = null;
    let progressBarEl = null;

    const updateProgressDom = () => {
      if (!state.busy || !progressLabelEl || !progressBarEl) return;
      progressLabelEl.textContent = formatVideoProgressText(state.busy);
      if (typeof state.busy.progress === 'number') {
        progressBarEl.classList.remove('xas-m3-progress-indeterminate');
        const pct = Math.max(0, Math.min(100, Math.round(state.busy.progress * 100)));
        progressBarEl.style.width = `${pct}%`;
      } else {
        progressBarEl.classList.add('xas-m3-progress-indeterminate');
        progressBarEl.style.width = '';
      }
    };

    const render = () => {
      toolbar.style.display = state.visible ? 'flex' : 'none';
      if (!state.visible) return;

      progressLabelEl = null;
      progressBarEl = null;
      toolbar.textContent = '';
      toolbar.classList.toggle(
        'xas-expanded',
        Boolean(state.busy) || state.expanded || state.classification !== 'video',
      );

      const pill = document.createElement('div');

      if (state.busy) {
        pill.className = 'xas-pill xas-progress-pill';

        const row = document.createElement('div');
        row.className = 'xas-progress-row';

        const spinner = document.createElement('span');
        spinner.className = 'xas-spinner';

        progressLabelEl = document.createElement('span');
        progressLabelEl.className = 'xas-progress-label';

        const cancelBtn = makeIconButton({
          icon: 'stop',
          title: t('cancelGifTitle'),
          size: 14,
          onClick: () => callbacks.onCancel?.(),
        });

        row.appendChild(spinner);
        row.appendChild(progressLabelEl);
        row.appendChild(cancelBtn);

        const track = document.createElement('div');
        track.className = 'xas-m3-progress-track';
        progressBarEl = document.createElement('div');
        progressBarEl.className = 'xas-m3-progress-bar';
        track.appendChild(progressBarEl);

        pill.appendChild(row);
        pill.appendChild(track);
        toolbar.appendChild(pill);
        updateProgressDom();
        return;
      }

      if (state.classification === 'native_gif' || state.classification === 'gif_like_video') {
        pill.className = 'xas-pill xas-suggested';

        const gifBtn = document.createElement('button');
        gifBtn.type = 'button';
        gifBtn.className = 'xas-btn xas-btn-accent';
        const isGifLike = state.classification === 'gif_like_video';
        gifBtn.title = isGifLike ? t('saveGifLikeTitle') : t('saveGifTitle');
        appendIconLabel(gifBtn, isGifLike ? 'auto_awesome' : 'gif_box', t('gifLabel'), 15);
        gifBtn.addEventListener('click', (e) => {
          stopBubble(e);
          callbacks.onExportGif?.();
        });

        const sep = document.createElement('span');
        sep.className = 'xas-sep';

        const mp4Btn = document.createElement('button');
        mp4Btn.type = 'button';
        mp4Btn.className = 'xas-btn';
        mp4Btn.title = t('downloadMp4Title');
        mp4Btn.textContent = t('mp4Label');
        mp4Btn.addEventListener('click', (e) => {
          stopBubble(e);
          callbacks.onDownloadMp4?.();
        });

        pill.appendChild(gifBtn);
        pill.appendChild(sep);
        pill.appendChild(mp4Btn);
        pill.appendChild(
          makeIconButton({
            icon: 'settings',
            title: t('settingsTitle'),
            size: 15,
            onClick: () => callbacks.onOpenSettings?.(),
          }),
        );
        toolbar.appendChild(pill);
        return;
      }

      if (!state.expanded) {
        pill.className = 'xas-pill xas-collapsed';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'xas-btn';
        trigger.title = t('expandVideoToolsTitle');
        appendIconLabel(trigger, 'gif_box', t('gifLabel'), 15);
        trigger.addEventListener('click', (e) => {
          stopBubble(e);
          state.expanded = true;
          render();
        });
        pill.appendChild(trigger);
        toolbar.appendChild(pill);
        return;
      }

      pill.className = 'xas-pill';
      const exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'xas-btn xas-btn-accent';
      exportBtn.title = t('saveGifTitle');
      appendIconLabel(exportBtn, 'gif_box', t('exportGifLabel'), 15);
      exportBtn.addEventListener('click', (e) => {
        stopBubble(e);
        callbacks.onExportGif?.();
      });

      const mp4Btn = document.createElement('button');
      mp4Btn.type = 'button';
      mp4Btn.className = 'xas-btn';
      mp4Btn.title = t('downloadMp4Title');
      appendIconLabel(mp4Btn, 'movie', t('mp4Label'), 15);
      mp4Btn.addEventListener('click', (e) => {
        stopBubble(e);
        callbacks.onDownloadMp4?.();
      });

      pill.appendChild(exportBtn);
      pill.appendChild(mp4Btn);
      pill.appendChild(
        makeIconButton({
          icon: 'settings',
          title: t('settingsTitle'),
          size: 15,
          onClick: () => callbacks.onOpenSettings?.(),
        }),
      );
      pill.appendChild(
        makeIconButton({
          icon: 'close',
          title: t('collapseVideoToolsTitle'),
          size: 15,
          onClick: () => {
            state.expanded = false;
            render();
          },
        }),
      );
      toolbar.appendChild(pill);
    };

    render();

    return {
      setClassification(kind) {
        if (state.classification === kind) return;
        state.classification = kind;
        render();
      },
      setProgress(info) {
        if (info && state.busy && progressLabelEl && progressBarEl) {
          state.busy = info;
          updateProgressDom();
          return;
        }
        state.busy = info || null;
        render();
      },
      setVisible(visible) {
        const next = Boolean(visible);
        if (state.visible === next) return;
        state.visible = next;
        render();
      },
      destroy() {
        container.classList.remove('xas-video-root');
        toolbar.remove();
      },
    };
  }

  // --- main.js ---
  // Replaced at build time with contents of src/styles.css.
  const STYLES_CSS = `
  .xas-root,
  .xas-video-root {
    position: relative !important;
  }

  .xas-toolbar,
  .xas-video-toolbar,
  .xas-lightbox,
  .xas-modal-backdrop,
  .xas-toast {
    --xas-primary: #8ccdff;
    --xas-on-primary: #00344f;
    --xas-primary-container: #004b70;
    --xas-on-primary-container: #cbe6ff;
    --xas-secondary-container: #384956;
    --xas-on-secondary-container: #d3e5f5;
    --xas-surface-container-low: #181c20;
    --xas-surface-container: #1c2024;
    --xas-surface-container-high: #262b31;
    --xas-surface-container-highest: #31363d;
    --xas-on-surface: #e1e3e8;
    --xas-on-surface-variant: #c1c7ce;
    --xas-outline: #8b9198;
    --xas-outline-variant: #41484d;
    --xas-primary-hover: rgba(140, 205, 255, 0.12);
    --xas-error: #ffb4ab;
    --xas-inverse-surface: #e1e3e8;
    --xas-inverse-on-surface: #2d3135;
  }

  .xas-modal-backdrop.xas-theme-light {
    --xas-primary: #006495;
    --xas-on-primary: #ffffff;
    --xas-primary-container: #cbe6ff;
    --xas-on-primary-container: #001e30;
    --xas-secondary-container: #d3e5f5;
    --xas-on-secondary-container: #0c1d29;
    --xas-surface-container-low: #f4f7fb;
    --xas-surface-container: #eef2f7;
    --xas-surface-container-high: #e8edf3;
    --xas-surface-container-highest: #dde3ea;
    --xas-on-surface: #181c20;
    --xas-on-surface-variant: #41484d;
    --xas-outline: #72787e;
    --xas-outline-variant: #c1c7ce;
    --xas-primary-hover: rgba(0, 100, 149, 0.1);
    --xas-error: #ba1a1a;
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

  .xas-toolbar,
  .xas-video-toolbar {
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
    background: rgba(24, 28, 32, 0.84);
    color: var(--xas-on-surface);
    border: 1px solid rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);
    opacity: 0.84;
    transition: opacity 0.18s cubic-bezier(0.2, 0, 0, 1), background 0.18s ease, border-color 0.18s ease;
  }

  .xas-root:hover .xas-pill,
  .xas-video-root:hover .xas-pill,
  .xas-toolbar:hover .xas-pill,
  .xas-video-toolbar:hover .xas-pill,
  .xas-toolbar.xas-expanded .xas-pill,
  .xas-video-toolbar.xas-expanded .xas-pill,
  .xas-pill.xas-suggested {
    opacity: 1;
  }

  .xas-pill.xas-suggested {
    border-color: rgba(140, 205, 255, 0.6);
    background: rgba(0, 48, 72, 0.88);
  }

  .xas-pill.xas-collapsed {
    opacity: 0.56;
    padding: 3px 5px;
  }

  .xas-root:hover .xas-pill.xas-collapsed,
  .xas-video-root:hover .xas-pill.xas-collapsed {
    opacity: 0.96;
  }

  .xas-pill.xas-progress-pill {
    position: relative;
    overflow: hidden;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: 5px 10px 8px;
    border-radius: 16px;
    min-width: 156px;
    opacity: 1;
    background: rgba(24, 28, 32, 0.92);
    border-color: rgba(140, 205, 255, 0.45);
  }

  .xas-progress-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 600;
    color: var(--xas-on-surface);
  }

  .xas-progress-label {
    flex: 1;
    white-space: nowrap;
  }

  .xas-m3-progress-track {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: rgba(140, 205, 255, 0.22);
    overflow: hidden;
  }

  .xas-m3-progress-bar {
    height: 100%;
    width: 0%;
    background: var(--xas-primary);
    transition: width 0.16s linear;
  }

  .xas-m3-progress-bar.xas-m3-progress-indeterminate {
    width: 42% !important;
    animation: xas-indeterminate 1.25s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  @keyframes xas-indeterminate {
    0% {
      transform: translateX(-110%);
    }
    100% {
      transform: translateX(260%);
    }
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

  .xas-btn:focus-visible,
  .xas-lb-btn:focus-visible,
  .xas-m3-icon-btn:focus-visible,
  .xas-m3-seg-btn:focus-visible,
  .xas-m3-text-btn:focus-visible,
  .xas-m3-filled-btn:focus-visible {
    outline: 2px solid var(--xas-primary);
    outline-offset: 2px;
  }

  .xas-btn.xas-btn-active {
    background: var(--xas-primary);
    color: var(--xas-on-primary);
  }

  .xas-btn.xas-btn-accent {
    color: var(--xas-primary);
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
    background: var(--xas-primary);
    border-color: var(--xas-primary);
    color: var(--xas-on-primary);
  }

  .xas-lb-btn.xas-lb-primary:hover {
    filter: brightness(1.06);
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

  /* Material Design 3 Settings Dialog */
  .xas-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483100;
    background: rgba(0, 0, 0, 0.56);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    font-family: "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  @keyframes xas-dialog-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .xas-modal {
    width: 100%;
    max-width: 520px;
    max-height: min(88vh, 760px);
    display: flex;
    flex-direction: column;
    background: var(--xas-surface-container-high);
    color: var(--xas-on-surface);
    border: 1px solid var(--xas-outline-variant);
    border-radius: 28px;
    box-shadow:
      0 12px 36px rgba(0, 0, 0, 0.34),
      0 4px 12px rgba(0, 0, 0, 0.22);
    overflow: hidden;
    animation: xas-dialog-in 0.2s cubic-bezier(0.2, 0, 0, 1);
  }

  .xas-modal-head {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 20px 20px 16px 24px;
    flex-shrink: 0;
  }

  .xas-m3-head-icon {
    width: 40px;
    height: 40px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: var(--xas-primary-container);
    color: var(--xas-on-primary-container);
  }

  .xas-m3-head-text {
    flex: 1;
    min-width: 0;
  }

  .xas-modal-head h3 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    line-height: 26px;
    letter-spacing: -0.01em;
    color: var(--xas-on-surface);
  }

  .xas-m3-head-subtitle {
    margin-top: 2px;
    font-size: 12px;
    line-height: 16px;
    color: var(--xas-on-surface-variant);
  }

  .xas-m3-icon-btn {
    appearance: none;
    width: 40px;
    height: 40px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--xas-on-surface-variant);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.16s ease, color 0.16s ease;
  }

  .xas-m3-icon-btn:hover {
    background: rgba(128, 128, 128, 0.16);
    color: var(--xas-on-surface);
  }

  .xas-modal-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    scrollbar-width: thin;
    scrollbar-color: var(--xas-outline-variant) transparent;
  }

  .xas-m3-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .xas-m3-section-title {
    padding: 0 4px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--xas-primary);
  }

  .xas-m3-card {
    background: var(--xas-surface-container-low);
    border: 1px solid var(--xas-outline-variant);
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .xas-m3-row,
  .xas-m3-row-stack {
    padding: 14px 16px;
    display: flex;
    gap: 14px;
    transition: background 0.15s ease;
  }

  .xas-m3-row {
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
  }

  .xas-m3-row:hover {
    background: rgba(128, 128, 128, 0.08);
  }

  .xas-m3-row-stack {
    flex-direction: column;
    gap: 10px;
  }

  .xas-m3-row + .xas-m3-row,
  .xas-m3-row + .xas-m3-row-stack,
  .xas-m3-row-stack + .xas-m3-row,
  .xas-m3-row-stack + .xas-m3-row-stack {
    border-top: 1px solid var(--xas-outline-variant);
  }

  .xas-m3-row-copy {
    flex: 1;
    min-width: 0;
  }

  .xas-m3-row-title {
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    color: var(--xas-on-surface);
  }

  .xas-m3-row-desc {
    font-size: 12px;
    line-height: 17px;
    color: var(--xas-on-surface-variant);
    margin-top: 2px;
  }

  /* M3 Switch */
  .xas-m3-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    width: 52px;
    height: 32px;
    cursor: pointer;
  }

  .xas-m3-switch-input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    margin: 0;
  }

  .xas-m3-switch-track {
    position: relative;
    width: 52px;
    height: 32px;
    border-radius: 999px;
    background: var(--xas-surface-container-highest);
    border: 2px solid var(--xas-outline);
    box-sizing: border-box;
    transition:
      background 0.2s cubic-bezier(0.2, 0, 0, 1),
      border-color 0.2s cubic-bezier(0.2, 0, 0, 1);
  }

  .xas-m3-switch-thumb {
    position: absolute;
    top: 50%;
    left: 6px;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    background: var(--xas-outline);
    color: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transform: translateY(-50%);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
    transition:
      transform 0.2s cubic-bezier(0.2, 0, 0, 1),
      width 0.2s cubic-bezier(0.2, 0, 0, 1),
      height 0.2s cubic-bezier(0.2, 0, 0, 1),
      background 0.2s cubic-bezier(0.2, 0, 0, 1),
      color 0.2s cubic-bezier(0.2, 0, 0, 1);
  }

  .xas-m3-switch:hover .xas-m3-switch-thumb {
    box-shadow: 0 0 0 8px var(--xas-primary-hover);
  }

  .xas-m3-switch-input:focus-visible + .xas-m3-switch-track {
    outline: 2px solid var(--xas-primary);
    outline-offset: 2px;
  }

  .xas-m3-switch-input:checked + .xas-m3-switch-track {
    background: var(--xas-primary);
    border-color: var(--xas-primary);
  }

  .xas-m3-switch-input:checked + .xas-m3-switch-track .xas-m3-switch-thumb {
    width: 24px;
    height: 24px;
    transform: translate(16px, -50%);
    background: var(--xas-on-primary);
    color: var(--xas-primary);
  }

  /* M3 Segmented Button Group */
  .xas-m3-segmented {
    display: flex;
    width: 100%;
    border-radius: 20px;
    overflow: hidden;
    border: 1px solid var(--xas-outline);
    background: transparent;
  }

  .xas-m3-seg-btn {
    appearance: none;
    flex: 1 1 0;
    min-width: 0;
    height: 36px;
    padding: 0 10px;
    border: none;
    background: transparent;
    color: var(--xas-on-surface);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    white-space: nowrap;
    transition: background 0.16s ease, color 0.16s ease;
  }

  .xas-m3-seg-btn + .xas-m3-seg-btn {
    border-left: 1px solid var(--xas-outline);
  }

  .xas-m3-seg-btn:hover {
    background: rgba(128, 128, 128, 0.12);
  }

  .xas-m3-seg-btn.xas-m3-seg-active {
    background: var(--xas-secondary-container);
    color: var(--xas-on-secondary-container);
    font-weight: 600;
  }

  /* M3 Outlined Text Field */
  .xas-m3-textfield {
    width: 100%;
    box-sizing: border-box;
    height: 44px;
    padding: 0 14px;
    border-radius: 12px;
    border: 1px solid var(--xas-outline);
    background: var(--xas-surface-container);
    color: var(--xas-on-surface);
    font: inherit;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .xas-m3-textfield:hover {
    border-color: var(--xas-on-surface);
  }

  .xas-m3-textfield:focus {
    border-color: var(--xas-primary);
    box-shadow: inset 0 0 0 1px var(--xas-primary);
  }

  .xas-m3-preview-line {
    font-size: 11px;
    color: var(--xas-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    word-break: break-all;
  }

  /* M3 Dialog Actions */
  .xas-modal-foot {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    padding: 14px 24px 20px;
    border-top: 1px solid var(--xas-outline-variant);
    flex-shrink: 0;
  }

  .xas-m3-text-btn,
  .xas-m3-filled-btn {
    appearance: none;
    height: 40px;
    padding: 0 20px;
    border-radius: 999px;
    border: none;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease;
  }

  .xas-m3-text-btn {
    background: transparent;
    color: var(--xas-primary);
  }

  .xas-m3-text-btn:hover {
    background: var(--xas-primary-hover);
  }

  .xas-m3-filled-btn {
    background: var(--xas-primary);
    color: var(--xas-on-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  }

  .xas-m3-filled-btn:hover {
    filter: brightness(1.06);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.32);
  }

  /* M3 Snackbar */
  .xas-toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%) translateY(12px);
    z-index: 2147483200;
    padding: 12px 18px;
    border-radius: 12px;
    background: var(--xas-inverse-surface);
    color: var(--xas-inverse-on-surface);
    box-shadow:
      0 6px 20px rgba(0, 0, 0, 0.36),
      0 2px 6px rgba(0, 0, 0, 0.24);
    font-family: "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 13px;
    font-weight: 500;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s cubic-bezier(0.2, 0, 0, 1), transform 0.18s cubic-bezier(0.2, 0, 0, 1);
  }

  .xas-toast.xas-toast-visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  .xas-toast.xas-toast-error {
    background: #410002;
    color: var(--xas-error);
    border: 1px solid rgba(255, 180, 171, 0.45);
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
})();
