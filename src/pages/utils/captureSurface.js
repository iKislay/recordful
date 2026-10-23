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

// null means unknown, and the key is left cleared so the scene payload
// omits surface rather than guessing.
export const setCapturedSurface = async (surface) => {
  try {
    if (surface) {
      await chrome.storage.local.set({ capturedSurface: surface });
    } else {
      // A new take: whether its cursor is left out is not known yet either.
      await chrome.storage.local.remove(["capturedSurface", "capturedCursor"]);
    }
  } catch {}
};

// Chrome draws the real pointer into a captured window or screen (a tab it
// leaves it out of, and says so), and the editor draws its own cursor from
// the pointer's path on top: two cursors. Where Chrome offers to leave the
// real one out (the track's `cursor` constraint), it is asked to, and what
// the track then reports is kept as capturedCursor ("hidden" or "shown") so
// the editor shows only one.
// A whole screen keeps its cursor: the pointer is only followed over pages
// in Chrome, so a drawn one would vanish over every other app.
export const leaveCursorOut = async (track, surface) => {
  let outcome = "shown";
  try {
    const settings = track?.getSettings?.() || {};
    if (settings.cursor === "never") {
      outcome = "hidden";
    } else if (surface !== "monitor") {
      const offered = track.getCapabilities?.().cursor;
      if (Array.isArray(offered) && offered.includes("never")) {
        // applyConstraints replaces every constraint, so the ones the track
        // was opened with go back in; a legacy desktop or tab track has none
        // in the modern shape, so it keeps the size and rate it has.
        const kept = track.getConstraints?.() || {};
        const modern =
          Object.keys(kept).length > 0 && !kept.mandatory && !kept.optional;
        await track.applyConstraints({
          ...(modern
            ? kept
            : {
                ...(settings.width && { width: { ideal: settings.width } }),
                ...(settings.height && { height: { ideal: settings.height } }),
                ...(settings.frameRate && {
                  frameRate: { ideal: settings.frameRate },
                }),
              }),
          cursor: "never",
        });
        if (track.getSettings().cursor === "never") outcome = "hidden";
      }
    }
  } catch {}
  try {
    await chrome.storage.local.set({ capturedCursor: outcome });
  } catch {}
  return outcome;
};
