import { sendMessageTab } from "../tabManagement";
import { loginWithWebsite } from "../auth/loginWithWebsite";

export const setSurface = async (request) => {
  await chrome.storage.local.set({ surface: request.surface });

  // A throw here took the whole message down, leaving the camera bubble up over
  // the recording. Logout is exactly when it fails, so fall back to the cache.
  let result = null;
  try {
    result = await loginWithWebsite({ force: true });
  } catch (err) {
    console.warn("[Recordful][BG] setSurface auth refresh failed:", err);
  }
  const { activeTab, isSubscribed, instantMode, recordingType } =
    await chrome.storage.local.get([
      "activeTab",
      "isSubscribed",
      "instantMode",
      "recordingType",
    ]);

  sendMessageTab(activeTab, {
    type: "set-surface",
    surface: request.surface,
    // A region/tab capture still reports displaySurface "monitor". Without this
    // the camera treats it as a full-screen recording and opens PiP.
    recordingType: recordingType || null,
    subscribed: result ? Boolean(result.subscribed) : Boolean(isSubscribed),
    instantMode: result ? Boolean(result.instantMode) : Boolean(instantMode),
  });
};
