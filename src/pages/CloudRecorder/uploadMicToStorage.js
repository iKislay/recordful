// Mic upload for separated-audio scenes, sent as one file at stop rather
// than streamed like the screen and camera tracks. It goes through the same
// multipart uploader; micRecovery.js covers the tab dying during it.
import R2Uploader from "./r2Uploader.js";

const API_BASE = process.env.RECORDFUL_API_BASE_URL;

export const collectMicChunks = async (store, prefix = "audio_chunk_") => {
  const parts = [];
  await store.iterate((value, key) => {
    if (!key.startsWith(prefix)) return;
    if (!value?.chunk) return;
    parts.push({ index: Number(value.index), chunk: value.chunk });
  });
  parts.sort((a, b) => a.index - b.index);
  return parts.map((p) => p.chunk);
};

/**
 * Upload the mic recording and return its media id. Resolves
 * { ok: false, reason } rather than throwing: the mic is supplementary and must
 * never take the scene down with it.
 */
export const uploadMicToStorage = async ({
  chunks,
  mimeType,
  sceneId,
  projectId,
}) => {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { ok: false, reason: "no-chunks" };
  }
  const blob = new Blob(chunks);
  if (blob.size === 0) return { ok: false, reason: "empty-blob" };

  // No journal: the background resumes journaled uploads from the chunk
  // store, which would race the mic recovery marker into a second copy.
  const uploader = new R2Uploader({
    trackType: "audio",
    container: mimeType,
    journal: false,
  });
  try {
    const { mediaId } = await uploader.initialize(projectId, {
      type: "audio",
      sceneId,
    });
    await uploader.write(blob);
    await uploader.finalize();
    return { ok: true, mediaId, bytes: blob.size };
  } catch (err) {
    await uploader.abort("mic-upload-failed");
    return {
      ok: false,
      reason: err?.status ? `http-${err.status}` : err?.message || String(err),
    };
  }
};

/**
 * Point an already-created scene at its mic media. Fill-only; answers
 * 200 { attached: false } for a filled slot, a repeat or a deleted scene,
 * so callers need no special-casing.
 */
export const attachSceneAudio = async ({
  projectId,
  sceneId,
  audioMediaId,
  duration = null,
  token,
  fetchImpl = fetch,
}) => {
  if (!API_BASE) return { ok: false, reason: "no-api-base" };
  if (!token) return { ok: false, reason: "no-token" };
  if (!projectId || !sceneId || !audioMediaId) {
    return { ok: false, reason: "missing-ids" };
  }
  try {
    const res = await fetchImpl(
      `${API_BASE}/videos/${projectId}/attach-scene-audio`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sceneId,
          audioMediaId,
          ...(typeof duration === "number" && duration > 0 ? { duration } : {}),
        }),
        keepalive: true,
      },
    );
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      return { ok: false, reason: `http-${res.status}`, status: res.status };
    }
    // attached:false is a settled answer, not a failure to retry.
    return { ok: true, attached: body?.attached !== false, reason: body?.reason };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
};
