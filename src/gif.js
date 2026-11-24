import { parseMp4Metadata, planFrameSchedule } from './mp4.js';

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
export async function encodeGifFrames(
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
export async function transcodeMp4BlobToGif(
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
