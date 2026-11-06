import { resolveEditorTabForTarget, sendMessageTab } from "../tabManagement";
import { tryResumePendingUploads } from "./resumePendingUploads";
import { diagEvent, endDiagSession } from "../../utils/diagnosticLog";

const APP_BASE = process.env.RECORDFUL_APP_BASE;

// After a pagehide the page is mid-reload, and a toast sent now dies with the
// old document, so wait for the new one.
const toastTooShort = (tabId, waitForLoad) => {
  const show = () =>
    sendMessageTab(tabId, {
      type: "show-toast",
      message: chrome.i18n.getMessage("recordingTooShortToast"),
      timeout: 5000,
    }).catch(() => {});
  if (!waitForLoad) return show();
  const onUpdated = (id, info) => {
    if (id !== tabId || info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    clearTimeout(timer);
    show();
  };
  const timer = setTimeout(
    () => chrome.tabs.onUpdated.removeListener(onUpdated),
    30000,
  );
  chrome.tabs.onUpdated.addListener(onUpdated);
};

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
  // alarms is an optional permission; undefined until granted, and a throw here
  // would skip the upload resume and the editor below.
  chrome.alarms?.clear("recording-alarm");
  endDiagSession("crashed");

  // Uploads the chunks the dead recorder persisted, from the offscreen doc.
  tryResumePendingUploads({ trigger: `region-recorder-lost:${source}` }).catch(
    () => {},
  );

  // Reloaded before the first chunk was saved: an editor would only show an
  // empty project. No snapshot tracks (older recorder) means we can't tell, so open.
  const tracks = recorderSession?.tracks;
  const nothingCaptured =
    Boolean(tracks) &&
    !["screen", "camera", "audio"].some(
      (t) => Number(tracks[t]?.durableChunkCount) > 0,
    );
  if (nothingCaptured) {
    diagEvent("region-nav-no-chunks", { source });
    if (Number.isInteger(recordingTab)) {
      toastTooShort(recordingTab, source === "pagehide");
    }
    return true;
  }

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
