// Shows the camera to the person recording, in a Picture-in-Picture window
// that floats over everything and that they can drag anywhere. The window is
// not part of the page, so a tab or window recording never captures it, and
// the camera reaches the editor only as its own file, free to be laid out.
//
// The window is only a view. The recording never waits for it or hears from
// it, so a preview that fails to open, is closed, or breaks leaves the
// recording exactly as it would have been without one.
//
// Opening needs the click itself: requestWindow() spends the click's user
// activation, so it is only ever called from a click on Recordful's own UI,
// after the click has done everything else it needs, and never from a click
// on the page (it would block the page's popups, copy buttons and the like).
import { useSyncExternalStore } from "react";

import {
  cameraPreviewEligible,
  previewNeedsSurface,
  surfaceAllowsPreview,
} from "./rules";

const CLOUD_FEATURES_ENABLED =
  process.env.RECORDFUL_ENABLE_CLOUD_FEATURES === "true";

const PAGE = "camerapreview.html";
// The contract with the preview page (pages/CameraPreview).
const SOURCE = "recordful-camera-preview";
// Off when the person turns the preview off in the popup's settings.
export const CAMERA_PREVIEW_SETTING = "cameraPreview";
const ACTIVE_KEYS = ["recording", "pendingRecording", "restarting"];
// Starting and restarting pass through moments where no flag is set yet, so
// the recording has to look stopped for this long before the preview closes.
const IDLE_GRACE_MS = 3000;
// Square, as a camera bubble is; Chrome remembers where the person left it
// and how big they made it.
const SIZE = 240;

const log = (...args) => console.warn("[Recordful][camera-preview]", ...args);

let win = null;
// While a window is asked for but not open yet.
let requesting = false;
// What this window may show: { needsSurface, confirmed, requestedAt }.
let session = null;
// Whether the preview is closing because of us, not the person.
let closingOurselves = false;
let enabled = true;
// The surface the recorder last reported, and when that report arrived.
let surface = null;
let surfaceAt = 0;
let recordingNow = false;
let idleTimer = null;
let installed = false;

let snapshot = { open: false, enabled: true, surface: null };
const listeners = new Set();
const emit = () => {
  snapshot = { open: Boolean(win || requesting), enabled, surface };
  listeners.forEach((listener) => listener());
};

export const cameraPreviewSupported = () => {
  try {
    return window.top === window && "documentPictureInPicture" in window;
  } catch {
    return false;
  }
};

export const closeCameraPreview = (reason) => {
  if (!win) return;
  const closing = win;
  win = null;
  session = null;
  closingOurselves = true;
  try {
    closing.close();
  } catch {}
  closingOurselves = false;
  if (reason) log("closed:", reason);
  emit();
};

// Applies a surface the recorder reported after this window was asked for,
// at the start or when the person switches what they share. Anything but a
// single window or tab closes it: a monitor has the preview in its picture,
// and an unknown surface might. Recording before any report closes it too.
const applySurface = () => {
  if (!win || !session?.needsSurface) return;
  if (surfaceAt >= session.requestedAt && surface) {
    if (surfaceAllowsPreview(surface)) {
      session.confirmed = true;
    } else {
      closeCameraPreview("surface " + surface);
      return;
    }
  }
  if (recordingNow && !session.confirmed) {
    closeCameraPreview("surface unknown");
  }
};

const scheduleIdleCheck = () => {
  clearTimeout(idleTimer);
  if (!win && !requesting) return;
  idleTimer = setTimeout(async () => {
    const state = await chrome.storage.local.get(ACTIVE_KEYS).catch(() => null);
    if (state && !state.recording && !state.pendingRecording && !state.restarting) {
      closeCameraPreview("recording ended");
    }
  }, IDLE_GRACE_MS);
};

const onStorageChanged = (changes, area) => {
  if (area !== "local") return;
  if (changes[CAMERA_PREVIEW_SETTING]) {
    enabled = changes[CAMERA_PREVIEW_SETTING].newValue !== false;
    if (!enabled) closeCameraPreview("turned off");
    emit();
  }
  if (changes.capturedSurface) {
    // Each take clears it first, so even a take that captures what the last
    // one did is reported as a change.
    surface = changes.capturedSurface.newValue || null;
    surfaceAt = Date.now();
    applySurface();
    emit();
  }
  if (changes.recording) {
    recordingNow = changes.recording.newValue === true;
    applySurface();
  }
  if (
    changes.cameraActive?.newValue === false ||
    changes.defaultVideoInput?.newValue === "none"
  ) {
    closeCameraPreview("camera off");
  }
  if (ACTIVE_KEYS.some((key) => changes[key])) scheduleIdleCheck();
};

const install = () => {
  if (installed) return;
  installed = true;
  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
    chrome.storage.local
      .get([CAMERA_PREVIEW_SETTING, "capturedSurface", "recording"])
      .then((got) => {
        enabled = got[CAMERA_PREVIEW_SETTING] !== false;
        recordingNow = got.recording === true;
        // Read once at load, so the toolbar can bring the preview back after a
        // navigation. Recorders clear it as each take starts, so during a
        // recording it is that take's; a new window still waits for a report.
        if (!surface) surface = got.capturedSurface || null;
        emit();
      })
      .catch(() => {});
  } catch {}
};
install();

const mount = (pip) => {
  requesting = false;
  win = pip;
  const doc = pip.document;
  doc.title = "Recordful";
  doc.body.style.cssText = "margin:0;overflow:hidden;background:#111;";
  const frame = doc.createElement("iframe");
  frame.src = chrome.runtime.getURL(PAGE);
  frame.allow = "camera";
  frame.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;border:0;display:block;";
  doc.body.append(frame);

  pip.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    if (event.data?.source !== SOURCE) return;
    if (event.data.type === "error") {
      closeCameraPreview("camera " + (event.data.name || "error"));
    } else if (event.data.type === "idle") {
      closeCameraPreview("recording ended");
    }
  });
  // Closed by the person, or with this page as it navigates away.
  pip.addEventListener("pagehide", () => {
    if (win !== pip) return;
    win = null;
    session = null;
    if (!closingOurselves) log("closed by the window");
    emit();
  });

  applySurface();
  scheduleIdleCheck();
  emit();
};

/**
 * Opens the preview for the recording `state` describes, when it may show.
 * Call it from a click on Recordful's own UI, synchronously, after the click
 * has done everything else that needs the user's activation. `reopen` is a
 * preview asked for during a recording, which can only show once the
 * recording is known to leave it out of the picture.
 */
export const openCameraPreview = (state, { reopen = false } = {}) => {
  try {
    if (win || requesting || !enabled || !cameraPreviewSupported()) {
      return false;
    }
    if (!cameraPreviewEligible(state, { cloudFeatures: CLOUD_FEATURES_ENABLED })) {
      return false;
    }
    const needsSurface = previewNeedsSurface(state.recordingType);
    if (reopen && needsSurface && !surfaceAllowsPreview(surface)) return false;
    // Without activation the call throws; checking first never spends it.
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      return false;
    }
    const requestedAt = Date.now();
    session = {
      needsSurface,
      // A reopen is only allowed once the surface is known to be safe.
      confirmed: !needsSurface || reopen,
      requestedAt,
    };
    requesting = true;
    emit();
    window.documentPictureInPicture
      .requestWindow({
        width: SIZE,
        height: SIZE,
        // "Back to tab" would only close the preview by another name.
        disallowReturnToOpener: true,
      })
      .then(mount)
      .catch((err) => {
        requesting = false;
        session = null;
        log("did not open:", err?.name || err);
        emit();
      });
    return true;
  } catch (err) {
    requesting = false;
    session = null;
    log("did not open:", err?.name || err);
    emit();
    return false;
  }
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** { open, enabled, surface } for the toolbar and the settings menu. */
export const useCameraPreview = () =>
  useSyncExternalStore(subscribe, () => snapshot);

/** Saves the setting; turning it off closes an open preview. */
export const setCameraPreviewEnabled = (next) => {
  enabled = next;
  if (!next) closeCameraPreview("turned off");
  emit();
  chrome.storage.local.set({ [CAMERA_PREVIEW_SETTING]: next }).catch(() => {});
};
