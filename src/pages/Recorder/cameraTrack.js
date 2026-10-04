// Records the camera to a file of its own beside a screen recording, so the
// web editor can move, reshape or hide it instead of finding it baked into
// the screen's picture. The file is <take>.camera in the extension's private
// file system: kept and swept with its take, and handed over by the bridge.

import { getUserMediaWithFallback } from "../utils/mediaDeviceFallback";

export const CAMERA_SUFFIX = ".camera";
// Where each take's camera file starts, in seconds after the screen's.
export const CAMERA_OFFSETS = "cameraOffsets";
// Offsets are kept for this many takes; older ones are long gone.
const OFFSETS_KEPT = 20;

/**
 * Starts recording the camera for the take in `takeFileName`. Resolves to
 * null when there is no camera to record: it is off, or it is the take.
 */
export async function startCameraTrack(takeFileName) {
  const {
    cameraActive,
    defaultVideoInput,
    defaultVideoInputLabel,
    recordingType,
  } = await chrome.storage.local.get([
    "cameraActive",
    "defaultVideoInput",
    "defaultVideoInputLabel",
    "recordingType",
  ]);
  if (
    !cameraActive ||
    !defaultVideoInput ||
    defaultVideoInput === "none" ||
    recordingType === "camera"
  ) {
    return null;
  }
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  // A saved device id goes stale (Brave hands out new ones), so the camera
  // is found again by its label, as the camera page does; and when even
  // that fails, whichever camera there is beats recording none.
  const stream = await getUserMediaWithFallback({
    constraints: { video: { deviceId: { exact: defaultVideoInput }, ...size } },
    fallbacks: [
      {
        kind: "videoinput",
        desiredDeviceId: defaultVideoInput,
        desiredLabel: defaultVideoInputLabel,
      },
    ],
  }).catch(() => navigator.mediaDevices.getUserMedia({ video: size }));
  const dir = await navigator.storage.getDirectory();
  const handle = await dir.getFileHandle(takeFileName + CAMERA_SUFFIX, {
    create: true,
  });
  // ponytail: the file only exists once it is closed, so a recorder tab that
  // crashes loses the camera (never the screen). Write through the OPFS
  // worker like the screen's chunks if that ever matters.
  const file = await handle.createWritable();
  // VP8: cheap enough to encode in software next to the screen's encoder.
  const mimeType = ["video/webm;codecs=vp8", "video/webm"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
  });
  let startedAt = null;
  let writing = Promise.resolve();
  recorder.onstart = () => {
    startedAt = Date.now();
  };
  recorder.ondataavailable = (event) => {
    if (!event.data.size) return;
    writing = writing.then(() => file.write(event.data)).catch(() => {});
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
    recorder.onerror = resolve;
  });
  recorder.start(5000);

  return {
    pause: () => recorder.state === "recording" && recorder.pause(),
    resume: () => recorder.state === "paused" && recorder.resume(),
    /** `screenStartedAt` is when the screen's recorder started, in ms. */
    async stop(screenStartedAt) {
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      await writing;
      await file.close().catch(() => {});
      stream.getTracks().forEach((track) => track.stop());
      if (startedAt === null || !screenStartedAt) return;
      const got = await chrome.storage.local.get([CAMERA_OFFSETS]);
      const offsets = Object.entries(got[CAMERA_OFFSETS] || {}).slice(
        1 - OFFSETS_KEPT,
      );
      offsets.push([takeFileName, (startedAt - screenStartedAt) / 1000]);
      await chrome.storage.local.set({
        [CAMERA_OFFSETS]: Object.fromEntries(offsets),
      });
    },
  };
}
