import { extractVideoMediaKey, parseVariantDimensions } from './url.js';

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

export function getRegisteredTweetMedia(tweetId) {
  if (!tweetId) return null;
  return tweetMediaRegistry.get(String(tweetId)) || null;
}

export function getRegisteredTweetVideos(tweetId) {
  if (!tweetId) return null;
  return tweetVideoRegistry.get(String(tweetId)) || null;
}

export function getRegisteredVideoByMediaKey(mediaKey) {
  if (!mediaKey) return null;
  return videoByMediaKeyRegistry.get(String(mediaKey)) || null;
}

export function onTweetMediaCaptured(listener) {
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
export function ingestGraphqlObject(root) {
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
export function extractTweetMediaFromReactFiber(article, targetTweetId = null) {
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
export function extractTweetVideosFromReactFiber(article, targetTweetId = null) {
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
export function installGraphqlInterceptor() {
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
