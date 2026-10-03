// Pair video + audio codec explicitly (w3c/mediacapture-record#194); Chrome
// mis-tags blob.type otherwise. MP4 (H.264+AAC) first since VFR VP9/WebM breaks
// downstream (transcoders drop frames, node-av SIGSEGVs); isTypeSupported gates it.
export const MIME_TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=h264,opus",
  "video/webm;codecs=avc1,opus",
  "video/webm",
  "video/mp4",
];

export function getBitrates(quality) {
  switch (quality) {
    case "4k":
      return { audio: 192000, video: 20000000 };
    case "1080p":
      return { audio: 128000, video: 12000000 };
    case "720p":
      return { audio: 128000, video: 5000000 };
    case "480p":
      return { audio: 96000, video: 3000000 };
    case "360p":
      return { audio: 96000, video: 1500000 };
    case "240p":
      return { audio: 64000, video: 1000000 };
    default:
      return { audio: 128000, video: 12000000 };
  }
}
export const VIDEO_QUALITIES = {
  "4k": { width: 4096, height: 2160 },
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  "480p": { width: 854, height: 480 },
  "360p": { width: 640, height: 360 },
  "240p": { width: 426, height: 240 },
  default: { width: 1920, height: 1080 },
};

export function getResolutionForQuality(qualityValue = "default") {
  return VIDEO_QUALITIES[qualityValue] || VIDEO_QUALITIES.default;
}

// bits/pixel/sec. 0.10 put 1080p30 at 6.2 Mbps, under the 0.15-0.25 screen
// content wants, and text edges are the first thing H.264 discards.
export const VIDEO_BPP_FPS_PRO = 0.15;
export const VIDEO_BPP_FPS_FREE = 0.08;
export const VIDEO_BPS_MIN = 4_000_000;
export const VIDEO_BPS_MAX = 24_000_000;

export function computeTargetVideoBps(width, height, fps, isPro = false) {
  const pixels = Number(width) * Number(height);
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const factor = isPro ? VIDEO_BPP_FPS_PRO : VIDEO_BPP_FPS_FREE;
  const target = Math.round(pixels * rate * factor);
  return Math.max(VIDEO_BPS_MIN, Math.min(VIDEO_BPS_MAX, target));
}

export async function getFreeCaptureCaps() {
  try {
    const { isLoggedIn, isSubscribed } = await chrome.storage.local.get([
      "isLoggedIn",
      "isSubscribed",
    ]);
    return {
      isPro: Boolean(isLoggedIn && isSubscribed),
      maxQuality: "1080p",
      maxFps: 60,
    };
  } catch {
    return { isPro: false, maxQuality: "1080p", maxFps: 60 };
  }
}

// Every encode cap we ship is landscape, so a portrait source binds on HEIGHT
// and collapses the width (412x924 encoded to 482x1080). Orient the box to the
// source first so a cap means pixels on the long edge, not a shape.
export function orientBoxToSource(sourceWidth, sourceHeight, boxWidth, boxHeight) {
  const sw = Number(sourceWidth);
  const sh = Number(sourceHeight);
  const bw = Number(boxWidth);
  const bh = Number(boxHeight);
  if (![sw, sh, bw, bh].every((n) => Number.isFinite(n) && n > 0)) {
    return { width: boxWidth, height: boxHeight };
  }
  return sh > sw === bh > bw
    ? { width: bw, height: bh }
    : { width: bh, height: bw };
}
