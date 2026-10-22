// What an agent can do with recordings once they exist: upload a local one,
// follow a video's upload, list videos, and read a transcript back. Cloud
// (Pro) recordings upload while they record; local ones upload on request.
import { listTakes, readRecording } from "../../utils/localTakes";
import {
  accountStatus,
  api,
  cloudAvailable,
  notSignedInError,
  proRequiredError,
  uploadMedia,
  videoLinks,
} from "./cloud";
import { AgentBridgeError, AgentErrorCode } from "./errors";

// session: { [videoId]: upload job }, so get_video can report progress.
const UPLOADS_KEY = "agentUploads";
// local: { [takeId]: videoId }, so the same take is never uploaded twice.
const UPLOADED_TAKES_KEY = "agentUploadedTakes";
// session: the recording an agent last stopped: { kind, videoId?, takeId?, at }.
export const LAST_RECORDING_KEY = "agentLastRecording";
// A separate camera file is uploaded when it starts this close to the screen:
// the cloud player only lines a camera up through an edit, which an upload
// from here has none of.
const CAMERA_SYNC_TOLERANCE_S = 0.25;
const VISIBILITIES = ["private", "workspace", "public"];
const VIDEO_ID = /^[0-9a-f-]{36}$/i;

// Uploads this worker is running right now. A job left "uploading" in
// storage with no runner here was cut off by a worker restart.
const running = new Set();

// How the site words who may watch (recordful-ee lib/visibility.ts).
const visibilityOf = (v) => (v?.isPublic ? "public" : v?.isPrivate ? "private" : "workspace");

const getSession = async (key) => (await chrome.storage.session.get([key]))[key];
const getLocal = async (key) => (await chrome.storage.local.get([key]))[key];

const saveJob = async (job) => {
  const jobs = (await getSession(UPLOADS_KEY)) || {};
  jobs[job.videoId] = job;
  // Keep the newest 20; old jobs only matter until their video is ready.
  const ids = Object.keys(jobs).sort((a, b) => (jobs[b].startedAt || 0) - (jobs[a].startedAt || 0));
  for (const id of ids.slice(20)) delete jobs[id];
  await chrome.storage.session.set({ [UPLOADS_KEY]: jobs });
};

const getJob = async (videoId) => {
  const job = ((await getSession(UPLOADS_KEY)) || {})[videoId] || null;
  if (job?.stage === "uploading" && !running.has(videoId)) {
    return {
      ...job,
      stage: "failed",
      error: {
        code: AgentErrorCode.UploadInterrupted,
        message: "The upload was interrupted (Chrome restarted Recordful). Upload it again with force.",
      },
    };
  }
  return job;
};

const requireVideoId = async (videoId) => {
  if (videoId !== undefined && videoId !== null) {
    if (typeof videoId !== "string" || !VIDEO_ID.test(videoId)) {
      throw new AgentBridgeError(AgentErrorCode.InvalidParams, "videoId must be a Recordful video ID");
    }
    return videoId;
  }
  const last = await getSession(LAST_RECORDING_KEY);
  if (last?.videoId) return last.videoId;
  if (last?.takeId) {
    const uploaded = ((await getLocal(UPLOADED_TAKES_KEY)) || {})[last.takeId];
    if (uploaded) return uploaded;
    throw new AgentBridgeError(
      AgentErrorCode.NotUploaded,
      "The last recording is only on this computer. Upload it with upload_recording first (Recordful Pro).",
      { takeId: last.takeId },
    );
  }
  // Nothing this browser session (Chrome restarted, say): the newest video.
  const { videos } = await api("/videos", { query: { pageSize: 1, kind: "video" } });
  if (videos?.[0]?.id) return videos[0].id;
  throw new AgentBridgeError(
    AgentErrorCode.NoRecording,
    "There's no recording to use yet. Record one first, or pass a videoId (list_videos shows them).",
  );
};

const requirePro = async () => {
  const account = await accountStatus();
  if (!account.cloud) {
    throw new AgentBridgeError(
      AgentErrorCode.CloudUnavailable,
      "This build of Recordful has no cloud features, so it can't upload or transcribe. Install Recordful from the Chrome Web Store.",
    );
  }
  if (!account.signedIn) throw notSignedInError();
  if (!account.pro) throw proRequiredError();
  return account;
};

const rememberLast = (last) =>
  chrome.storage.session.set({ [LAST_RECORDING_KEY]: { ...last, at: Date.now() } }).catch(() => {});

const defaultTitle = (ms) => {
  const when = new Date(ms || Date.now()).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Recording - ${when}`;
};

// ---- methods ---------------------------------------------------------------

const getAccount = async () => accountStatus();

const listLocalTakes = async () => {
  const takes = await listTakes();
  const uploaded = (await getLocal(UPLOADED_TAKES_KEY)) || {};
  const last = await getSession(LAST_RECORDING_KEY);
  return {
    takes: takes
      .slice()
      .reverse()
      .map((take) => ({
        takeId: take.id,
        bytes: take.size,
        recordedAt: new Date(take.lastModified).toISOString(),
        uploadedVideoId: uploaded[take.id] || null,
        isLastRecording: last?.takeId === take.id,
      })),
  };
};

const runUpload = async (job, { blob, camera, title, visibility }) => {
  running.add(job.videoId);
  const progress = async (bytes) => {
    job.uploadedBytes += bytes;
    await saveJob(job);
  };
  try {
    await uploadMedia(job.videoId, blob, "screen", progress);
    if (camera) await uploadMedia(job.videoId, camera, "camera", progress);
    const patch = { title };
    if (visibility) patch.visibility = visibility;
    await api(`/videos/${job.videoId}`, { method: "PATCH", body: patch });
    job.stage = "done";
    job.finishedAt = Date.now();
    const uploaded = (await getLocal(UPLOADED_TAKES_KEY)) || {};
    uploaded[job.takeId] = job.videoId;
    await chrome.storage.local.set({ [UPLOADED_TAKES_KEY]: uploaded });
  } catch (err) {
    job.stage = "failed";
    job.error = {
      code: err?.code || AgentErrorCode.UploadFailed,
      message: String(err?.message || err).slice(0, 500),
    };
  } finally {
    running.delete(job.videoId);
    await saveJob(job);
  }
};

const uploadRecording = async ({ takeId, title, visibility, force } = {}) => {
  if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 200)) {
    throw new AgentBridgeError(AgentErrorCode.InvalidParams, "title must be 1 to 200 characters");
  }
  if (visibility !== undefined && !VISIBILITIES.includes(visibility)) {
    throw new AgentBridgeError(AgentErrorCode.InvalidParams, `visibility must be one of ${VISIBILITIES.join(", ")}`);
  }

  // A cloud recording is uploaded already: answer with it instead.
  const last = await getSession(LAST_RECORDING_KEY);
  if (!takeId && last?.kind === "cloud" && last.videoId) {
    return {
      videoId: last.videoId,
      ...videoLinks(last.videoId),
      stage: "uploading",
      alreadyUploaded: true,
      note: "This recording was made in the cloud, so it uploads as it records. Use get_video to follow it.",
    };
  }

  await requirePro();

  let id = takeId;
  if (!id) {
    if (last?.kind === "local" && last.takeId) id = last.takeId;
    else {
      const { lastRecordingBackendRef } = await chrome.storage.local.get(["lastRecordingBackendRef"]);
      id = lastRecordingBackendRef?.fileName || null;
    }
  }
  if (!id) {
    throw new AgentBridgeError(AgentErrorCode.NoRecording, "There is no local recording to upload. Record one first.");
  }

  if (!force) {
    const existing = ((await getLocal(UPLOADED_TAKES_KEY)) || {})[id];
    if (existing) {
      await rememberLast({ kind: "local", takeId: id, videoId: existing });
      return {
        videoId: existing,
        takeId: id,
        ...videoLinks(existing),
        stage: "done",
        alreadyUploaded: true,
        note: "This recording was uploaded before. Pass force to upload another copy.",
      };
    }
    const jobs = (await getSession(UPLOADS_KEY)) || {};
    const inFlight = Object.values(jobs).find((j) => j.takeId === id && j.stage === "uploading" && running.has(j.videoId));
    if (inFlight) {
      return { videoId: inFlight.videoId, takeId: id, ...videoLinks(inFlight.videoId), stage: "uploading", alreadyUploading: true };
    }
  }

  const take = await readRecording(id).catch(() => ({}));
  if (!take?.blob?.size) {
    throw new AgentBridgeError(
      AgentErrorCode.NoRecording,
      "That recording can't be read (it may have been cleaned up). list_recordings shows what is on this computer.",
      { takeId: id },
    );
  }
  const takes = await listTakes().catch(() => []);
  const recordedAt = takes.find((t) => t.id === id)?.lastModified;
  const finalTitle = title?.trim() || defaultTitle(recordedAt);

  let camera = null;
  let cameraNote = "none";
  if (take.camera?.size) {
    if (Math.abs(take.cameraOffset || 0) <= CAMERA_SYNC_TOLERANCE_S) {
      camera = take.camera;
      cameraNote = "included";
    } else {
      cameraNote = "skipped";
    }
  }

  const { videoId } = await api("/videos/create", { method: "POST", body: { title: finalTitle } });
  const job = {
    videoId,
    takeId: id,
    stage: "uploading",
    uploadedBytes: 0,
    totalBytes: take.blob.size + (camera?.size || 0),
    startedAt: Date.now(),
  };
  await saveJob(job);
  // From now on "the last recording" means this video.
  await rememberLast({ kind: "local", takeId: id, videoId });
  // Not awaited: an upload can outlast a request. get_video follows it.
  runUpload(job, { blob: take.blob, camera, title: finalTitle, visibility });

  return {
    videoId,
    takeId: id,
    title: finalTitle,
    ...videoLinks(videoId),
    stage: "uploading",
    totalBytes: job.totalBytes,
    camera: cameraNote,
    ...(cameraNote === "skipped"
      ? { note: "The camera was recorded as a separate file out of sync with the screen, so it wasn't uploaded. The user can add it in Recordful's editor." }
      : {}),
  };
};

const getVideo = async ({ videoId } = {}) => {
  const id = await requireVideoId(videoId);
  const job = await getJob(id);
  if (job?.stage === "failed") {
    return { videoId: id, ...videoLinks(id), stage: "failed", error: job.error };
  }
  const [{ video }, status] = await Promise.all([
    api(`/videos/${id}`),
    api(`/public/videos/${id}/status`).catch(() => null),
  ]);
  const uploadingHere = job?.stage === "uploading";
  return {
    videoId: id,
    title: video?.title ?? null,
    visibility: video ? visibilityOf(video) : null,
    durationSeconds: video?.durationSeconds ?? null,
    createdAt: video?.createdAt ?? null,
    ...videoLinks(id),
    // "uploading" → "processing" → "ready" (the site's own upload stages).
    stage: uploadingHere ? "uploading" : status?.stage ?? "uploading",
    uploadedBytes: uploadingHere ? job.uploadedBytes : status?.uploadedBytes ?? null,
    totalBytes: uploadingHere ? job.totalBytes : null,
  };
};

const listVideos = async ({ limit, query } = {}) => {
  const pageSize = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 10;
  const { videos } = await api("/videos", {
    query: { pageSize, kind: "video", query: query || undefined },
  });
  return {
    videos: (videos || []).map((v) => ({
      videoId: v.id,
      title: v.title ?? null,
      createdAt: v.createdAt ?? null,
      durationSeconds: v.durationSeconds ?? null,
      visibility: visibilityOf(v),
      ...videoLinks(v.id),
    })),
  };
};

// One look at the transcript: returns it when done, otherwise starts it (if
// asked) and says how it is going. The MCP server polls this to wait.
const getTranscript = async ({ videoId, start = true } = {}) => {
  await requirePro();
  const id = await requireVideoId(videoId);
  const job = await getJob(id);
  if (job?.stage === "uploading") {
    return { videoId: id, status: "uploading", note: "The video is still uploading; the transcript starts once it's up." };
  }
  if (job?.stage === "failed") {
    throw new AgentBridgeError(job.error.code, job.error.message);
  }
  let now = await api(`/videos/${id}/transcript`, { query: { text: 1 } });
  if (now.status === "none" && start) {
    try {
      await api(`/videos/${id}/transcript`, { method: "POST" });
    } catch (err) {
      // Still arriving: report it the way an upload in progress reads.
      if (err?.code === AgentErrorCode.NotUploaded) {
        return { videoId: id, status: "uploading", note: "The video is still uploading; the transcript starts once it's up." };
      }
      throw err;
    }
    now = await api(`/videos/${id}/transcript`, { query: { text: 1 } });
  }
  if (now.status === "done") {
    return { videoId: id, status: "done", text: now.text ?? "", vtt: now.vtt ?? "", ...videoLinks(id) };
  }
  if (now.status === "failed") {
    return { videoId: id, status: "failed", reason: now.reason ?? null };
  }
  return { videoId: id, status: now.status };
};

// Each takes the recorder's queue only when it touches local files; the rest
// can run beside recording and page actions.
export const videoCommands = {
  "account.get": { run: getAccount, queue: null },
  "takes.list": { run: listLocalTakes, queue: null },
  "video.upload": { run: uploadRecording, queue: "upload" },
  "video.get": { run: getVideo, queue: null },
  "video.list": { run: listVideos, queue: null },
  "video.transcript": { run: getTranscript, queue: null },
};

export { cloudAvailable };
