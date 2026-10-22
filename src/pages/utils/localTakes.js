// Local recordings ("takes") in the extension's own storage: listing them and
// reading one back with its camera file and pointer trail. Shared by the
// editor bridge (hands takes to the website's editor) and the AI agents bridge
// (uploads them for an agent). Works in pages and in the service worker.
import { chooseReader } from "../EditorApp/recorderStorage/chooseReader";
import { CAMERA_OFFSETS, CAMERA_SUFFIX } from "../Recorder/cameraTrack";

const OPFS_RECORDING_PREFIX = "recording-";
const META_SUFFIX = ".meta.json";
// Mirrors the reader: below this the editor cannot open the file.
const MIN_VALID_RECORDING_BYTES = 4096;

// Untrusted from the page: only a plain take file in our own directory.
export const validTakeName = (name) =>
  typeof name === "string" &&
  name.startsWith(OPFS_RECORDING_PREFIX) &&
  !name.includes("/") &&
  !name.endsWith(META_SUFFIX) &&
  (name.endsWith(".mp4") || name.endsWith(".webm"));

// Every take still on disk, oldest first. A take only reaches the site's
// history once it has opened there, so everything pending is listed.
export const listTakes = async () => {
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

// The take's camera, when it was recorded as a file of its own, and how
// many seconds after the screen's file it starts.
const readCamera = async (fileName) => {
  try {
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle(fileName + CAMERA_SUFFIX);
    const file = await handle.getFile();
    if (file.size < MIN_VALID_RECORDING_BYTES) return {};
    const got = await chrome.storage.local.get([CAMERA_OFFSETS]);
    const offset = got?.[CAMERA_OFFSETS]?.[fileName];
    return {
      camera: file.slice(0, file.size, "video/webm"),
      cameraOffset: Number.isFinite(offset) ? offset : 0,
    };
  } catch {
    return {};
  }
};

// The cursor the page showed, as a move numbers it and as the site names it.
const CURSOR_KINDS = { 1: "hand", 2: "text" };

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
      ...((click.kind === "hand" || click.kind === "text") && {
        kind: click.kind,
      }),
    }));

const normalizeMoves = (pointerMoves) =>
  (pointerMoves || [])
    .filter((move) => move.every(Number.isFinite))
    .map(([time, x, y, cursor]) => ({
      time,
      x,
      y,
      ...(CURSOR_KINDS[cursor] && { kind: CURSOR_KINDS[cursor] }),
    }));

export const readRecording = async (fileName = null) => {
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
    ...(await readCamera(ref.fileName)),
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
