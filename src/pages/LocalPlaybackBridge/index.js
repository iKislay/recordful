// Hands the editor a recording's local bytes as one Blob, so playback starts
// before the upload finishes. Iframe, not chrome.runtime: the base64 runtime
// path was 92 round trips and ~295MB of copies for a 221MB file, capped at
// 250MB, and Chrome 148 message_serialization still copies. postMessage passes
// the Blob by reference (0.1ms for 400MB), and an extension-origin frame sees
// the recorder's OPFS tree.

import {
  openExistingChunksStore,
} from "../CloudRecorder/recorderStorage/chooseChunksStore";

const APP_ORIGIN = (() => {
  try {
    const base = process.env.RECORDFUL_APP_BASE;
    return base ? new URL(base).origin : null;
  } catch {
    return null;
  }
})();

const READY = "recordful-local-playback-bridge-ready";
const REQUEST = "recordful-local-playback-bridge-request";
const RESULT = "recordful-local-playback-bridge-result";

const post = (payload) => {
  if (!APP_ORIGIN || window.parent === window) return;
  window.parent.postMessage({ ...payload, source: payload.source }, APP_ORIGIN);
};

const resolveStore = (offer) => {
  if (offer?.storageBackend === "opfs" && offer.opfsSessionId) {
    return openExistingChunksStore({
      sessionId: offer.opfsSessionId,
      track: "screen",
      backend: "opfs",
    }).store;
  }
  return openExistingChunksStore({
    sessionId: offer?.opfsSessionId || null,
    track: "screen",
    backend: "idb",
  }).store;
};

// getFile()'s Blob is a live OPFS view and throws NotFoundError once purged,
// hence materialising each chunk. One chunk at a time caps peak memory, and the
// final concat is by reference.
const buildBlob = async (offer) => {
  const store = resolveStore(offer);
  const mimeType = offer.container || "video/webm";
  const parts = [];
  let bytes = 0;

  for (let index = 0; index < offer.chunkCount; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const item = await store.getItem(`chunk_${index}`).catch(() => null);
    if (!item?.chunk) {
      throw new Error(`local-playback-chunk-missing:${index}`);
    }
    // eslint-disable-next-line no-await-in-loop
    const buffer = await item.chunk.arrayBuffer();
    parts.push(new Blob([buffer], { type: mimeType }));
    bytes += buffer.byteLength;
  }

  if (!parts.length) throw new Error("local-playback-no-chunks");
  return { blob: new Blob(parts, { type: mimeType }), bytes };
};

let inFlight = null;

const onMessage = async (event) => {
  if (!APP_ORIGIN || event.origin !== APP_ORIGIN) return;
  if (event.source !== window.parent) return;
  const data = event.data;
  if (!data || data.source !== REQUEST) return;

  const requestedOfferId = data.offer?.offerId || null;
  const requestId = data.requestId || null;
  if (!requestedOfferId) {
    post({ source: RESULT, requestId, ok: false, error: "invalid-offer" });
    return;
  }

  // Answer instead of going silent: the caller's only other signal is a 120s
  // timeout, which stalled the second scene of a multi-scene handoff.
  if (inFlight) {
    post({ source: RESULT, requestId, ok: false, error: "bridge-busy" });
    return;
  }
  inFlight = requestedOfferId;

  const startedAt = Date.now();
  try {
    // Never read from the page-supplied offer: any script on the app origin can
    // post here, and an unchecked backend plus chunkCount reads any recording.
    const redeemed = await chrome.runtime.sendMessage({
      type: "cloud-local-playback-redeem-offer",
      offerId: requestedOfferId,
    });
    if (!redeemed?.ok || !redeemed.offer?.chunkCount) {
      throw new Error(redeemed?.error || "local-playback-offer-unavailable");
    }
    const offer = redeemed.offer;
    const { blob, bytes } = await buildBlob(offer);
    post({
      source: RESULT,
      requestId,
      ok: true,
      offerId: offer.offerId,
      blob,
      size: bytes,
      mimeType: blob.type,
      chunkCount: offer.chunkCount,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err) {
    post({
      source: RESULT,
      requestId,
      ok: false,
      offerId: requestedOfferId,
      error: err?.message || "local-playback-bridge-failed",
      elapsedMs: Date.now() - startedAt,
    });
  } finally {
    inFlight = null;
  }
};

window.addEventListener("message", (event) => {
  void onMessage(event);
});

post({ source: READY });
