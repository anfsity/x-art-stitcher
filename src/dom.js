import {
  extractTweetMediaFromReactFiber,
  extractTweetVideosFromReactFiber,
  getRegisteredTweetMedia,
  getRegisteredTweetVideos,
  getRegisteredVideoByMediaKey,
} from './interceptor.js';
import {
  extractVideoMediaKey,
  isTweetMediaUrl,
  isTweetVideoUrl,
  parseStatusHref,
  parseVariantDimensions,
} from './url.js';

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
export function extractGalleriesFromArticle(article) {
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
export function extractVideosFromArticle(article) {
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
