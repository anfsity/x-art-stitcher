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
export function detectBorderArtifactDepth(img, side, maxTrim = 2) {
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
export function extractEdgeStrip(
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
export function detectSplitArtwork(images, options = {}) {
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
