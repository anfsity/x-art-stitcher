import { extractTweetMediaFromReactFiber, getRegisteredTweetMedia } from './interceptor.js';
import { isTweetMediaUrl, parseStatusHref } from './url.js';

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
