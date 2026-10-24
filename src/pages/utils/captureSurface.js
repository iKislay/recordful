// What kind of surface a recording actually captured, in the shape the
// app expects (monitor, browser, window). Anything else maps to window.
export const normalizeCaptureSurface = (displaySurface) => {
  if (typeof displaySurface !== "string" || !displaySurface) return null;
  if (displaySurface === "monitor" || displaySurface === "browser") {
    return displaySurface;
  }
  return "window";
};

// Chrome only fills displaySurface on getDisplayMedia streams. A
// tabCapture stream has none but is a tab either way.
export const resolveCaptureSurface = (displaySurface, { isTab } = {}) => {
  const normalized = normalizeCaptureSurface(displaySurface);
  if (normalized) return normalized;
  return isTab ? "browser" : null;
};

// Whether the real pointer is in the picture, kept as capturedCursor so the
// editor can paint it out under the cursor it draws. Chrome draws the system
// pointer into every window and screen capture, whatever the track says
// (Chrome 155 reports `cursor: "never"` for a whole screen and draws it
// anyway, and honours no `cursor` constraint), and never into a tab's.
const cursorOfSurface = (surface) =>
  surface === "browser" ? "hidden" : "shown";

// null means unknown, and the keys are left cleared so the scene payload
// omits surface rather than guessing.
export const setCapturedSurface = async (surface) => {
  try {
    if (surface) {
      await chrome.storage.local.set({
        capturedSurface: surface,
        capturedCursor: cursorOfSurface(surface),
      });
    } else {
      await chrome.storage.local.remove(["capturedSurface", "capturedCursor"]);
    }
  } catch {}
};
