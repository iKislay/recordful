// When the camera preview may show. Kept apart from the window handling so
// the rules can be tested on their own.

// Recorded inside the tab: a window of its own is never in the picture.
const TAB_TYPES = ["tab", "region"];
// The camera is the recording, and its page already shows it.
const CAMERA_TYPES = ["camera", "camera-only"];
// The picture of these is a single window or tab, so the preview's window
// stays out of it. A monitor has every window in it.
const SAFE_SURFACES = ["window", "browser"];

/**
 * Whether this recording's camera is worth a preview: it is on, and it is
 * recorded as a file of its own, so it is not in the screen's picture. A Pro
 * instant recording has no camera file (the cloud recorder skips it), so the
 * preview would show a camera that ends up nowhere.
 */
export const cameraPreviewEligible = (state, { cloudFeatures } = {}) => {
  if (!state) return false;
  if (CAMERA_TYPES.includes(state.recordingType)) return false;
  if (!state.cameraActive) return false;
  if (!state.defaultVideoInput || state.defaultVideoInput === "none") {
    return false;
  }
  const proInstant =
    cloudFeatures &&
    state.isLoggedIn &&
    state.isSubscribed &&
    state.instantMode;
  return !proInstant;
};

/**
 * A screen recording only learns what it captures once the picker is
 * answered, and until then the preview may be in the picture.
 */
export const previewNeedsSurface = (recordingType) =>
  !TAB_TYPES.includes(recordingType);

/** Whether the captured surface leaves the preview's window out. */
export const surfaceAllowsPreview = (surface) =>
  SAFE_SURFACES.includes(surface);
