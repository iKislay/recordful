import { addUserMarker } from "../agentBridge/markers";
import { sendMessageTab } from "../tabManagement";

// Drops a marker at the recording's current time (pauses left out) and says
// so on the recording's toolbar. Nothing to mark without a recording.
export const dropUserMarker = async () => {
  try {
    await addUserMarker();
  } catch {
    return;
  }
  const { recordingUiTabId } = await chrome.storage.local.get(["recordingUiTabId"]);
  if (!recordingUiTabId) return;
  await sendMessageTab(recordingUiTabId, {
    type: "show-toast",
    message: chrome.i18n.getMessage("markerAddedToast"),
    timeout: 2000,
  }).catch(() => {});
};
