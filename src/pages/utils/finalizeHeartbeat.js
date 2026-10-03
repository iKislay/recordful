// Proof that the recorder is still finalizing, for the editor's OPFS reader.
// The reader gives up on a writer whose file stops growing for 3s, but a flush
// writes nothing for up to 15s per track, so a healthy finalize looked dead and
// the editor read a truncated file. Only a live page can keep this fresh.

const HEARTBEAT_INTERVAL_MS = 1000;
export const WRITER_HEARTBEAT_KEY = "lastRecordingWriterHeartbeat";

// Returns a stop function. Fire-and-forget writes: awaiting storage under SW
// contention has already cost this path seconds before.
export const beginFinalizeHeartbeat = (fileName) => {
  if (!fileName || typeof chrome === "undefined" || !chrome.storage?.local) {
    return () => {};
  }
  const write = () => {
    try {
      chrome.storage.local.set({
        [WRITER_HEARTBEAT_KEY]: { fileName, at: Date.now() },
      });
    } catch {}
  };
  write();
  const timer = setInterval(write, HEARTBEAT_INTERVAL_MS);
  return () => {
    try {
      clearInterval(timer);
    } catch {}
  };
};
