// Pure rules for the teleprompter: scroll speed, saved settings, and which
// captures can safely show the floating script window.

export const FONT_SIZE_MIN = 20;
export const FONT_SIZE_MAX = 72;
export const FONT_STEP = 4;
export const WPM_MIN = 80;
export const WPM_MAX = 240;
export const WPM_STEP = 10;

export const DEFAULT_SETTINGS = {
  script: "",
  fontSize: 28,
  wpm: 120,
  autoScroll: true,
};

const LINE_HEIGHT = 1.5;
// Average word plus space in characters, and glyph width as a fraction of font
// size. Rough on purpose: scroll speed only has to feel like the chosen pace.
const CHARS_PER_WORD = 6;
const GLYPH_WIDTH = 0.5;

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// px/s that scroll `wpm` words a minute in a `width` px block at `fontSize` px.
export const wpmToPxPerSecond = (wpm, fontSize, width) => {
  const safeWidth = Math.max(1, width || 0);
  const charsPerLine = Math.max(1, safeWidth / (fontSize * GLYPH_WIDTH));
  const wordsPerLine = Math.max(1, charsPerLine / CHARS_PER_WORD);
  const linesPerSecond = wpm / 60 / wordsPerLine;
  return linesPerSecond * fontSize * LINE_HEIGHT;
};

// Storage may hold missing, partial, older-build or hand-edited values; this
// always returns a complete, in-range object.
export const normalizeSettings = (raw) => {
  const saved = raw && typeof raw === "object" ? raw : {};
  return {
    script: typeof saved.script === "string" ? saved.script : "",
    fontSize: clamp(
      Number(saved.fontSize) || DEFAULT_SETTINGS.fontSize,
      FONT_SIZE_MIN,
      FONT_SIZE_MAX,
    ),
    wpm: clamp(Number(saved.wpm) || DEFAULT_SETTINGS.wpm, WPM_MIN, WPM_MAX),
    autoScroll: saved.autoScroll !== false,
  };
};

// Whether the floating window can end up in the recording.
//  - "ok": tab, region and camera captures never include another window, and a
//    shared window or browser tab excludes it.
//  - "pending": screen recording, surface not picked yet.
//  - "unsafe": whole monitor (includes every window), or an unidentified surface.
// `surface` is displaySurface from the recorder ("default" until it reports).
export const prompterCaptureStatus = ({ recordingType, surface }) => {
  if (recordingType && recordingType !== "screen") return "ok";
  if (surface === "window" || surface === "browser") return "ok";
  if (surface === "monitor") return "unsafe";
  return "pending";
};

export const shouldClosePrompter = ({ recordingType, surface, recording }) => {
  const status = prompterCaptureStatus({ recordingType, surface });
  if (status === "unsafe") return true;
  return status === "pending" && Boolean(recording);
};

export const formatClock = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};
