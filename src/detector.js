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
export function extractEdgeStrip(img, side, startFrac = 0, endFrac = 1, samples = DEFAULT_SAMPLES) {
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
export function scoreEdgePair(stripA, stripB, minActivity = 9) {
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
export function detectSplitArtwork(images, options = {}) {
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
