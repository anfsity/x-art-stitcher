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
export function computeLayoutPlan(images, layout, order) {
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

export function renderStitchedCanvas(decodedImages, layout, order) {
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
