// Hands local recordings to the website's editor. The site embeds this page
// as a hidden iframe; it reads the recordings from the extension's own
// storage and posts them to the site as Blobs. The bytes go from one page to
// another inside the browser and are never uploaded.
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
const LIST_REQUEST = "recordful-editor-bridge-list";
const LIST_RESULT = "recordful-editor-bridge-list-result";
const ACK = "recordful-editor-bridge-ack";

const OPFS_RECORDING_PREFIX = "recording-";
const META_SUFFIX = ".meta.json";
// Mirrors the reader: below this the editor cannot open the file.
const MIN_VALID_RECORDING_BYTES = 4096;

const post = (message) => window.parent.postMessage(message, APP_ORIGIN);

// Untrusted from the page: only a plain take file in our own directory.
const validTakeName = (name) =>
  typeof name === "string" &&
  name.startsWith(OPFS_RECORDING_PREFIX) &&
  !name.includes("/") &&
  !name.endsWith(META_SUFFIX) &&
  (name.endsWith(".mp4") || name.endsWith(".webm"));

// Every take still on disk, oldest first. A take only reaches the site's
// history once it has opened there, so everything pending is listed.
const listTakes = async () => {
  const dir = await navigator.storage.getDirectory();
  const takes = [];
  for await (const [name, handle] of dir.entries()) {
    if (!validTakeName(name)) continue;
    try {
      const file = await handle.getFile();
      if (file.size < MIN_VALID_RECORDING_BYTES) continue;
      takes.push({ id: name, size: file.size, lastModified: file.lastModified });
    } catch {}
  }
  takes.sort((a, b) => a.lastModified - b.lastModified);
  return takes;
};

const readTakeMeta = async (fileName) => {
  try {
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle(fileName + META_SUFFIX);
    const parsed = JSON.parse(await (await handle.getFile()).text());
    if (!parsed || typeof parsed !== "object") return null;
    return {
      clicks: Array.isArray(parsed.clicks) ? parsed.clicks : null,
      moves: Array.isArray(parsed.moves) ? parsed.moves : null,
      autoZoom: parsed.autoZoom === true,
    };
  } catch {
    return null;
  }
};

const normalizeClicks = (clickEvents) =>
  (clickEvents || [])
    .filter((click) =>
      [click.timestamp, click.fx, click.fy].every(Number.isFinite),
    )
    .map((click) => ({
      time: click.timestamp,
      x: click.fx,
      y: click.fy,
      // The clicked control: left, top, right, bottom, as fractions too.
      ...(click.box?.every(Number.isFinite) && { box: click.box }),
    }));

const normalizeMoves = (pointerMoves) =>
  (pointerMoves || [])
    .filter((move) => move.every(Number.isFinite))
    .map(([time, x, y]) => ({ time, x, y }));

const readRecording = async (fileName = null) => {
  const stored = await chrome.storage.local.get([
    "lastRecordingBackendRef",
    "clickEvents",
    "autoZoom",
  ]);
  const { lastRecordingBackendRef, clickEvents, autoZoom } = stored;
  const { pointerMoves } = await chrome.storage.session.get("pointerMoves");
  // No name means the site's older single-take request: the latest take.
  const ref = fileName
    ? { backend: "opfs", fileName }
    : lastRecordingBackendRef;
  if (ref?.backend !== "opfs" || !validTakeName(ref.fileName)) {
    if (!fileName) {
      // The IDB path has no take names; serve it exactly as before.
      const reader = chooseReader(lastRecordingBackendRef);
      await reader.open(lastRecordingBackendRef);
      const { blob } = await reader.readBlob();
      return {
        blob,
        id: lastRecordingBackendRef?.fileName ?? null,
        clicks: normalizeClicks(clickEvents),
        moves: normalizeMoves(pointerMoves),
        // On unless switched off in the popup's options.
        autoZoom: autoZoom !== false,
      };
    }
    return {};
  }
  const reader = chooseReader(ref);
  await reader.open(ref);
  const { blob } = await reader.readBlob();
  // A take archived at the next recording's start carries its own trail;
  // the live arrays belong to the latest take, so only it may use them.
  const archived = await readTakeMeta(ref.fileName);
  const isLatest = ref.fileName === lastRecordingBackendRef?.fileName;
  return {
    blob,
    // The file's name is how the site tells one recording from the next.
    id: ref.fileName,
    // Where the pointer clicked, for the editor's zooms: seconds into the
    // recording, and the place as fractions of the picture.
    clicks: normalizeClicks(
      archived?.clicks ?? (isLatest ? clickEvents : []),
    ),
    // The path it took, for the zooms that follow it.
    moves: normalizeMoves(archived?.moves ?? (isLatest ? pointerMoves : [])),
    // On unless switched off in the popup's options.
    autoZoom: archived ? archived.autoZoom : autoZoom !== false,
  };
};

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
    if (event.data?.source !== REQUEST) return;
    // No blob in the answer means there is nothing to hand over.
    const { blob, ...about } = await readRecording(event.data?.id ?? null).catch(
      () => ({}),
    );
    post({ source: RESULT, blob: blob?.size ? blob : null, ...about });
  });
  post({ source: READY });
}
