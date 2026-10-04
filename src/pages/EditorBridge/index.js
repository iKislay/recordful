// Hands the latest local recording to the website's editor. The site embeds
// this page as a hidden iframe; it reads the recording from the extension's
// own storage and posts it to the site as a Blob. The bytes go from one page
// to another inside the browser and are never uploaded.
//
// Only the configured app origin is answered, and only as this page's parent.
import { chooseReader } from "../EditorApp/recorderStorage/chooseReader";

const APP_ORIGIN = (() => {
  try {
    return new URL(process.env.RECORDFUL_APP_BASE).origin;
  } catch {
    return null;
  }
})();

// The message names are the contract with the site (its extension-bridge).
const READY = "recordful-editor-bridge-ready";
const REQUEST = "recordful-editor-bridge-request";
const RESULT = "recordful-editor-bridge-result";

const post = (message) => window.parent.postMessage(message, APP_ORIGIN);

const readLatestRecording = async () => {
  const { lastRecordingBackendRef, clickEvents, autoZoom } =
    await chrome.storage.local.get([
      "lastRecordingBackendRef",
      "clickEvents",
      "autoZoom",
    ]);
  const { pointerMoves } = await chrome.storage.session.get("pointerMoves");
  const reader = chooseReader(lastRecordingBackendRef);
  await reader.open(lastRecordingBackendRef);
  const { blob } = await reader.readBlob();
  // The file's name is how the site tells one recording from the next.
  return {
    blob,
    id: lastRecordingBackendRef?.fileName ?? null,
    // Where the pointer clicked, for the editor's zooms: seconds into the
    // recording, and the place as fractions of the picture.
    clicks: (clickEvents || [])
      .filter((click) =>
        [click.timestamp, click.fx, click.fy].every(Number.isFinite),
      )
      .map((click) => ({ time: click.timestamp, x: click.fx, y: click.fy })),
    // The path it took, for the zooms that follow it.
    moves: (pointerMoves || [])
      .filter((move) => move.every(Number.isFinite))
      .map(([time, x, y]) => ({ time, x, y })),
    // On unless switched off in the popup's options.
    autoZoom: autoZoom !== false,
  };
};

if (APP_ORIGIN && window.parent !== window) {
  window.addEventListener("message", async (event) => {
    if (event.origin !== APP_ORIGIN || event.source !== window.parent) return;
    if (event.data?.source !== REQUEST) return;
    // No blob in the answer means there is nothing to hand over.
    const { blob, ...about } = await readLatestRecording().catch(() => ({}));
    post({ source: RESULT, blob: blob?.size ? blob : null, ...about });
  });
  post({ source: READY });
}
