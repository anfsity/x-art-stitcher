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

export async function fetchBlobWithFallback(urls) {
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

export function fetchRangeBuffer(url, startByte = 0, endByte = 65535) {
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

export async function decodeImage(blob) {
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

export function extractRgbaFromDecoded(decoded, maxDim = 512) {
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

export function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').slice(0, 180);
}

export function downloadBlob(blob, filename) {
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

export async function copyPngBlobToClipboard(blobPromiseOrBlob) {
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

export function injectStyles(cssText) {
  if (typeof GM_addStyle === 'function') {
    GM_addStyle(cssText);
    return;
  }
  const style = document.createElement('style');
  style.textContent = cssText;
  (document.head || document.documentElement).appendChild(style);
}

export function registerMenu(label, callback, id) {
  if (typeof GM_registerMenuCommand !== 'function') return;
  try {
    GM_registerMenuCommand(label, callback, id ? { id } : undefined);
  } catch (_) {
    GM_registerMenuCommand(label, callback);
  }
}
