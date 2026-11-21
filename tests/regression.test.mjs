import assert from 'node:assert/strict';
import test from 'node:test';

import { getThresholds } from '../src/config.js';
import { detectBorderArtifactDepth, detectSplitArtwork } from '../src/detector.js';
import { getRegisteredTweetMedia, ingestGraphqlObject } from '../src/interceptor.js';
import { computeLayoutPlan } from '../src/stitcher.js';

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
