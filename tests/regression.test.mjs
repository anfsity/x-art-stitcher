import assert from 'node:assert/strict';
import test from 'node:test';

import { getThresholds } from '../src/config.js';
import { detectBorderArtifactDepth, detectSplitArtwork } from '../src/detector.js';
import { encodeGifFrames } from '../src/gif.js';
import {
  getRegisteredTweetMedia,
  getRegisteredTweetVideos,
  getRegisteredVideoByMediaKey,
  ingestGraphqlObject,
} from '../src/interceptor.js';
import { classifyGifMedia, parseMp4Metadata, planFrameSchedule } from '../src/mp4.js';
import { computeLayoutPlan } from '../src/stitcher.js';
import { extractVideoMediaKey, isTweetVideoUrl, parseVariantDimensions } from '../src/url.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateArtwork(width, height, seed = 42) {
  const rand = mulberry32(seed);
  const data = new Uint8ClampedArray(width * height * 4);

  const bgA = [40 + rand() * 140, 50 + rand() * 140, 80 + rand() * 140];
  const bgB = [120 + rand() * 120, 80 + rand() * 120, 40 + rand() * 140];
  const shapes = Array.from({ length: 14 }, () => ({
    cx: rand() * width,
    cy: rand() * height,
    rx: (0.08 + rand() * 0.25) * width,
    ry: (0.08 + rand() * 0.25) * height,
    r: Math.floor(rand() * 255),
    g: Math.floor(rand() * 255),
    b: Math.floor(rand() * 255),
  }));
  const freqX = 0.015 + rand() * 0.025;
  const freqY = 0.015 + rand() * 0.025;
  const phase = rand() * Math.PI * 2;

  for (let y = 0; y < height; y++) {
    const ty = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x++) {
      const tx = x / Math.max(1, width - 1);
      const wave = 0.5 + 0.5 * Math.sin(x * freqX + y * freqY + phase);

      let r = bgA[0] * (1 - ty) + bgB[0] * ty + 35 * Math.sin(tx * 7 + phase) + 25 * wave;
      let g = bgA[1] * (1 - tx) + bgB[1] * tx + 35 * Math.cos(ty * 6 + phase);
      let b = bgA[2] * (1 - 0.5 * (tx + ty)) + bgB[2] * (0.5 * (tx + ty)) + 30 * (1 - wave);

      for (const s of shapes) {
        const dx = (x - s.cx) / s.rx;
        const dy = (y - s.cy) / s.ry;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1.0) {
          if (d2 > 0.88) {
            r = 25;
            g = 22;
            b = 30;
          } else {
            r = s.r * 0.75 + r * 0.25;
            g = s.g * 0.75 + g * 0.25;
            b = s.b * 0.75 + b * 0.25;
          }
        }
      }

      const idx = (y * width + x) * 4;
      data[idx] = Math.max(0, Math.min(255, Math.round(r)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[idx + 3] = 255;
    }
  }

  return { width, height, origWidth: width, origHeight: height, data };
}

function generateCenteredSketch(width, height, bgColor, seed) {
  const art = generateArtwork(width, height, seed);
  const marginX = Math.floor(width * 0.14);
  const marginY = Math.floor(height * 0.14);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < marginX || x >= width - marginX || y < marginY || y >= height - marginY) {
        const idx = (y * width + x) * 4;
        art.data[idx] = bgColor[0];
        art.data[idx + 1] = bgColor[1];
        art.data[idx + 2] = bgColor[2];
      }
    }
  }
  return art;
}

function cropImage(src, x0, y0, w, h, noiseAmp = 0, noiseSeed = 1) {
  const data = new Uint8ClampedArray(w * h * 4);
  const rand = mulberry32(noiseSeed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sIdx = ((y0 + y) * src.width + (x0 + x)) * 4;
      const dIdx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const n = noiseAmp > 0 ? (rand() * 2 - 1) * noiseAmp : 0;
        data[dIdx + c] = Math.max(0, Math.min(255, Math.round(src.data[sIdx + c] + n)));
      }
      data[dIdx + 3] = 255;
    }
  }
  return { width: w, height: h, origWidth: w, origHeight: h, data };
}

function simulateThumbnail(src, maxDim = 220) {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y / h) * src.height));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / w) * src.width));
      const sIdx = (sy * src.width + sx) * 4;
      const dIdx = (y * w + x) * 4;
      data[dIdx] = src.data[sIdx];
      data[dIdx + 1] = src.data[sIdx + 1];
      data[dIdx + 2] = src.data[sIdx + 2];
      data[dIdx + 3] = 255;
    }
  }
  return { width: w, height: h, origWidth: w, origHeight: h, data };
}

const NORMAL = { ...getThresholds('normal'), allowUnshuffle: true };

test('regression: recovers scrambled anti-AI 2x2 artwork and plans 1:1 stitch', () => {
  const art = generateArtwork(400, 400, 202);
  const tl = cropImage(art, 0, 0, 200, 200);
  const tr = cropImage(art, 200, 0, 200, 200);
  const bl = cropImage(art, 0, 200, 200, 200);
  const br = cropImage(art, 200, 200, 200, 200);

  const scrambled = [bl, tl, br, tr];
  const res = detectSplitArtwork(scrambled, NORMAL);

  assert.equal(res.isMatch, true);
  assert.equal(res.winner.layout, 'grid-2x2');
  assert.deepEqual(res.winner.order, [1, 3, 0, 2]);
  assert.equal(res.wasUnshuffled, true);

  const plan = computeLayoutPlan(scrambled, res.winner.layout, res.winner.order);
  assert.equal(plan.width, 400);
  assert.equal(plan.height, 400);
  assert.equal(plan.downscale, 1);
});

test('regression: detects gap-cropped noisy 2x2 split and unequal thumb-scaled 2x2 split', () => {
  const artGap = generateArtwork(520, 520, 404);
  const gap = 4;
  const noisyTiles = [
    cropImage(artGap, 0, 0, 260 - gap / 2, 260 - gap / 2, 6, 11),
    cropImage(artGap, 260 + gap / 2, 0, 260 - gap / 2, 260 - gap / 2, 6, 12),
    cropImage(artGap, 0, 260 + gap / 2, 260 - gap / 2, 260 - gap / 2, 6, 13),
    cropImage(artGap, 260 + gap / 2, 260 + gap / 2, 260 - gap / 2, 260 - gap / 2, 6, 14),
  ];
  const gapRes = detectSplitArtwork(noisyTiles, NORMAL);
  assert.equal(gapRes.isMatch, true);
  assert.equal(gapRes.winner.layout, 'grid-2x2');
  assert.deepEqual(gapRes.winner.order, [0, 1, 2, 3]);

  const artUnequal = generateArtwork(600, 500, 303);
  const unequalThumbs = [
    cropImage(artUnequal, 0, 0, 240, 180),
    cropImage(artUnequal, 240, 0, 360, 180),
    cropImage(artUnequal, 0, 180, 240, 320),
    cropImage(artUnequal, 240, 180, 360, 320),
  ].map((t) => simulateThumbnail(t, 200));
  const unequalRes = detectSplitArtwork(unequalThumbs, NORMAL);
  assert.equal(unequalRes.isMatch, true);
  assert.equal(unequalRes.winner.layout, 'grid-2x2');
});

test('regression: detects shuffled X 3-image 1L+2R layout and 4-panel vertical strip', () => {
  const art3 = generateArtwork(480, 420, 606);
  const inputs3 = [
    cropImage(art3, 220, 160, 260, 260),
    cropImage(art3, 0, 0, 220, 420),
    cropImage(art3, 220, 0, 260, 160),
  ].map((t) => simulateThumbnail(t, 200));

  const res3 = detectSplitArtwork(inputs3, NORMAL);
  assert.equal(res3.isMatch, true);
  assert.equal(res3.winner.layout, '3-left-tall');
  assert.deepEqual(res3.winner.order, [1, 2, 0]);
  assert.equal(res3.wasUnshuffled, true);

  const art4 = generateArtwork(260, 640, 808);
  const inputs4 = [
    cropImage(art4, 0, 320, 260, 160),
    cropImage(art4, 0, 0, 260, 160),
    cropImage(art4, 0, 480, 260, 160),
    cropImage(art4, 0, 160, 260, 160),
  ];
  const res4 = detectSplitArtwork(inputs4, NORMAL);
  assert.equal(res4.isMatch, true);
  assert.equal(res4.winner.layout, 'vertical');
  assert.deepEqual(res4.winner.order, [1, 3, 0, 2]);
});

test('regression: ingests 15-slice carousel GraphQL payload and stitches unequal vertical strips horizontally', () => {
  const sliceWidths = [24, 34, 38, 38, 36, 36, 36, 36, 180, 32, 32, 36, 38, 32, 32];
  const totalW = sliceWidths.reduce((a, b) => a + b, 0);
  const height = 420;
  const art = generateCenteredSketch(totalW, height, [245, 245, 245], 909);

  // Simulate X GraphQL response containing all 15 photos with original_info dimensions.
  const payload = {
    data: {
      tweetResult: {
        result: {
          rest_id: '2123718006232826228',
          core: { user_results: { result: { core: { screen_name: 'poluo219234' } } } },
          legacy: {
            extended_entities: {
              media: sliceWidths.map((w, i) => ({
                type: 'photo',
                media_url_https: `https://pbs.twimg.com/media/Slice${i}.jpg`,
                original_info: { width: w * 5, height: height * 5 },
              })),
            },
          },
        },
      },
    },
  };

  assert.equal(ingestGraphqlObject(payload), 1);
  const entry = getRegisteredTweetMedia('2123718006232826228');
  assert.equal(entry.handle, 'poluo219234');
  assert.equal(entry.photos.length, 15);

  const slices = [];
  let cursor = 0;
  for (let i = 0; i < sliceWidths.length; i++) {
    const w = sliceWidths[i];
    const tile = cropImage(art, cursor, 0, w, height);
    tile.origWidth = entry.photos[i].width;
    tile.origHeight = entry.photos[i].height;
    slices.push(tile);
    cursor += w;
  }

  const res = detectSplitArtwork(slices, NORMAL);
  assert.equal(res.isMatch, true);
  assert.equal(res.winner.layout, 'horizontal');
  assert.deepEqual(res.winner.order, Array.from({ length: 15 }, (_, i) => i));

  const plan = computeLayoutPlan(
    entry.photos.map((p) => ({ width: p.width, height: p.height })),
    res.winner.layout,
    res.winner.order,
  );
  assert.equal(plan.width, totalW * 5);
  assert.equal(plan.height, height * 5);
});

test('regression: never falsely stitches unrelated artworks or solid-background sketches', () => {
  const unrelated = [
    generateArtwork(220, 260, 1111),
    generateArtwork(220, 260, 2222),
    generateArtwork(220, 260, 3333),
    generateArtwork(220, 260, 4444),
  ];
  assert.equal(detectSplitArtwork(unrelated, NORMAL).isMatch, false);

  const whiteSketches = [
    generateCenteredSketch(220, 220, [255, 255, 255], 5001),
    generateCenteredSketch(220, 220, [255, 255, 255], 5002),
    generateCenteredSketch(220, 220, [255, 255, 255], 5003),
    generateCenteredSketch(220, 220, [255, 255, 255], 5004),
  ];
  assert.equal(detectSplitArtwork(whiteSketches, NORMAL).isMatch, false);

  const blackSketches = [
    generateCenteredSketch(220, 220, [0, 0, 0], 6001),
    generateCenteredSketch(220, 220, [0, 0, 0], 6002),
    generateCenteredSketch(220, 220, [0, 0, 0], 6003),
    generateCenteredSketch(220, 220, [0, 0, 0], 6004),
  ];
  assert.equal(detectSplitArtwork(blackSketches, NORMAL).isMatch, false);
});

test('regression: canvas downscale cap strictly stays within browser pixel budget', () => {
  const huge = [
    { width: 12000, height: 12000 },
    { width: 12000, height: 12000 },
  ];
  const capped = computeLayoutPlan(huge, 'horizontal', [0, 1]);
  assert.ok(capped.width <= 16000);
  assert.ok(capped.height <= 16000);
  assert.ok(capped.width * capped.height <= 120_000_000);
});

function darkenRightBorder(img, thickness = 1, factor = 0.52) {
  const data = new Uint8ClampedArray(img.data);
  for (let y = 0; y < img.height; y++) {
    for (let dx = 0; dx < thickness; dx++) {
      const x = img.width - 1 - dx;
      const idx = (y * img.width + x) * 4;
      data[idx] = Math.round(data[idx] * factor);
      data[idx + 1] = Math.round(data[idx + 1] * factor);
      data[idx + 2] = Math.round(data[idx + 2] * factor);
    }
  }
  return { ...img, data };
}

test('regression: detects mixed carousel partial split with 1px dark border artifact without swallowing neighbors', () => {
  // Modeled after real 11-image mixed carousel: 4-slice horizontal artwork (with a 1px dark
  // artifact line on slice #0 right edge and pure-white right margin on slice #3) followed by
  // 7 standalone artworks including a white-background sketch right next to #3 and dark-bg pairs.
  const panorama = generateArtwork(800, 400, 1337);
  // Make the far-right margin of slice #3 pure white like an illustration on white canvas.
  for (let y = 0; y < panorama.height; y++) {
    for (let x = 740; x < panorama.width; x++) {
      const idx = (y * panorama.width + x) * 4;
      panorama.data[idx] = 255;
      panorama.data[idx + 1] = 255;
      panorama.data[idx + 2] = 255;
    }
  }

  const s0Raw = cropImage(panorama, 0, 0, 200, 400);
  const s0 = darkenRightBorder(s0Raw, 1, 0.52);
  const s1 = cropImage(panorama, 200, 0, 200, 400);
  const s2 = cropImage(panorama, 400, 0, 200, 400);
  const s3 = cropImage(panorama, 600, 0, 200, 400);

  assert.equal(detectBorderArtifactDepth(s0, 'right', 2), 1);
  assert.equal(detectBorderArtifactDepth(s1, 'left', 2), 0);

  const mixed = [
    s0,
    s1,
    s2,
    s3,
    generateCenteredSketch(240, 400, [255, 255, 255], 7001),
    generateCenteredSketch(240, 400, [22, 24, 30], 7002),
    generateCenteredSketch(240, 400, [22, 24, 30], 7003),
    generateArtwork(280, 400, 7004),
    generateArtwork(280, 400, 7005),
    generateArtwork(200, 400, 7006),
    generateArtwork(280, 400, 7007),
  ];

  const res = detectSplitArtwork(mixed, NORMAL);
  assert.equal(res.isMatch, true);
  assert.equal(res.isPartial, true);
  assert.equal(res.groups.length, 8);
  assert.equal(res.groups[0].type, 'stitched');
  assert.deepEqual(res.groups[0].indices, [0, 1, 2, 3]);
  assert.equal(res.groups[0].layout, 'horizontal');
  assert.deepEqual(res.groups[0].order, [0, 1, 2, 3]);
  for (let i = 1; i < res.groups.length; i++) {
    assert.equal(res.groups[i].type, 'single');
    assert.equal(res.groups[i].index, i + 3);
  }

  // Verify layout planner honors internal seam trims without distorting height.
  const plan = computeLayoutPlan(
    [s0, s1, s2, s3],
    'horizontal',
    [0, 1, 2, 3],
    [{ right: 1 }, {}, {}, {}],
  );
  assert.equal(plan.width, 799);
  assert.equal(plan.height, 400);
  assert.equal(plan.rects[0].sw, 199);
  assert.equal(plan.rects[1].x, 199);
});

test('regression: extracts multiple disjoint split groups (2x2 + horizontal strip) alongside standalone covers', () => {
  const cover = generateArtwork(260, 320, 8100);
  const artGrid = generateArtwork(360, 360, 8200);
  const gTL = cropImage(artGrid, 0, 0, 180, 180);
  const gTR = cropImage(artGrid, 180, 0, 180, 180);
  const gBL = cropImage(artGrid, 0, 180, 180, 180);
  const gBR = cropImage(artGrid, 180, 180, 180, 180);

  const artStrip = generateArtwork(480, 260, 8300);
  const p0 = cropImage(artStrip, 0, 0, 160, 260);
  const p1 = cropImage(artStrip, 160, 0, 160, 260);
  const p2 = cropImage(artStrip, 320, 0, 160, 260);

  // [cover, scrambled 2x2 (4 tiles), 3-slice horizontal strip]
  const carousel = [cover, gBL, gTL, gBR, gTR, p0, p1, p2];
  const res = detectSplitArtwork(carousel, NORMAL);

  assert.equal(res.isMatch, true);
  assert.equal(res.isPartial, true);
  assert.equal(res.groups.length, 3);
  assert.deepEqual(res.groups[0], { type: 'single', index: 0 });
  assert.equal(res.groups[1].type, 'stitched');
  assert.deepEqual(res.groups[1].indices, [1, 2, 3, 4]);
  assert.equal(res.groups[1].layout, 'grid-2x2');
  assert.deepEqual(res.groups[1].order, [1, 3, 0, 2]);
  assert.equal(res.groups[1].wasUnshuffled, true);
  assert.equal(res.groups[2].type, 'stitched');
  assert.deepEqual(res.groups[2].indices, [5, 6, 7]);
  assert.equal(res.groups[2].layout, 'horizontal');
  assert.deepEqual(res.groups[2].order, [0, 1, 2]);
});

test('regression: never falsely extracts partial split groups from unrelated multi-image dumps', () => {
  const dump = [
    generateCenteredSketch(220, 260, [255, 255, 255], 9101),
    generateCenteredSketch(220, 260, [255, 255, 255], 9102),
    generateCenteredSketch(220, 260, [18, 20, 26], 9103),
    generateCenteredSketch(220, 260, [18, 20, 26], 9104),
    generateArtwork(220, 260, 9105),
    generateArtwork(220, 260, 9106),
    generateArtwork(220, 260, 9107),
    generateArtwork(220, 260, 9108),
  ];
  const res = detectSplitArtwork(dump, NORMAL);
  assert.equal(res.isMatch, false);
  assert.equal(res.isPartial, false);
  assert.equal(res.groups.length, 0);
});

function concatBytes(...chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function makeBox(type, ...parts) {
  const payload = concatBytes(...parts);
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function makeFullBox(type, version, flags, ...parts) {
  const header = new Uint8Array(4);
  header[0] = version;
  header[1] = (flags >> 16) & 0xff;
  header[2] = (flags >> 8) & 0xff;
  header[3] = flags & 0xff;
  return makeBox(type, header, ...parts);
}

function buildSyntheticMp4({
  width = 480,
  height = 360,
  timescale = 1000,
  durationTicks = 4000,
  sttsEntries = [[40, 100]],
  cttsEntries = null,
  includeAudio = false,
} = {}) {
  const ftyp = makeBox('ftyp', new TextEncoder().encode('isom\0\0\x02\0isomiso2'));

  const tkhdBody = new Uint8Array(80);
  const tkhdView = new DataView(tkhdBody.buffer);
  tkhdView.setUint32(8, 1, false);
  tkhdView.setUint32(72, width << 16, false);
  tkhdView.setUint32(76, height << 16, false);
  const tkhd = makeFullBox('tkhd', 0, 3, tkhdBody);

  const mdhdBody = new Uint8Array(20);
  const mdhdView = new DataView(mdhdBody.buffer);
  mdhdView.setUint32(8, timescale, false);
  mdhdView.setUint32(12, durationTicks, false);
  const mdhd = makeFullBox('mdhd', 0, 0, mdhdBody);

  const hdlrBody = new Uint8Array(16);
  hdlrBody.set(new TextEncoder().encode('vide'), 4);
  const hdlr = makeFullBox('hdlr', 0, 0, hdlrBody);

  const sttsBody = new Uint8Array(4 + sttsEntries.length * 8);
  const sttsView = new DataView(sttsBody.buffer);
  sttsView.setUint32(0, sttsEntries.length, false);
  sttsEntries.forEach(([count, delta], i) => {
    sttsView.setUint32(4 + i * 8, count, false);
    sttsView.setUint32(8 + i * 8, delta, false);
  });
  const stts = makeFullBox('stts', 0, 0, sttsBody);

  const stblParts = [stts];
  if (cttsEntries) {
    const cttsBody = new Uint8Array(4 + cttsEntries.length * 8);
    const cttsView = new DataView(cttsBody.buffer);
    cttsView.setUint32(0, cttsEntries.length, false);
    cttsEntries.forEach(([count, offset], i) => {
      cttsView.setUint32(4 + i * 8, count, false);
      cttsView.setInt32(8 + i * 8, offset, false);
    });
    stblParts.push(makeFullBox('ctts', 1, 0, cttsBody));
  }

  const stbl = makeBox('stbl', ...stblParts);
  const minf = makeBox('minf', stbl);
  const mdia = makeBox('mdia', mdhd, hdlr, minf);
  const videoTrak = makeBox('trak', tkhd, mdia);

  const moovChildren = [videoTrak];
  if (includeAudio) {
    const audioHdlrBody = new Uint8Array(16);
    audioHdlrBody.set(new TextEncoder().encode('soun'), 4);
    const audioMdia = makeBox('mdia', makeFullBox('hdlr', 0, 0, audioHdlrBody));
    moovChildren.push(makeBox('trak', audioMdia));
  }

  const moov = makeBox('moov', ...moovChildren);
  return concatBytes(ftyp, moov);
}

test('regression: parses ISO-BMFF MP4 metadata, plans frame schedule, and classifies GIF media', () => {
  const silentMp4 = buildSyntheticMp4({
    width: 480,
    height: 360,
    timescale: 1000,
    durationTicks: 4000,
    sttsEntries: [[40, 100]],
    cttsEntries: Array.from({ length: 10 }, () => [
      [1, 200],
      [1, -100],
      [1, 0],
      [1, -100],
    ]).flat(),
  });

  const silentMeta = parseMp4Metadata(silentMp4);
  assert.equal(silentMeta.hasMoov, true);
  assert.equal(silentMeta.complete, true);
  assert.equal(silentMeta.hasVideo, true);
  assert.equal(silentMeta.hasAudio, false);
  assert.equal(silentMeta.width, 480);
  assert.equal(silentMeta.height, 360);
  assert.equal(silentMeta.durationSec, 4);
  assert.equal(silentMeta.frameCount, 40);
  assert.equal(silentMeta.avgFps, 10);
  assert.equal(silentMeta.frameTimestamps[0], 0);
  for (let i = 1; i < silentMeta.frameTimestamps.length; i++) {
    assert.ok(silentMeta.frameTimestamps[i] >= silentMeta.frameTimestamps[i - 1]);
  }

  assert.equal(
    classifyGifMedia({
      type: 'video',
      mp4Url: 'https://video.twimg.com/ext_tw_video/111/pu/vid/480x360/clip.mp4',
      mp4Probe: silentMeta,
      durationMs: 4000,
    }),
    'gif_like_video',
  );
  assert.equal(
    classifyGifMedia({
      type: 'animated_gif',
      mp4Url: 'https://video.twimg.com/tweet_video/AbCdEf.mp4',
    }),
    'native_gif',
  );

  // Preserves native 10fps cadence when targetFps is 15
  const nativePlan = planFrameSchedule(silentMeta, 4, { targetFps: 15, maxDurationSec: 15 });
  assert.equal(nativePlan.timestamps.length, 40);
  assert.equal(nativePlan.truncated, false);
  assert.ok(nativePlan.delaysCs.every((d) => d >= 2));

  // Downsamples and truncates cleanly when targetFps=5 and maxDurationSec=2
  const downsampled = planFrameSchedule(silentMeta, 4, { targetFps: 5, maxDurationSec: 2 });
  assert.ok(downsampled.timestamps.length >= 9 && downsampled.timestamps.length <= 12);
  assert.equal(downsampled.truncated, true);
  assert.ok(downsampled.delaysCs.every((d) => d >= 2));

  // Video with audio track is classified as regular 'video'
  const audioMp4 = buildSyntheticMp4({ includeAudio: true });
  const audioMeta = parseMp4Metadata(audioMp4);
  assert.equal(audioMeta.complete, true);
  assert.equal(audioMeta.hasAudio, true);
  assert.equal(
    classifyGifMedia({
      type: 'video',
      mp4Url: 'https://video.twimg.com/ext_tw_video/222/pu/vid/480x360/clip.mp4',
      mp4Probe: audioMeta,
      durationMs: 4000,
    }),
    'video',
  );

  // Truncated Range response sets complete=false without throwing or misclassifying
  const truncated = silentMp4.slice(0, silentMp4.length - 24);
  const partialMeta = parseMp4Metadata(truncated);
  assert.equal(partialMeta.hasMoov, true);
  assert.equal(partialMeta.complete, false);
  assert.equal(
    classifyGifMedia({
      type: 'video',
      mp4Url: 'https://video.twimg.com/ext_tw_video/333/pu/vid/480x360/clip.mp4',
      mp4Probe: partialMeta,
      durationMs: 4000,
    }),
    'video',
  );
});

test('regression: ingests GraphQL animated_gif and multi-bitrate video variants while keeping photo registry intact', () => {
  assert.equal(isTweetVideoUrl('https://video.twimg.com/tweet_video/XyZ123.mp4'), true);
  assert.equal(isTweetVideoUrl('https://pbs.twimg.com/media/Abc.jpg'), false);
  assert.equal(
    extractVideoMediaKey('https://pbs.twimg.com/tweet_video_thumb/XyZ123.jpg'),
    'tweet_video:XyZ123',
  );
  assert.equal(
    extractVideoMediaKey('https://video.twimg.com/ext_tw_video/987654321/pu/vid/avc1/720x1280/abc.mp4'),
    'ext_tw_video:987654321',
  );
  assert.deepEqual(
    parseVariantDimensions('https://video.twimg.com/ext_tw_video/987654321/pu/vid/avc1/720x1280/abc.mp4'),
    { width: 720, height: 1280 },
  );

  const payload = {
    data: {
      items: [
        {
          rest_id: '5550001',
          core: { user_results: { result: { core: { screen_name: 'gif_artist' } } } },
          legacy: {
            extended_entities: {
              media: [
                {
                  id_str: '9001',
                  type: 'animated_gif',
                  media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/GifKey9001.jpg',
                  original_info: { width: 640, height: 480 },
                  video_info: {
                    variants: [
                      {
                        bitrate: 0,
                        content_type: 'video/mp4',
                        url: 'https://video.twimg.com/tweet_video/GifKey9001.mp4',
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
        {
          rest_id: '5550002',
          core: { user_results: { result: { core: { screen_name: 'anim_creator' } } } },
          legacy: {
            extended_entities: {
              media: [
                {
                  id_str: '9002',
                  type: 'video',
                  media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/777888999/pu/img/thumb.jpg',
                  original_info: { width: 1080, height: 1920 },
                  video_info: {
                    duration_millis: 6200,
                    variants: [
                      {
                        content_type: 'application/x-mpegURL',
                        url: 'https://video.twimg.com/ext_tw_video/777888999/pu/pl/master.m3u8',
                      },
                      {
                        bitrate: 632000,
                        content_type: 'video/mp4',
                        url: 'https://video.twimg.com/ext_tw_video/777888999/pu/vid/320x568/low.mp4',
                      },
                      {
                        bitrate: 2176000,
                        content_type: 'video/mp4',
                        url: 'https://video.twimg.com/ext_tw_video/777888999/pu/vid/720x1280/high.mp4',
                      },
                    ],
                  },
                },
                {
                  type: 'photo',
                  media_url_https: 'https://pbs.twimg.com/media/MixPhotoA.jpg',
                  original_info: { width: 800, height: 800 },
                },
                {
                  type: 'photo',
                  media_url_https: 'https://pbs.twimg.com/media/MixPhotoB.jpg',
                  original_info: { width: 800, height: 800 },
                },
              ],
            },
          },
        },
      ],
    },
  };

  assert.equal(ingestGraphqlObject(payload), 2);

  const gifEntry = getRegisteredTweetVideos('5550001');
  assert.equal(gifEntry.handle, 'gif_artist');
  assert.equal(gifEntry.videos.length, 1);
  assert.equal(gifEntry.videos[0].type, 'animated_gif');
  assert.equal(gifEntry.videos[0].mediaKey, 'tweet_video:GifKey9001');

  const byKey = getRegisteredVideoByMediaKey('ext_tw_video:777888999');
  assert.equal(byKey.handle, 'anim_creator');
  assert.equal(byKey.variants.length, 2);
  assert.equal(byKey.variants[0].bitrate, 2176000);
  assert.equal(byKey.variants[0].width, 720);
  assert.equal(byKey.variants[0].height, 1280);
  assert.equal(byKey.durationMs, 6200);

  const mixPhotos = getRegisteredTweetMedia('5550002');
  assert.equal(mixPhotos.photos.length, 2);
});

function decodeGif89a(bytes) {
  const header = new TextDecoder().decode(bytes.subarray(0, 6));
  assert.equal(header, 'GIF89a');

  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const lsdPacked = bytes[10];
  const hasGct = (lsdPacked & 0x80) !== 0;
  const gctSize = hasGct ? 1 << ((lsdPacked & 0x07) + 1) : 0;

  let pos = 13;
  const gct = hasGct ? bytes.subarray(pos, pos + gctSize * 3) : null;
  pos += gctSize * 3;

  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames = [];
  let loopCount = null;
  let pendingGce = { delayCs: 0, transparentIdx: -1, disposal: 0 };

  const readSubBlocks = () => {
    const chunks = [];
    while (pos < bytes.length) {
      const len = bytes[pos++];
      if (len === 0) break;
      chunks.push(bytes.subarray(pos, pos + len));
      pos += len;
    }
    return concatBytes(...chunks);
  };

  const decodeLzw = (minCodeSize, compressed, pixelCount) => {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    const dict = new Array(4096);
    for (let i = 0; i < clearCode; i++) dict[i] = [i];

    let bitPos = 0;
    const readCode = () => {
      let val = 0;
      for (let b = 0; b < codeSize; b++) {
        const byteIdx = bitPos >> 3;
        const bitOffset = bitPos & 7;
        assert.ok(byteIdx < compressed.length, 'Unexpected end of LZW stream');
        val |= ((compressed[byteIdx] >> bitOffset) & 1) << b;
        bitPos++;
      }
      return val;
    };

    const output = new Uint8Array(pixelCount);
    let outPos = 0;
    let prevCode = -1;

    while (true) {
      const code = readCode();
      if (code === eoiCode) break;
      if (code === clearCode) {
        codeSize = minCodeSize + 1;
        nextCode = eoiCode + 1;
        prevCode = -1;
        continue;
      }

      let entry;
      if (code < nextCode) {
        entry = dict[code];
      } else if (code === nextCode && prevCode !== -1) {
        entry = dict[prevCode].concat(dict[prevCode][0]);
      } else {
        throw new Error(`Invalid LZW code ${code} at nextCode=${nextCode}`);
      }

      for (let i = 0; i < entry.length && outPos < pixelCount; i++) {
        output[outPos++] = entry[i];
      }

      if (prevCode !== -1 && nextCode < 4096) {
        dict[nextCode++] = dict[prevCode].concat(entry[0]);
        if (nextCode >= 1 << codeSize && codeSize < 12) {
          codeSize++;
        }
      }
      prevCode = code;
    }

    assert.equal(outPos, pixelCount);
    return output;
  };

  while (pos < bytes.length) {
    const marker = bytes[pos++];
    if (marker === 0x3b) {
      return { width, height, loopCount, frames, endedCleanly: true };
    }
    if (marker === 0x21) {
      const label = bytes[pos++];
      if (label === 0xf9) {
        const blockLen = bytes[pos++];
        assert.equal(blockLen, 4);
        const packed = bytes[pos++];
        const delayCs = bytes[pos++] | (bytes[pos++] << 8);
        const transparentIdx = bytes[pos++];
        assert.equal(bytes[pos++], 0);
        pendingGce = {
          disposal: (packed >> 2) & 0x07,
          transparentIdx: (packed & 0x01) !== 0 ? transparentIdx : -1,
          delayCs,
        };
      } else if (label === 0xff) {
        const appLen = bytes[pos++];
        const appId = new TextDecoder().decode(bytes.subarray(pos, pos + appLen));
        pos += appLen;
        const appData = readSubBlocks();
        if (appId === 'NETSCAPE2.0' && appData.length >= 3 && appData[0] === 1) {
          loopCount = appData[1] | (appData[2] << 8);
        }
      } else {
        readSubBlocks();
      }
      continue;
    }

    if (marker === 0x2c) {
      const left = bytes[pos++] | (bytes[pos++] << 8);
      const top = bytes[pos++] | (bytes[pos++] << 8);
      const boxW = bytes[pos++] | (bytes[pos++] << 8);
      const boxH = bytes[pos++] | (bytes[pos++] << 8);
      const imgPacked = bytes[pos++];
      const hasLct = (imgPacked & 0x80) !== 0;
      const lctSize = hasLct ? 1 << ((imgPacked & 0x07) + 1) : 0;
      const palette = hasLct ? bytes.subarray(pos, pos + lctSize * 3) : gct;
      pos += lctSize * 3;

      const minCodeSize = bytes[pos++];
      const compressed = readSubBlocks();
      const indices = decodeLzw(minCodeSize, compressed, boxW * boxH);

      for (let y = 0; y < boxH; y++) {
        for (let x = 0; x < boxW; x++) {
          const colorIdx = indices[y * boxW + x];
          if (colorIdx === pendingGce.transparentIdx) continue;
          const dIdx = ((top + y) * width + (left + x)) * 4;
          const pBase = colorIdx * 3;
          canvas[dIdx] = palette[pBase];
          canvas[dIdx + 1] = palette[pBase + 1];
          canvas[dIdx + 2] = palette[pBase + 2];
          canvas[dIdx + 3] = 255;
        }
      }

      frames.push({
        left,
        top,
        boxW,
        boxH,
        delayCs: pendingGce.delayCs,
        usedLocalPalette: hasLct,
        rgba: new Uint8ClampedArray(canvas),
      });
    }
  }

  throw new Error('Missing GIF trailer');
}

function makeSolidWithMovingBox(width, height, bg, boxRect, boxColor) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inBox =
        x >= boxRect.x &&
        x < boxRect.x + boxRect.w &&
        y >= boxRect.y &&
        y < boxRect.y + boxRect.h;
      const c = inBox ? boxColor : bg;
      const idx = (y * width + x) * 4;
      data[idx] = c[0];
      data[idx + 1] = c[1];
      data[idx + 2] = c[2];
      data[idx + 3] = 255;
    }
  }
  return data;
}

test('regression: encodes valid GIF89a with delta cropping, duplicate frame merging, and LZW round-trip across quality presets', async () => {
  const w = 64;
  const h = 48;
  const f0 = makeSolidWithMovingBox(w, h, [28, 42, 68], { x: 8, y: 10, w: 12, h: 12 }, [240, 90, 40]);
  const f1 = makeSolidWithMovingBox(w, h, [28, 42, 68], { x: 24, y: 16, w: 12, h: 12 }, [50, 210, 140]);
  const f2 = new Uint8ClampedArray(f1); // Duplicate of f1 should merge delay into emitted frame 1
  const f3 = makeSolidWithMovingBox(w, h, [28, 42, 68], { x: 40, y: 20, w: 12, h: 12 }, [250, 220, 60]);

  const inputFrames = [
    { data: f0, delayCs: 10 },
    { data: f1, delayCs: 10 },
    { data: f2, delayCs: 10 },
    { data: f3, delayCs: 12 },
  ];

  for (const quality of ['fast', 'balanced', 'high']) {
    const gifBytes = await encodeGifFrames(inputFrames, { width: w, height: h, loop: 0, quality });
    const decoded = decodeGif89a(gifBytes);

    assert.equal(decoded.endedCleanly, true);
    assert.equal(decoded.width, w);
    assert.equal(decoded.height, h);
    assert.equal(decoded.loopCount, 0);
    assert.equal(decoded.frames.length, 3);
    assert.equal(decoded.frames[0].delayCs, 10);
    assert.equal(decoded.frames[1].delayCs, 20);
    assert.equal(decoded.frames[2].delayCs, 12);

    // Frame 2 only moved box from x=24..36 to x=40..52, so delta sub-rect stays tighter than full frame
    assert.ok(decoded.frames[2].boxW < w && decoded.frames[2].boxH < h);
    if (quality === 'high') {
      assert.equal(decoded.frames[1].usedLocalPalette, true);
    }

    const expected = [f0, f1, f3];
    for (let i = 0; i < decoded.frames.length; i++) {
      let maxDiff = 0;
      for (let p = 0; p < w * h * 4; p += 4) {
        for (let c = 0; c < 3; c++) {
          maxDiff = Math.max(maxDiff, Math.abs(decoded.frames[i].rgba[p + c] - expected[i][p + c]));
        }
      }
      assert.ok(maxDiff <= 12, `quality=${quality} frame=${i} maxDiff=${maxDiff}`);
    }
  }
});

test('regression: LZW encoder round-trips high-entropy frames across 9->12 bit widths and 4096 clear-code reset', async () => {
  const w = 140;
  const h = 140;
  const rand = mulberry32(20261124);
  const noisyFrames = Array.from({ length: 3 }, () => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.floor(rand() * 256);
      data[i + 1] = Math.floor(rand() * 256);
      data[i + 2] = Math.floor(rand() * 256);
      data[i + 3] = 255;
    }
    return { data, delayCs: 8 };
  });

  const gifBytes = await encodeGifFrames(noisyFrames, {
    width: w,
    height: h,
    loop: 0,
    quality: 'fast',
  });
  const decoded = decodeGif89a(gifBytes);

  assert.equal(decoded.endedCleanly, true);
  assert.equal(decoded.frames.length, 3);

  for (let f = 0; f < 3; f++) {
    let diffSum = 0;
    const totalChannels = w * h * 3;
    for (let p = 0; p < w * h * 4; p += 4) {
      diffSum +=
        Math.abs(decoded.frames[f].rgba[p] - noisyFrames[f].data[p]) +
        Math.abs(decoded.frames[f].rgba[p + 1] - noisyFrames[f].data[p + 1]) +
        Math.abs(decoded.frames[f].rgba[p + 2] - noisyFrames[f].data[p + 2]);
    }
    const meanDiff = diffSum / totalChannels;
    assert.ok(meanDiff < 24, `noisy frame ${f} meanDiff=${meanDiff}`);
  }
});
