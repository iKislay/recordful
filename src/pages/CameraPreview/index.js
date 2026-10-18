// The camera, shown to the person recording in a Picture-in-Picture window of
// its own. The content script opens the window and puts this page in it; the
// page only shows the camera. It records nothing: the recorder keeps its own
// camera file, so whatever happens here never touches the recording.
import { getUserMediaWithFallback } from "../utils/mediaDeviceFallback";

// The contract with the content script (Content/camera-preview).
const SOURCE = "recordful-camera-preview";
// How long the recording may look stopped before the page lets the camera go
// on its own, in case the window outlives whoever should close it.
const IDLE_GRACE_MS = 5000;

const video = document.querySelector("video");
const pausedLabel = document.querySelector(".paused");
pausedLabel.textContent =
  chrome.i18n.getMessage("cameraPreviewPausedLabel") || "Paused";

let stream = null;
let idleTimer = null;

const tell = (type, extra = {}) => {
  try {
    window.parent.postMessage({ source: SOURCE, type, ...extra }, "*");
  } catch {}
};

const release = () => {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
};

const start = async () => {
  const { defaultVideoInput, defaultVideoInputLabel } =
    await chrome.storage.local.get([
      "defaultVideoInput",
      "defaultVideoInputLabel",
    ]);
  // No size asked for, as the camera page asks: Chrome shares the camera
  // between everyone using it, and a different ask could change the size
  // the recorder gets. The saved id goes stale on some browsers, so the
  // camera is found again by its label; the saved settings are left alone.
  const next = await getUserMediaWithFallback({
    constraints: { video: { deviceId: { exact: defaultVideoInput } } },
    fallbacks: defaultVideoInputLabel
      ? [
          {
            kind: "videoinput",
            desiredDeviceId: defaultVideoInput,
            desiredLabel: defaultVideoInputLabel,
          },
        ]
      : [],
  });
  stream = next;
  next.getVideoTracks()[0]?.addEventListener("ended", () => {
    release();
    tell("error", { name: "ended" });
  });
  video.srcObject = next;
  await video.play().catch(() => {});
  tell("ready");
};

const showPaused = (paused) =>
  document.body.classList.toggle("is-paused", Boolean(paused));

const checkIdle = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const state = await chrome.storage.local
      .get(["recording", "pendingRecording", "restarting"])
      .catch(() => null);
    if (state && !state.recording && !state.pendingRecording && !state.restarting) {
      release();
      tell("idle");
    }
  }, IDLE_GRACE_MS);
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.paused) showPaused(changes.paused.newValue);
  if (changes.recording || changes.pendingRecording || changes.restarting) {
    checkIdle();
  }
});

// The window closing, by the person or with the page that opened it, ends
// this page too; the camera's light must go off with it.
window.addEventListener("pagehide", release);

chrome.storage.local
  .get(["paused"])
  .then(({ paused }) => showPaused(paused))
  .catch(() => {});
checkIdle();
start().catch((err) => {
  release();
  tell("error", { name: err?.name || "error" });
});
