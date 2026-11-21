import { detectBorderArtifactDepth } from './detector.js';

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
export function computeLayoutPlan(images, layout, order, orderedTrims = null) {
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

export function renderStitchedCanvas(decodedImages, layout, order, { autoTrimBorders = true } = {}) {
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

export function canvasToBlob(canvas, format = 'png', quality = 0.95) {
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

export function getAvailableLayouts(count) {
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
