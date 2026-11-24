const MAX_STTS_SAMPLES = 6000;

function readFourCC(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readUint64(view, offset) {
  const hi = view.getUint32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  return hi * 4294967296 + lo;
}

function iterBoxes(view, start, end, onBox) {
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = view.getUint32(offset, false);
    const type = readFourCC(view, offset + 4);
    let headerSize = 8;
    let boxSize = size32;

    if (size32 === 1) {
      if (offset + 16 > end) {
        onBox({ type, start: offset, headerSize: 16, boxEnd: end, truncated: true });
        break;
      }
      boxSize = readUint64(view, offset + 8);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = end - offset;
    }

    if (!Number.isFinite(boxSize) || boxSize < headerSize) break;
    const rawEnd = offset + boxSize;
    const truncated = rawEnd > end;
    const boxEnd = truncated ? end : rawEnd;

    onBox({ type, start: offset, headerSize, boxEnd, truncated });
    if (truncated || boxEnd <= offset) break;
    offset = boxEnd;
  }
}

function parseTrackBox(view, trakStart, trakEnd) {
  const track = {
    handlerType: '',
    timescale: 0,
    mdhdDuration: 0,
    width: 0,
    height: 0,
    totalSamples: 0,
    totalDtsTicks: 0,
    dtsTicks: [],
    cttsOffsets: [],
  };

  const walkStbl = (stblStart, stblEnd) => {
    iterBoxes(view, stblStart, stblEnd, ({ type, start, headerSize, boxEnd }) => {
      const payload = start + headerSize;
      if (type === 'stts' && payload + 8 <= boxEnd) {
        const entryCount = view.getUint32(payload + 4, false);
        let pos = payload + 8;
        for (let i = 0; i < entryCount && pos + 8 <= boxEnd; i++, pos += 8) {
          const sampleCount = view.getUint32(pos, false);
          const sampleDelta = view.getUint32(pos + 4, false);
          track.totalSamples += sampleCount;
          const remaining = MAX_STTS_SAMPLES - track.dtsTicks.length;
          const expandCount = Math.min(sampleCount, remaining);
          for (let s = 0; s < expandCount; s++) {
            track.dtsTicks.push(track.totalDtsTicks);
            track.totalDtsTicks += sampleDelta;
          }
          if (sampleCount > expandCount) {
            track.totalDtsTicks += (sampleCount - expandCount) * sampleDelta;
          }
        }
      } else if (type === 'ctts' && payload + 8 <= boxEnd) {
        const version = view.getUint8(payload);
        const entryCount = view.getUint32(payload + 4, false);
        let pos = payload + 8;
        for (let i = 0; i < entryCount && pos + 8 <= boxEnd; i++, pos += 8) {
          const sampleCount = view.getUint32(pos, false);
          const sampleOffset =
            version === 0 ? view.getUint32(pos + 4, false) : view.getInt32(pos + 4, false);
          const remaining = MAX_STTS_SAMPLES - track.cttsOffsets.length;
          const expandCount = Math.min(sampleCount, remaining);
          for (let s = 0; s < expandCount; s++) {
            track.cttsOffsets.push(sampleOffset);
          }
          if (track.cttsOffsets.length >= MAX_STTS_SAMPLES) break;
        }
      }
    });
  };

  const walkMinf = (minfStart, minfEnd) => {
    iterBoxes(view, minfStart, minfEnd, ({ type, start, headerSize, boxEnd }) => {
      if (type === 'stbl') walkStbl(start + headerSize, boxEnd);
    });
  };

  const walkMdia = (mdiaStart, mdiaEnd) => {
    iterBoxes(view, mdiaStart, mdiaEnd, ({ type, start, headerSize, boxEnd }) => {
      const payload = start + headerSize;
      if (type === 'mdhd' && payload + 20 <= boxEnd) {
        const version = view.getUint8(payload);
        if (version === 0) {
          track.timescale = view.getUint32(payload + 12, false);
          track.mdhdDuration = view.getUint32(payload + 16, false);
        } else if (version === 1 && payload + 32 <= boxEnd) {
          track.timescale = view.getUint32(payload + 20, false);
          track.mdhdDuration = readUint64(view, payload + 24);
        }
      } else if (type === 'hdlr' && payload + 12 <= boxEnd) {
        track.handlerType = readFourCC(view, payload + 8);
      } else if (type === 'minf') {
        walkMinf(payload, boxEnd);
      }
    });
  };

  iterBoxes(view, trakStart, trakEnd, ({ type, start, headerSize, boxEnd }) => {
    const payload = start + headerSize;
    if (type === 'tkhd' && payload + 84 <= boxEnd) {
      const version = view.getUint8(payload);
      if (version === 0) {
        track.width = view.getUint32(payload + 76, false) / 65536;
        track.height = view.getUint32(payload + 80, false) / 65536;
      } else if (version === 1 && payload + 96 <= boxEnd) {
        track.width = view.getUint32(payload + 88, false) / 65536;
        track.height = view.getUint32(payload + 92, false) / 65536;
      }
    } else if (type === 'mdia') {
      walkMdia(payload, boxEnd);
    }
  });

  return track;
}

/**
 * Inspect ISO-BMFF (MP4) header boxes using zero external dependencies.
 * Gracefully detects truncated `moov` atoms in partial HTTP Range responses.
 */
export function parseMp4Metadata(buffer) {
  const bytes =
    buffer instanceof Uint8Array
      ? buffer
      : ArrayBuffer.isView(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : new Uint8Array(buffer || 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let hasMoov = false;
  let complete = false;
  let hasAudio = false;
  let hasVideo = false;
  let primaryVideo = null;

  iterBoxes(view, 0, bytes.byteLength, ({ type, start, headerSize, boxEnd, truncated }) => {
    if (type !== 'moov') return;
    hasMoov = true;
    complete = !truncated;
    if (!complete) return;

    iterBoxes(view, start + headerSize, boxEnd, (child) => {
      if (child.type !== 'trak' || child.truncated) return;
      const track = parseTrackBox(view, child.start + child.headerSize, child.boxEnd);
      if (track.handlerType === 'soun') {
        hasAudio = true;
      } else if (track.handlerType === 'vide') {
        hasVideo = true;
        if (!primaryVideo || (track.totalSamples > 0 && primaryVideo.totalSamples === 0)) {
          primaryVideo = track;
        }
      }
    });
  });

  if (!primaryVideo) {
    return {
      hasMoov,
      complete,
      hasAudio,
      hasVideo,
      durationSec: 0,
      width: 0,
      height: 0,
      frameCount: 0,
      avgFps: 0,
      frameTimestamps: [],
    };
  }

  const timescale = primaryVideo.timescale || 0;
  let durationSec = 0;
  if (timescale > 0) {
    if (primaryVideo.mdhdDuration > 0) {
      durationSec = primaryVideo.mdhdDuration / timescale;
    } else if (primaryVideo.totalDtsTicks > 0) {
      durationSec = primaryVideo.totalDtsTicks / timescale;
    }
  }

  const frameTimestamps = [];
  if (timescale > 0 && primaryVideo.dtsTicks.length > 0) {
    const ptsTicks = primaryVideo.dtsTicks.map((dts, i) => {
      const offset = i < primaryVideo.cttsOffsets.length ? primaryVideo.cttsOffsets[i] : 0;
      return dts + offset;
    });
    ptsTicks.sort((a, b) => a - b);
    const baseTick = ptsTicks[0];
    for (let i = 0; i < ptsTicks.length; i++) {
      frameTimestamps.push((ptsTicks[i] - baseTick) / timescale);
    }
  }

  const frameCount = primaryVideo.totalSamples || frameTimestamps.length;
  let avgFps = 0;
  if (durationSec > 0 && frameCount > 0) {
    avgFps = frameCount / durationSec;
  } else if (frameTimestamps.length >= 2) {
    const span = frameTimestamps[frameTimestamps.length - 1] - frameTimestamps[0];
    if (span > 0) avgFps = (frameTimestamps.length - 1) / span;
  }

  return {
    hasMoov,
    complete,
    hasAudio,
    hasVideo,
    durationSec,
    width: Math.round(primaryVideo.width),
    height: Math.round(primaryVideo.height),
    frameCount,
    avgFps,
    frameTimestamps,
  };
}

/**
 * Plan deterministic video seek timestamps and GIF centisecond frame delays.
 * Preserves native cadence for low-FPS GIFs and snaps downsampled timestamps to
 * real frame presentation times to eliminate judder.
 */
export function planFrameSchedule(
  mp4Meta,
  fallbackDurationSec,
  { targetFps = 15, maxDurationSec = 15, maxFrames = 240 } = {},
) {
  const safeFps = Math.max(1, Number(targetFps) || 15);
  const safeMaxDuration = Math.max(0.1, Number(maxDurationSec) || 15);
  const safeMaxFrames = Math.max(1, Number(maxFrames) || 240);

  let totalDuration =
    Number.isFinite(fallbackDurationSec) && fallbackDurationSec > 0
      ? fallbackDurationSec
      : mp4Meta?.durationSec || 0;

  const nativePts = Array.isArray(mp4Meta?.frameTimestamps) ? mp4Meta.frameTimestamps : [];
  if (totalDuration <= 0 && nativePts.length >= 2) {
    const stepEst =
      (nativePts[nativePts.length - 1] - nativePts[0]) / Math.max(1, nativePts.length - 1);
    totalDuration = nativePts[nativePts.length - 1] + stepEst;
  }
  if (totalDuration <= 0) totalDuration = 1 / safeFps;

  const effectiveDuration = Math.min(totalDuration, safeMaxDuration);
  const truncated = totalDuration > safeMaxDuration + 0.15;

  let timestamps = [];
  if (nativePts.length >= 2) {
    const filtered = nativePts.filter((t) => t < effectiveDuration - 0.001);
    if (filtered.length === 0) filtered.push(nativePts[0]);

    const nativeFps =
      mp4Meta.avgFps > 0
        ? mp4Meta.avgFps
        : filtered.length / Math.max(0.01, effectiveDuration);

    if (nativeFps <= safeFps * 1.15 && filtered.length <= safeMaxFrames) {
      timestamps = filtered;
    } else {
      const targetStep = 1 / safeFps;
      let cursor = 0;
      let lastPickedIdx = -1;
      for (let k = 0; k < safeMaxFrames; k++) {
        const idealT = k * targetStep;
        if (idealT >= effectiveDuration - 0.001 && k > 0) break;

        while (cursor + 1 < filtered.length && filtered[cursor + 1] <= idealT) {
          cursor++;
        }
        let bestIdx = cursor;
        if (
          cursor + 1 < filtered.length &&
          Math.abs(filtered[cursor + 1] - idealT) < Math.abs(filtered[cursor] - idealT)
        ) {
          bestIdx = cursor + 1;
        }
        if (bestIdx > lastPickedIdx) {
          timestamps.push(filtered[bestIdx]);
          lastPickedIdx = bestIdx;
        }
      }
      if (timestamps.length === 0) {
        timestamps.push(filtered[0]);
      }
    }
  } else {
    const step = 1 / safeFps;
    for (let k = 0; k < safeMaxFrames; k++) {
      const t = k * step;
      if (t >= effectiveDuration - 0.001 && k > 0) break;
      timestamps.push(t);
    }
    if (timestamps.length === 0) timestamps.push(0);
  }

  const diffs = [];
  for (let i = 0; i + 1 < timestamps.length; i++) {
    diffs.push(Math.max(0.02, timestamps[i + 1] - timestamps[i]));
  }
  const sortedDiffs = diffs.slice().sort((a, b) => a - b);
  const medianStep =
    sortedDiffs.length > 0 ? sortedDiffs[Math.floor(sortedDiffs.length / 2)] : 1 / safeFps;

  const delaysCs = new Array(timestamps.length);
  for (let i = 0; i < timestamps.length; i++) {
    let dt;
    if (i + 1 < timestamps.length) {
      dt = timestamps[i + 1] - timestamps[i];
    } else {
      const tail = effectiveDuration - timestamps[i];
      dt = tail >= medianStep * 0.5 && tail <= medianStep * 2 ? tail : medianStep;
    }
    delaysCs[i] = Math.max(2, Math.min(65535, Math.round(dt * 100)));
  }

  return {
    timestamps,
    delaysCs,
    effectiveDuration,
    truncated,
  };
}

/**
 * Classify an X video entry into:
 * - 'native_gif': X's own animated_gif / tweet_video posts
 * - 'gif_like_video': Short silent MP4 clips verified via ISO-BMFF probe
 * - 'video': Regular video with audio or longer duration
 */
export function classifyGifMedia({
  type,
  mp4Url,
  posterUrl,
  hasGifBadge,
  durationMs,
  mp4Probe,
  maxAutoDurationSec = 12,
}) {
  if (
    type === 'animated_gif' ||
    hasGifBadge ||
    (typeof mp4Url === 'string' && /\/tweet_video\//i.test(mp4Url)) ||
    (typeof posterUrl === 'string' && /\/tweet_video_thumb\//i.test(posterUrl))
  ) {
    return 'native_gif';
  }

  if (mp4Probe?.complete && mp4Probe.hasVideo && !mp4Probe.hasAudio) {
    const durationSec =
      mp4Probe.durationSec > 0
        ? mp4Probe.durationSec
        : Number.isFinite(durationMs) && durationMs > 0
          ? durationMs / 1000
          : 0;
    if (durationSec > 0 && durationSec <= maxAutoDurationSec) {
      return 'gif_like_video';
    }
  }

  return 'video';
}
