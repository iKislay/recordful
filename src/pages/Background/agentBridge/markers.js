// Markers an agent drops while recording ("signed in", "error shown"), timed
// on the recording's own clock (pauses left out) so editing can cut or zoom
// at them later. One recording's worth, in storage.session, keyed by its
// start time so a new recording starts a fresh list.
import { AgentBridgeError, AgentErrorCode } from "./errors";

const MARKERS_KEY = "agentBridgeMarkers";
const LABEL_MAX = 200;
const MARKERS_MAX = 500;
const CLOCK_KEYS = ["recording", "recordingStartTime", "paused", "pausedAt", "totalPausedMs"];

// Same formula as the pill's timer (onTabUpdatedListener.js).
export const recordingElapsedMs = (snap, now = Date.now()) => {
  const pausedNow = snap.paused && snap.pausedAt ? Math.max(0, now - snap.pausedAt) : 0;
  return Math.max(0, now - snap.recordingStartTime - (snap.totalPausedMs || 0) - pausedNow);
};

const stored = async () =>
  (await chrome.storage.session.get([MARKERS_KEY]).catch(() => ({})))[MARKERS_KEY] || null;

export const markersFor = async (recordingStartTime) => {
  const list = await stored();
  return list && list.recordingStartTime === recordingStartTime ? list.markers : [];
};

export const addMarker = async ({ label } = {}) => {
  const text = typeof label === "string" ? label.trim() : "";
  if (!text || text.length > LABEL_MAX) {
    throw new AgentBridgeError(
      AgentErrorCode.InvalidParams,
      `label must be 1 to ${LABEL_MAX} characters`,
    );
  }
  const snap = await chrome.storage.local.get(CLOCK_KEYS);
  if (!snap.recording || typeof snap.recordingStartTime !== "number") {
    throw new AgentBridgeError(
      AgentErrorCode.NotRecording,
      "Markers are placed on a running recording; call start_recording first",
    );
  }
  const markers = await markersFor(snap.recordingStartTime);
  if (markers.length >= MARKERS_MAX) {
    throw new AgentBridgeError(
      AgentErrorCode.InvalidParams,
      `A recording holds at most ${MARKERS_MAX} markers`,
    );
  }
  const marker = { atMs: Math.round(recordingElapsedMs(snap)), label: text };
  const next = [...markers, marker];
  await chrome.storage.session.set({
    [MARKERS_KEY]: { recordingStartTime: snap.recordingStartTime, markers: next },
  });
  return { marker, count: next.length };
};
