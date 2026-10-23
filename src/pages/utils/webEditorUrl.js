// The site's editor (RECORDFUL_EDITOR_BASE, else https://recordful.app; see
// webpack.config.js), opened on a take this extension holds. The site fetches
// it through editorbridge.html, inside the browser.
//
// `ext` names this build: the site only knows the store build's ID, and an
// unpacked or self-hosted one has its own. `take` names the recording's file,
// or "latest" for one that has no file name (the IndexedDB fallback); the
// site keeps asking for it until it has it.
export const webEditorUrl = (take = null) => {
  const url = new URL("/editor", process.env.RECORDFUL_EDITOR_BASE);
  url.searchParams.set("ext", chrome.runtime.id);
  url.searchParams.set("take", take || "latest");
  return url.href;
};

// The take the extension recorded last: its file name, or null when it lives
// in IndexedDB.
export const latestTakeName = async () => {
  try {
    const { lastRecordingBackendRef: ref } = await chrome.storage.local.get([
      "lastRecordingBackendRef",
    ]);
    return ref?.backend === "opfs" && typeof ref.fileName === "string"
      ? ref.fileName
      : null;
  } catch {
    return null;
  }
};
