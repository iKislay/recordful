// Hands local recordings to the website's editor. The site embeds this page
// as a hidden iframe; it reads the recordings from the extension's own
// storage and posts them to the site as Blobs. The bytes go from one page to
// another inside the browser and are never uploaded.
//
// Only the configured app origin is answered, and only as this page's parent.
import { listTakes, readRecording, validTakeName } from "../utils/localTakes";
import { deleteShot, getShot } from "../utils/shotStore";

const APP_ORIGIN = (() => {
  try {
    return new URL(process.env.RECORDFUL_EDITOR_BASE).origin;
  } catch {
    return null;
  }
})();

// The message names are the contract with the site (its extension-bridge).
const READY = "recordful-editor-bridge-ready";
const REQUEST = "recordful-editor-bridge-request";
const RESULT = "recordful-editor-bridge-result";
const LIST_REQUEST = "recordful-editor-bridge-list";
const LIST_RESULT = "recordful-editor-bridge-list-result";
const ACK = "recordful-editor-bridge-ack";
// A screenshot just taken (Background/screenshot), and the site saying it kept it.
const SHOT_REQUEST = "recordful-editor-bridge-shot";
const SHOT_RESULT = "recordful-editor-bridge-shot-result";
const SHOT_ACK = "recordful-editor-bridge-shot-ack";

const post = (message) => window.parent.postMessage(message, APP_ORIGIN);

// The site confirms it kept the take; its bytes may release on the next
// recording's cleanup. Fire-and-forget through the background page, which
// owns the registry.
const ackTake = (fileName) => {
  if (!validTakeName(fileName)) return;
  chrome.runtime
    .sendMessage({ type: "recording-handed", fileName })
    .catch(() => {});
};

if (APP_ORIGIN && window.parent !== window) {
  window.addEventListener("message", async (event) => {
    if (event.origin !== APP_ORIGIN || event.source !== window.parent) return;
    if (event.data?.source === LIST_REQUEST) {
      const takes = await listTakes().catch(() => []);
      post({ source: LIST_RESULT, takes });
      return;
    }
    if (event.data?.source === ACK) {
      ackTake(event.data?.id);
      return;
    }
    if (event.data?.source === SHOT_REQUEST) {
      const shot = await getShot(event.data?.id).catch(() => null);
      post({
        source: SHOT_RESULT,
        blob: shot?.blob?.size ? shot.blob : null,
        title: shot?.title ?? "",
        url: shot?.url ?? "",
        texts: Array.isArray(shot?.texts) ? shot.texts : [],
        takenAt: shot?.takenAt ?? null,
      });
      return;
    }
    if (event.data?.source === SHOT_ACK) {
      void deleteShot(event.data?.id).catch(() => {});
      return;
    }
    if (event.data?.source !== REQUEST) return;
    // No blob in the answer means there is nothing to hand over.
    const { blob, ...about } = await readRecording(event.data?.id ?? null).catch(
      () => ({}),
    );
    post({ source: RESULT, blob: blob?.size ? blob : null, ...about });
  });
  post({ source: READY });
}
