// How often the pointer's place is noted while it moves, in milliseconds, and
// how many places are sent to the background at once.
const MOVE_SAMPLE_MS = 250;
const MOVES_PER_BATCH = 8;
// What counts as the thing clicked, when the click lands on a part of it.
const CONTROLS =
  "button, a, input, select, textarea, label, summary, [role], [onclick], [tabindex]";

export function startClickTracking(
  isRegion = false,
  regionWidth = 0,
  regionHeight = 0,
  regionX = 0,
  regionY = 0,
  contentStateRef = null // <- optional
) {
  // Refreshed on storage change: a restart can swap recordingType
  // (camera ↔ screen) and we'd otherwise dispatch against the prior mode.
  let cachedSurface = "unknown";
  let cachedRecordingWindowId = null;
  let cachedRecordingType = null;
  chrome.storage.local
    .get(["surface", "recordingWindowId", "recordingType"])
    .then((vals) => {
      cachedSurface = vals.surface || "unknown";
      cachedRecordingWindowId = vals.recordingWindowId ?? null;
      cachedRecordingType = vals.recordingType ?? null;
    })
    .catch(() => {});

  const onStorageChanged = (changes, area) => {
    if (area !== "local") return;
    if (changes.surface) cachedSurface = changes.surface.newValue || "unknown";
    if (changes.recordingWindowId)
      cachedRecordingWindowId = changes.recordingWindowId.newValue ?? null;
    if (changes.recordingType)
      cachedRecordingType = changes.recordingType.newValue ?? null;
  };
  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch {}

  // The pointer's place on what is recorded, as the background expects it;
  // null when it is outside the recorded region.
  const placed = (e) => {
    let x = e.clientX;
    let y = e.clientY;
    if (isRegion) {
      const inRegion =
        x >= regionX &&
        x <= regionX + regionWidth &&
        y >= regionY &&
        y <= regionY + regionHeight;
      if (!inRegion) return null;
      x -= regionX;
      y -= regionY;
    }
    return {
      x,
      y,
      relativeToRegion: isRegion,
      // What x and y are measured against, so the point can be placed on
      // the recording whatever size it is played at.
      width: isRegion ? regionWidth : window.innerWidth,
      height: isRegion ? regionHeight : window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      surface: cachedSurface,
      recordingWindowId: cachedRecordingWindowId,
      region: isRegion,
      isTab: cachedRecordingType === "region",
    };
  };

  const handleClick = (e) => {
    if (contentStateRef?.current?.blurMode) return;

    if (
      e.target.closest(".ToolbarRoot") ||
      e.target.closest(".ToolbarRecordingControls") ||
      e.target.closest(".ToolbarToggleWrap") ||
      e.target.closest(".ToolbarPaused") ||
      e.target.closest(".Toast") ||
      e.target.closest("#recordful-root-container")
    ) {
      return;
    }

    const canvasWrapper = document.getElementById("canvas-wrapper-recordful");
    if (canvasWrapper && canvasWrapper.contains(e.target)) {
      return;
    }

    if (cachedRecordingType === "camera") {
      return;
    }

    const payload = placed(e);
    if (!payload) return;
    // The control that was clicked, not just the point: the editor frames
    // its zoom around this. Measured like x and y; the real target inside a
    // shadow root, and the button rather than the icon inside it.
    const target = e.composedPath()[0];
    const rect = (target.closest?.(CONTROLS) ?? target).getBoundingClientRect?.();
    const box = rect && [
      payload.x - e.clientX + rect.left,
      payload.y - e.clientY + rect.top,
      rect.width,
      rect.height,
    ];
    chrome.runtime.sendMessage({
      type: "click-event",
      payload: { ...payload, box, timestamp: Date.now() },
    });
  };

  // The pointer's path, for zooms that follow it: where it is a few times a
  // second while it moves, sent in batches so the page is barely touched.
  let moved = null;
  let frame = null;
  let moves = [];
  const noteMove = (e) => {
    moved = e;
  };
  const sendMoves = () => {
    if (!moves.length) return;
    chrome.runtime
      .sendMessage({ type: "pointer-moves", payload: { ...frame, moves } })
      .catch(() => {});
    moves = [];
  };
  const sampler = setInterval(() => {
    const payload =
      moved && cachedRecordingType !== "camera" ? placed(moved) : null;
    moved = null;
    // Nothing moved since the last look: what is waiting can go.
    if (!payload) return sendMoves();
    frame = payload;
    moves.push([Date.now(), payload.x, payload.y]);
    if (moves.length >= MOVES_PER_BATCH) sendMoves();
  }, MOVE_SAMPLE_MS);

  window.addEventListener("mousedown", handleClick, true);
  window.addEventListener("mousemove", noteMove, { capture: true, passive: true });
  return () => {
    window.removeEventListener("mousedown", handleClick, true);
    window.removeEventListener("mousemove", noteMove, true);
    clearInterval(sampler);
    sendMoves();
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {}
  };
}
