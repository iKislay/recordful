import { resolveEditorTabForTarget } from "../tabManagement";
import { tryResumePendingUploads } from "./resumePendingUploads";
import { diagEvent, endDiagSession } from "../../utils/diagnosticLog";

const APP_BASE = process.env.RECORDFUL_APP_BASE;

// A custom-area cloud take records in an iframe inside the recorded page, so a
// reload or navigation kills the recorder. Left alone, storage kept saying
// "recording" and every stop or icon click waited on "Preparing..." for a
// recorder that no longer existed. End the take, let the upload resume finish
// what was captured, and open it the way a normal stop does.
export const endLostCloudRegionTake = async (source, hostTabId = null) => {
  const {
    recording,
    customRegion,
    recordingTab,
    recorderSession,
    projectId,
    instantMode,
    multiMode,
    recordingToScene,
  } = await chrome.storage.local.get([
    "recording",
    "customRegion",
    "recordingTab",
    "recorderSession",
    "projectId",
    "instantMode",
    "multiMode",
    "recordingToScene",
  ]);
  if (!recording || !customRegion) return false;
  // Only the page hosting this take's recorder can end it.
  if (hostTabId !== null && hostTabId !== recordingTab) return false;

  diagEvent("crash", { reason: "region-recorder-lost", source });
  await chrome.storage.local.set({
    recording: false,
    pendingRecording: false,
    customRegion: false,
    recordingTab: null,
    recordingUiTabId: null,
    recordingStartTime: 0,
    paused: false,
    recorderSession: recorderSession
      ? { ...recorderSession, status: "crashed", crashedAt: Date.now() }
      : null,
    // pagehide proves the host is gone, so the resume needn't wait out its
    // heartbeat. A missed stop ack doesn't, so those guards stay.
    ...(source === "pagehide"
      ? { cloudRecorderHostBusy: null, recorderPipelineState: null }
      : {}),
  });
  chrome.action.setIcon({ path: "assets/icon-34.png" });
  chrome.alarms.clear("recording-alarm");
  endDiagSession("crashed");

  // Uploads the chunks the dead recorder persisted, from the offscreen doc.
  tryResumePendingUploads({ trigger: `region-recorder-lost:${source}` }).catch(
    () => {},
  );

  // Multi and add-to-scene takes already have their editor; only a new
  // recording needs one opened.
  if (projectId && !multiMode && !recordingToScene) {
    const targetUrl = instantMode
      ? `${APP_BASE}/view/${projectId}?load=true`
      : `${APP_BASE}/editor/${projectId}/edit?load=true`;
    await resolveEditorTabForTarget({
      targetUrl,
      expectedProjectId: projectId,
      expectedKind: instantMode ? "view" : "editor",
      reason: "region-recorder-lost",
    }).catch(() => {});
  }
  return true;
};
