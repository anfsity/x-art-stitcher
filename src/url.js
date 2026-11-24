export function isTweetMediaUrl(src) {
  if (!src || typeof src !== 'string') return false;
  try {
    const u = new URL(src);
    return u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/');
  } catch (_) {
    return false;
  }
}

export function isTweetVideoUrl(src) {
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

export function extractVideoMediaKey(src) {
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

export function parseVariantDimensions(url) {
  if (!url || typeof url !== 'string') return { width: 0, height: 0 };
  const match = url.match(/\/(\d{2,4})x(\d{2,4})\//);
  if (!match) return { width: 0, height: 0 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function buildMediaUrl(src, targetName) {
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

export function getMediaVariantUrls(src, variant) {
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

export function parseStatusHref(href) {
  if (!href) return null;
  const match = href.match(/\/([^/]+)\/status\/(\d+)(?:\/photo\/(\d+))?/i);
  if (!match) return null;
  return {
    handle: match[1],
    tweetId: match[2],
    photoIndex: match[3] ? Number(match[3]) : null,
  };
}

export function formatFilename(template, { handle, tweetId, layout, ext }) {
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
