// Salvage-download bytes can be WebM even on the mp4 branch: the encoder probe
// falls back to VP9/Opus without a viable H.264/AAC config. Chrome and VLC
// sniff a mislabelled file, QuickTime and Windows Media Player refuse it.

export const MP4_CONTAINER = { mime: "video/mp4", ext: "mp4" };
export const WEBM_CONTAINER = { mime: "video/webm", ext: "webm" };

// MediaRecorder blob types carry a codecs suffix (video/webm;codecs=vp9,opus).
export const containerFromMime = (mime, fallback) => {
  const base = String(mime || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (base === "video/mp4") return MP4_CONTAINER;
  if (base === "video/webm") return WEBM_CONTAINER;
  return fallback;
};

// The OPFS writer names the file with the extension it actually wrote.
export const containerFromFileName = (name, fallback) => {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".webm")) return WEBM_CONTAINER;
  if (lower.endsWith(".mp4")) return MP4_CONTAINER;
  return fallback;
};
