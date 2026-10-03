// Streams one track of a cloud recording (screen, camera or audio) to storage
// as a multipart upload, while it is being recorded.
//
// The API starts the upload and signs a URL per part; each part is PUT
// straight to storage. Parts are numbered, so resending one is harmless, and
// the server can list which ones it holds, which is what resume is built on.
//
// Offsets, because the recorder and the crash-resume code reason in bytes:
//   totalBytes        everything handed to write()
//   offset            bytes confirmed in storage (whole parts)
//   lastServerOffset  same as offset; local chunks below it may be purged
// Every part but the last must be exactly PART_SIZE, so the newest bytes wait
// in `tail` until a part fills or finalize() sends them. getServerOffset()
// counts that tail while this instance holds it: those bytes are not lost,
// only unsent. After a crash the tail is gone and the offset is what storage
// really has, so resume re-sends from the local copy.

const API_BASE = process.env.RECORDFUL_API_BASE_URL;

const PART_SIZE = 5 * 1024 * 1024; // storage minimum for a non-final part
const MAX_PARTS = 10000;
const SIGN_BATCH = 10; // part URLs requested per call
const SIGNED_URL_REUSE_MS = 50 * 60 * 1000; // server signs for 60 minutes
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1000;
const PART_TIMEOUT_MS = 120000;
const MAX_QUEUED_PARTS = 3; // write() waits beyond this, to bound memory
const HEARTBEAT_INTERVAL_MS = 10000;
// ponytail: fetch reports no upload progress, so a stall is "a queued part
// has not finished for this long". Slow links below ~0.5 Mbps trip it early;
// switch the part PUT to XHR upload progress if that shows up in telemetry.
const STALL_MS = 90000;
const JOURNAL_WRITE_INTERVAL_MS = 4000;
const PROGRESS_EVENT_INTERVAL_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isTransientStatus = (status) =>
  status >= 500 || status === 408 || status === 429;

export default class R2Uploader {
  constructor(options = {}) {
    this.onProgress = options.onProgress || null;
    this.onStall = options.onStall || null;
    this.onTelemetry = options.onTelemetry || null;
    this.onStateChange = options.onStateChange || null;
    this.trackType = options.trackType || null;
    this.clientSessionId = options.clientSessionId || null;
    this.sessionId = options.sessionId || null;
    this.container = options.container || "video/webm";
    this.codec = options.codec || null;
    this.encoderKind = options.encoderKind || null;
    this.journal = options.journal !== false;

    this.projectId = null;
    this.sceneId = null;
    this.metadata = {};
    this.metaWidth = null;
    this.metaHeight = null;
    // The recorder and the resume code identify a track by videoId + mediaId.
    // There is one id per track now; both hold it.
    this.mediaId = null;
    this.videoId = null;

    this.status = "idle";
    this.error = null;
    this.lastErrorCode = null;
    this.lastErrorAt = null;
    this.isPaused = false;
    this.isFinalizing = false;
    this.stalled = false;

    this.totalBytes = 0;
    this.offset = 0;
    this.lastServerOffset = 0;
    this.tail = [];
    this.tailBytes = 0;
    this.partQueue = [];
    this.nextPartNumber = 1;
    this.partUrls = new Map();
    this.partUrlsSignedAt = 0;
    this.isProcessingQueue = false;
    this.queueProcessingPromise = null;
    this.inFlight = null;

    this.createPostMs = null;
    this.createdAt = null;
    this.readyAt = null;
    this.firstByteAt = null;
    this.finalizedAt = null;
    this.lastProgressAt = Date.now();
    this.lastProgressEventAt = 0;
    this.lastJournalPersistAt = 0;
    this.journalPersistTimer = null;
    this.heartbeatTimer = null;
    this.hasEmittedClientStarted = false;
  }

  get queuedBytes() {
    return this.totalBytes - this.offset;
  }

  // --- reporting ---------------------------------------------------------

  emitTelemetry(event, payload = {}) {
    if (typeof this.onTelemetry !== "function") return;
    try {
      this.onTelemetry(event, {
        projectId: this.projectId,
        sceneId: this.sceneId,
        recordingSessionId: this.sessionId,
        mediaId: this.mediaId,
        trackType: this.trackType,
        uploaderType: "r2_multipart",
        status: this.status,
        offset: this.offset,
        totalBytes: this.totalBytes,
        queuedBytes: this.queuedBytes,
        codec: this.codec,
        container: this.container,
        encoderKind: this.encoderKind,
        clientSessionId: this.clientSessionId,
        ...payload,
      });
    } catch (err) {
      console.warn("Upload telemetry callback failed:", err);
    }
  }

  getResumeState() {
    return {
      projectId: this.projectId,
      sceneId: this.sceneId,
      type: this.metadata.type || null,
      trackType: this.trackType,
      sessionId: this.sessionId,
      videoId: this.videoId,
      mediaId: this.mediaId,
      offset: this.offset,
      totalBytes: this.totalBytes,
      status: this.status,
      error: this.error,
      stalled: this.stalled,
      queueLength: this.partQueue.length,
      queuedBytes: this.queuedBytes,
      lastProgressAt: this.lastProgressAt,
      lastServerOffset: this.lastServerOffset,
      firstByteAt: this.firstByteAt,
      readyAt: this.readyAt,
      createdAt: this.createdAt,
      finalizedAt: this.finalizedAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorCode: this.lastErrorCode,
      isFinalizing: this.isFinalizing,
      updatedAt: Date.now(),
    };
  }

  getMeta() {
    return {
      videoId: this.videoId,
      mediaId: this.mediaId,
      offset: this.offset,
      status: this.status,
      error: this.error,
      isPaused: this.isPaused,
      isFinalizing: this.isFinalizing,
      metadata: this.metadata,
      queueLength: this.partQueue.length,
      queuedBytes: this.queuedBytes,
      width: this.metaWidth,
      height: this.metaHeight,
      sceneId: this.sceneId,
      lastProgressAt: this.lastProgressAt,
      stalled: this.stalled,
    };
  }

  notifyStateChange(reason) {
    if (typeof this.onStateChange !== "function") return;
    try {
      this.onStateChange({ reason, ...this.getResumeState() });
    } catch (err) {
      console.warn("Upload state callback failed:", err);
    }
  }

  setUploaderError(errorCode, err = null, extra = {}) {
    this.status = "error";
    this.error = errorCode;
    this.lastErrorCode = errorCode;
    this.lastErrorAt = Date.now();
    this.emitTelemetry("upload_error", {
      errorCode,
      message: err?.message || errorCode,
      ...extra,
    });
    this.scheduleJournalPersist({ force: true });
  }

  updateEncoderInfo({ codec, container, encoderKind } = {}) {
    if (codec) this.codec = codec;
    if (container) this.container = container;
    if (encoderKind) this.encoderKind = encoderKind;
  }

  async setSessionId(sessionId) {
    this.sessionId = sessionId || null;
    await this.persistUploadJournal();
    this.notifyStateChange("session-updated");
  }

  // --- journal -----------------------------------------------------------
  // One entry per track in chrome.storage.local. It is how the background
  // finds an upload that a crash or a closed tab left unfinished. A caller
  // with its own recovery turns it off with `journal: false`.

  scheduleJournalPersist({ force = false } = {}) {
    if (!this.mediaId || !this.journal) return;
    if (force) {
      void this.persistUploadJournal();
      return;
    }
    if (this.journalPersistTimer) return;
    const wait = Math.max(
      JOURNAL_WRITE_INTERVAL_MS - (Date.now() - this.lastJournalPersistAt),
      0,
    );
    this.journalPersistTimer = setTimeout(() => {
      this.journalPersistTimer = null;
      void this.persistUploadJournal();
    }, wait);
  }

  async persistUploadJournal() {
    if (!this.mediaId || !this.journal) return;
    clearTimeout(this.journalPersistTimer);
    this.journalPersistTimer = null;
    const key = `uploadJournal-${this.mediaId}`;
    try {
      await chrome.storage.local.set({
        [key]: {
          key,
          title: this.metadata.title || null,
          width: this.metaWidth,
          height: this.metaHeight,
          ...this.getResumeState(),
        },
      });
      this.lastJournalPersistAt = Date.now();
      this.notifyStateChange("journal-persisted");
    } catch (err) {
      console.warn("[r2Uploader] failed to persist upload journal", err);
    }
  }

  async clearUploadJournal() {
    clearTimeout(this.journalPersistTimer);
    this.journalPersistTimer = null;
    if (!this.mediaId) return;
    try {
      await chrome.storage.local.remove(`uploadJournal-${this.mediaId}`);
    } catch (err) {
      console.warn("[r2Uploader] failed to clear upload journal", err);
    }
  }

  // --- API ---------------------------------------------------------------

  // Throws an Error carrying `status` (and the parsed `body`) on a non-2xx
  // answer. Network failures and transient statuses are retried; a 401 is
  // retried once after the background has had a chance to refresh the token.
  async api(method, path, body) {
    let lastErr = null;
    let refreshedAuth = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS * 2 ** (attempt - 1));
      const { recordfulToken } =
        await chrome.storage.local.get("recordfulToken");
      let res;
      try {
        res = await fetch(`${API_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${recordfulToken}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        lastErr = err;
        continue;
      }
      if (res.ok) return res.json();

      lastErr = new Error(`${method} ${path} failed (${res.status})`);
      lastErr.status = res.status;
      lastErr.body = await res.json().catch(() => null);
      if (res.status === 401 && !refreshedAuth) {
        refreshedAuth = true;
        await chrome.runtime
          .sendMessage({ type: "check-auth-status" })
          .catch(() => {});
        continue;
      }
      if (!isTransientStatus(res.status)) break;
    }
    throw lastErr;
  }

  // Bytes storage holds as an unbroken run of whole parts from part 1.
  async fetchConfirmedBytes() {
    const { parts } = await this.api("GET", `/uploads/${this.mediaId}/parts`);
    let bytes = 0;
    for (const [index, part] of parts.entries()) {
      if (part.partNumber !== index + 1 || part.size !== PART_SIZE) break;
      bytes += part.size;
    }
    return bytes;
  }

  async getPartUrl(partNumber) {
    const fresh = Date.now() - this.partUrlsSignedAt < SIGNED_URL_REUSE_MS;
    if (!fresh || !this.partUrls.has(partNumber)) {
      const partNumbers = [];
      for (
        let n = partNumber;
        n < partNumber + SIGN_BATCH && n <= MAX_PARTS;
        n += 1
      ) {
        partNumbers.push(n);
      }
      const { urls } = await this.api(
        "POST",
        `/uploads/${this.mediaId}/parts`,
        { partNumbers },
      );
      this.partUrls = new Map(
        Object.entries(urls).map(([n, url]) => [Number(n), url]),
      );
      this.partUrlsSignedAt = Date.now();
    }
    return this.partUrls.get(partNumber);
  }

  // --- lifecycle ---------------------------------------------------------

  /**
   * Starts a new upload, or with `reuse: { mediaId }` picks up one left by a
   * crash and sets `offset` to what storage already holds. Throws an Error
   * with `status: 404` when that upload no longer exists.
   */
  async initialize(
    projectId,
    {
      title,
      type,
      width = null,
      height = null,
      reuse = null,
      sceneId = null,
      sessionId = null,
    },
  ) {
    if (this.status !== "idle" && this.status !== "error") {
      throw new Error("Uploader has already been initialized");
    }
    this.projectId = projectId;
    this.sceneId = sceneId;
    this.metadata = { title, type, sceneId };
    this.trackType = this.trackType || type || null;
    this.metaWidth = width;
    this.metaHeight = height;
    this.sessionId = sessionId || this.sessionId;
    this.createdAt = Date.now();
    this.status = "initializing";
    this.error = null;
    this.lastErrorCode = null;

    try {
      if (reuse?.mediaId) {
        this.mediaId = reuse.mediaId;
        this.offset = await this.fetchConfirmedBytes();
        this.lastServerOffset = this.offset;
        this.totalBytes = this.offset;
        this.nextPartNumber = this.offset / PART_SIZE + 1;
        this.emitTelemetry("upload_resumed", { resumedOffset: this.offset });
      } else {
        const startedAt = Date.now();
        const { mediaId } = await this.api("POST", "/uploads", {
          projectId,
          type,
          // Bare MIME type; the API rejects codec parameters.
          contentType: this.container.split(";")[0],
        });
        this.createPostMs = Date.now() - startedAt;
        this.mediaId = mediaId;
      }
      this.videoId = this.mediaId;
    } catch (err) {
      this.setUploaderError("initialize-failed", err);
      throw err;
    }

    this.status = "ready";
    this.readyAt = Date.now();
    this.startHeartbeat();
    await this.persistUploadJournal();
    this.emitTelemetry("upload_started", { resumed: Boolean(reuse) });
    return { videoId: this.videoId, mediaId: this.mediaId };
  }

  /** Accepts recorded bytes. Whole parts are queued for upload as they fill. */
  async write(chunk) {
    if (this.isFinalizing || this.status === "completed") {
      this.setUploaderError("write-after-finalize");
      throw new Error("Cannot write during finalization");
    }
    if (this.isPaused) throw new Error("Uploader paused");
    if (!this.mediaId) throw new Error("Uploader not initialized");
    if (this.status === "error") {
      throw new Error(`Uploader in error state: ${this.error}`);
    }
    this.status = "uploading";
    if (!this.hasEmittedClientStarted) {
      this.hasEmittedClientStarted = true;
      this.emitTelemetry("upload_client_started");
    }

    // A finalize that failed left the short final part queued. More bytes are
    // arriving, so it is not final after all: put it back in front.
    const last = this.partQueue[this.partQueue.length - 1];
    if (last && last.size < PART_SIZE && !this.isProcessingQueue) {
      this.partQueue.pop();
      this.tail.unshift(last);
      this.tailBytes += last.size;
    }

    this.tail.push(chunk);
    this.tailBytes += chunk.size;
    this.totalBytes += chunk.size;
    if (this.tailBytes >= PART_SIZE) {
      const joined = new Blob(this.tail);
      let start = 0;
      for (; start + PART_SIZE <= joined.size; start += PART_SIZE) {
        this.enqueuePart(joined.slice(start, start + PART_SIZE));
      }
      const rest = joined.slice(start);
      this.tail = rest.size ? [rest] : [];
      this.tailBytes = rest.size;
    }

    this.scheduleJournalPersist();
    this.processQueue();
    if (this.partQueue.length > MAX_QUEUED_PARTS) {
      await this.waitForPendingUploads();
    }
  }

  enqueuePart(part) {
    // The stall clock starts when there is something to upload.
    if (this.partQueue.length === 0) this.lastProgressAt = Date.now();
    this.partQueue.push(part);
  }

  processQueue() {
    if (this.isProcessingQueue) return this.queueProcessingPromise;
    this.isProcessingQueue = true;
    this.queueProcessingPromise = (async () => {
      try {
        while (this.partQueue.length && !this.isPaused) {
          const part = this.partQueue[0];
          try {
            await this.uploadPart(this.nextPartNumber, part);
          } catch (err) {
            if (this.status !== "aborted") {
              console.error("[r2Uploader] part upload failed:", err);
              this.setUploaderError("queue-upload-failed", err, {
                partNumber: this.nextPartNumber,
              });
            }
            break;
          }
          this.partQueue.shift();
          this.nextPartNumber += 1;
          this.offset += part.size;
          this.lastServerOffset = this.offset;
          this.recordProgress(part.size);
        }
      } finally {
        this.isProcessingQueue = false;
        this.queueProcessingPromise = null;
      }
    })();
    return this.queueProcessingPromise;
  }

  async uploadPart(partNumber, part) {
    let lastErr = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS * 2 ** (attempt - 1));
      if (this.status === "aborted") throw new Error("Upload aborted");
      const url = await this.getPartUrl(partNumber);
      this.inFlight = new AbortController();
      try {
        const res = await fetch(url, {
          method: "PUT",
          body: part,
          signal: AbortSignal.any([
            this.inFlight.signal,
            AbortSignal.timeout(PART_TIMEOUT_MS),
          ]),
        });
        if (res.ok) return;
        lastErr = new Error(`Part ${partNumber} failed (${res.status})`);
        lastErr.status = res.status;
        // An expired or rejected signature: ask for a new one.
        if (res.status === 403) this.partUrls.clear();
        else if (!isTransientStatus(res.status)) break;
      } catch (err) {
        lastErr = err;
      } finally {
        this.inFlight = null;
      }
    }
    throw lastErr;
  }

  recordProgress(bytes) {
    this.lastProgressAt = Date.now();
    this.stalled = false;
    if (!this.firstByteAt) {
      this.firstByteAt = this.lastProgressAt;
      this.emitTelemetry("upload_first_byte", { bytes });
    }
    if (typeof this.onProgress === "function") {
      try {
        this.onProgress({
          bytes,
          offset: this.offset,
          videoId: this.videoId,
          mediaId: this.mediaId,
          at: this.lastProgressAt,
        });
      } catch (err) {
        console.warn("Progress callback failed:", err);
      }
    }
    if (
      this.lastProgressAt - this.lastProgressEventAt >=
      PROGRESS_EVENT_INTERVAL_MS
    ) {
      this.lastProgressEventAt = this.lastProgressAt;
      this.emitTelemetry("upload_progress", { bytes });
    }
    this.scheduleJournalPersist();
  }

  /** Resolves once the queue is empty, or stops moving (error or stall). */
  async waitForPendingUploads() {
    const wasPaused = this.isPaused;
    this.isPaused = false;
    while (
      this.partQueue.length &&
      this.status !== "error" &&
      this.status !== "aborted" &&
      !this.stalled
    ) {
      await this.processQueue();
    }
    this.isPaused = wasPaused;
  }

  async waitForInFlightChunk(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (this.isProcessingQueue) {
      if (Date.now() >= deadline) return false;
      await sleep(50);
    }
    return true;
  }

  /**
   * Bytes accounted for: what storage holds, plus the tail this instance is
   * still holding when nothing is queued behind a failure. null if the server
   * could not be asked.
   */
  async getServerOffset() {
    if (!this.mediaId) return null;
    if (this.status === "completed") return this.totalBytes;
    try {
      const confirmed = await this.fetchConfirmedBytes();
      return this.partQueue.length ? confirmed : confirmed + this.tailBytes;
    } catch (err) {
      console.warn("[r2Uploader] could not read the server offset", err);
      return null;
    }
  }

  /**
   * Rewinds to `serverOffset` so the recorder can write the missing bytes
   * again from its local copy. Only a part boundary can be rewound to.
   */
  prepareGapResend(serverOffset) {
    if (
      !Number.isFinite(serverOffset) ||
      serverOffset < 0 ||
      serverOffset % PART_SIZE !== 0 ||
      this.isFinalizing ||
      this.isProcessingQueue
    ) {
      this.emitTelemetry("upload_gap_resend_blocked", {
        serverOffset,
        clientOffset: this.offset,
      });
      return false;
    }
    this.partQueue = [];
    this.tail = [];
    this.tailBytes = 0;
    this.offset = serverOffset;
    this.lastServerOffset = serverOffset;
    this.totalBytes = serverOffset;
    this.nextPartNumber = serverOffset / PART_SIZE + 1;
    this.error = null;
    this.lastErrorCode = null;
    this.stalled = false;
    this.isPaused = false;
    this.status = "uploading";
    this.emitTelemetry("upload_gap_resend_prepared", { serverOffset });
    return true;
  }

  /**
   * Sends the remaining tail as the final part and asks the server to
   * assemble the file. The server refuses if it does not hold exactly
   * `totalBytes`, so a lost part cannot become a short recording.
   */
  async finalize() {
    if (this.status === "completed") return;
    if (this.isFinalizing) throw new Error("Already finalizing");
    this.isFinalizing = true;
    this.status = "finalizing";
    this.emitTelemetry("upload_finalize_started");
    this.scheduleJournalPersist({ force: true });
    try {
      if (this.totalBytes === 0) {
        this.setUploaderError("server-offset-0");
        throw new Error("Finalize failed: nothing was recorded.");
      }
      if (this.tailBytes > 0) {
        this.enqueuePart(new Blob(this.tail));
        this.tail = [];
        this.tailBytes = 0;
      }
      await this.waitForPendingUploads();
      if (this.partQueue.length > 0) {
        if (this.status !== "error") {
          this.setUploaderError("finalize-queue-not-drained");
        }
        throw new Error(
          `Finalize blocked: ${this.partQueue.length} part(s) still queued.`,
        );
      }

      try {
        await this.api("POST", `/uploads/${this.mediaId}/complete`, {
          size: this.totalBytes,
        });
      } catch (err) {
        this.setUploaderError(
          err.body?.error === "size_mismatch"
            ? "finalize-size-mismatch"
            : "finalize-failed",
          err,
          { uploadedBytes: err.body?.uploadedBytes },
        );
        throw err;
      }

      this.status = "completed";
      this.finalizedAt = Date.now();
      this.emitTelemetry("upload_finalize_completed", {
        finalizedBytes: this.totalBytes,
      });
      this.emitTelemetry("upload_complete_client", {
        finalizedBytes: this.totalBytes,
      });
      this.stopHeartbeat();
      await this.clearUploadJournal();
      this.notifyStateChange("finalize-completed");
    } finally {
      this.isFinalizing = false;
    }
  }

  pause() {
    this.isPaused = true;
    if (this.status !== "completed" && this.status !== "error") {
      this.status = "paused";
    }
    this.scheduleJournalPersist();
  }

  resume() {
    const recovering =
      this.status === "error" && this.lastErrorCode === "queue-upload-failed";
    if (!this.isPaused && !recovering) return;
    if (recovering) {
      this.error = null;
      this.lastErrorCode = null;
      this.stalled = false;
    }
    this.isPaused = false;
    if (this.status === "paused" || recovering) this.status = "uploading";
    this.processQueue();
    this.emitTelemetry("upload_resumed", {
      reason: recovering ? "error-recovery" : "client-resume",
    });
    this.scheduleJournalPersist();
  }

  /**
   * Stops uploading and forgets local state. The server's copy is removed by
   * the recorder's delete call, not from here.
   */
  async abort(reason = null) {
    this.isPaused = true;
    this.status = "aborted";
    this.partQueue = [];
    this.tail = [];
    this.tailBytes = 0;
    this.totalBytes = 0;
    this.inFlight?.abort();
    this.stopHeartbeat();
    this.emitTelemetry("upload_cancelled", {
      reason: reason || "uploader-abort",
    });
    await this.clearUploadJournal();
    this.notifyStateChange("aborted");
  }

  // --- heartbeat ---------------------------------------------------------
  // Reports a stall and keeps retrying, so an upload survives a dead link for
  // as long as the recorder keeps the instance alive.

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.partQueue.length || this.isPaused) return;
      const diff = Date.now() - this.lastProgressAt;
      if (diff < STALL_MS) return;

      if (!this.stalled) {
        this.stalled = true;
        this.emitTelemetry("upload_stalled", {
          stallMs: diff,
          queueLength: this.partQueue.length,
        });
        this.scheduleJournalPersist({ force: true });
        if (typeof this.onStall === "function") {
          this.onStall({
            mediaId: this.mediaId,
            videoId: this.videoId,
            offset: this.offset,
            diff,
          });
        }
      }
      // Drop a hung request and start the queue again.
      this.inFlight?.abort();
      this.resume();
    }, HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
