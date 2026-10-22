// How often the pointer's place is noted while it moves, in milliseconds, and
// how many places are sent to the background at once.
const MOVE_SAMPLE_MS = 250;
const MOVES_PER_BATCH = 8;
// What counts as the thing clicked, when the click lands on a part of it.
const CONTROLS =
  "button, a, input, select, textarea, label, summary, [role], [onclick], [tabindex]";
// Fields the browser's own "auto" cursor shows an I-beam over.
const TYPED =
  "textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=tel], input[type=password], input[type=number]";
// The cursor the page showed, as the editor numbers it in a move: none is
// the arrow, so a move over nothing special stays three numbers long.
export const CURSOR_CODES = { hand: 1, text: 2 };

/**
 * The cursor the page shows over `target` at `e`'s point, as the editor
 * draws it: a hand over links and buttons, an I-beam over text, else the
 * arrow.
 */
function cursorKind(target, e) {
  if (!(target instanceof Element)) return "arrow";
  const { cursor } = getComputedStyle(target);
  if (cursor === "pointer") return "hand";
  if (cursor === "text" || cursor === "vertical-text") return "text";
  if (cursor !== "auto") return "arrow";
  // "auto" is the browser's pick: an I-beam where text can be typed, or
  // over the letters of text that can be selected.
  if (target.isContentEditable || target.closest(TYPED)) return "text";
  const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
  const node = range?.startContainer;
  if (node?.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) {
    return "arrow";
  }
  if (getComputedStyle(node.parentElement).userSelect === "none") {
    return "arrow";
  }
  const letters = document.createRange();
  letters.selectNodeContents(node);
  for (const rect of letters.getClientRects()) {
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      return "text";
    }
  }
  return "arrow";
}

/** The cursor's kind, or the arrow if the page cannot be asked. */
const safeKind = (target, e) => {
  try {
    return cursorKind(target, e);
  } catch {
    return "arrow";
  }
};

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
      // Where the page's top-left is on the screen, for a recording of the
      // whole screen. Told by the event itself: the window's own bounds
      // count borders Windows draws invisibly, a few pixels off the page.
      screenLeft: e.screenX - e.clientX,
      screenTop: e.screenY - e.clientY,
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
    const kind = safeKind(target, e);
    chrome.runtime.sendMessage({
      type: "click-event",
      payload: {
        ...payload,
        box,
        timestamp: Date.now(),
        // The cursor the page showed: the editor draws the same one.
        ...(kind !== "arrow" && { kind }),
      },
    });
  };

  // The pointer's path, for zooms that follow it: where it is a few times a
  // second while it moves, sent in batches so the page is barely touched.
  let moved = null;
  // What the pointer was over: an event's path is gone once it is handled,
  // and inside a shadow root its target is only the host.
  let movedOver = null;
  let frame = null;
  let moves = [];
  const noteMove = (e) => {
    moved = e;
    movedOver = e.composedPath()[0] ?? e.target;
  };
  const sendMoves = () => {
    if (!moves.length) return;
    chrome.runtime
      .sendMessage({ type: "pointer-moves", payload: { ...frame, moves } })
      .catch(() => {});
    moves = [];
  };
  const sampler = setInterval(() => {
    const event = moved;
    const payload =
      event && cachedRecordingType !== "camera" ? placed(event) : null;
    moved = null;
    // Nothing moved since the last look: what is waiting can go.
    if (!payload) return sendMoves();
    frame = payload;
    // With the cursor the page showed there, where it was not the arrow.
    const code = CURSOR_CODES[safeKind(movedOver, event)];
    moves.push(
      code
        ? [Date.now(), payload.x, payload.y, code]
        : [Date.now(), payload.x, payload.y],
    );
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
