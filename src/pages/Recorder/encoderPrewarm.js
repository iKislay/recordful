// Encoder pre-warm. OS encode services (VTDecoderXPCService etc) need
// a few frames before the HW pipeline locks in; diag showed real
// recordings' first ~30 frames running at 6-9fps before settling at
// 30fps. Opens a VideoEncoder with the real config, bursts synthetic
// frames, closes. Fire-and-forget; failure no-ops.
//
// With warm-adopt on (off by default) it keeps the encoder open for the
// recording to adopt instead, since close/reopen loses the session ramp.

import { perfMark, perfSpan } from "../utils/perfMarks";
import {
  PREWARM_MIN_WARM_CHUNKS,
  PREWARM_UNCLAIMED_MAX_MS,
  canAdoptPrewarmedEncoder,
  evaluatePrewarmProgress,
  shouldInvalidateDecoderConfig,
  shouldReconfigureAdoptedEncoder,
} from "./webcodecs/recorderLogic";
import {
  isEncoderPrewarmEnabled,
  isWarmAdoptEnabled,
  loadStartupFlags,
} from "./webcodecs/startupFlags";

let _activeWarmer = null;

const computeFramerate = (config) => {
  const fps = Number(config?.framerate);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) return 30;
  return Math.round(fps);
};

const synthesizeAndEncode = (encoder, canvas, ctx, index, framerate, keyFrame) => {
  // Vary content per frame so the encoder exercises the pipeline
  // instead of emitting empty deltas.
  const hue = (index * 17) % 360;
  ctx.fillStyle = `hsl(${hue}, 50%, 35%)`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `hsl(${(hue + 180) % 360}, 50%, 60%)`;
  ctx.fillRect(
    (index % 8) * (canvas.width / 8),
    (index % 6) * (canvas.height / 6),
    canvas.width / 8,
    canvas.height / 6,
  );
  const tsUs = Math.round((index * 1_000_000) / framerate);
  const frame = new VideoFrame(canvas, {
    timestamp: tsUs,
    duration: Math.round(1_000_000 / framerate),
  });
  try {
    encoder.encode(frame, { keyFrame });
  } finally {
    frame.close();
  }
};

const queueSizeOf = (encoder) => {
  try {
    return encoder?.encodeQueueSize ?? 0;
  } catch {
    return 0;
  }
};

/**
 * Open a VideoEncoder, warm it until its encode session has ramped, drain it,
 * and keep it open for adoption. Returns a handle with .close(). Idempotent:
 * a second call while one is active returns the active handle.
 *
 * @param {object} cfg
 * @param {number} cfg.width
 * @param {number} cfg.height
 * @param {string} cfg.codec  e.g. "avc1.64002A"
 * @param {number} [cfg.bitrate]
 * @param {number} [cfg.framerate]
 * @returns {Promise<{close: () => Promise<void>, chunks: number, ok: boolean, warm: boolean}|null>}
 */
export const startEncoderPrewarm = async (cfg) => {
  if (_activeWarmer) return _activeWarmer.handle;
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined" || typeof OffscreenCanvas === "undefined") {
    perfMark("Recorder.encoderPrewarm.skipped", { reason: "no-webcodecs" });
    return null;
  }
  if (!cfg || !cfg.width || !cfg.height || !cfg.codec) {
    perfMark("Recorder.encoderPrewarm.skipped", { reason: "no-config" });
    return null;
  }

  const endStart = perfSpan("Recorder.encoderPrewarm.start", {
    w: cfg.width,
    h: cfg.height,
    codec: cfg.codec,
  });

  const state = {
    chunks: 0,
    encoder: null,
    canvas: null,
    ctx: null,
    closed: false,
    claimed: false,
    warm: false,
    config: null,
    framerate: computeFramerate(cfg),
    unclaimedTimer: null,
    // VideoEncoder callbacks are fixed at construction, so everything routes
    // through these: discarded during warmup, swapped to the recorder's on
    // adoption.
    sink: null,
    errorSink: null,
    // Chrome emits decoderConfig (SPS/PPS) only when the reported config
    // changes, so the warm encoder spends it on the discard sink. Keep it to
    // replay for the adopting muxer.
    warmDecoderConfig: null,
  };
  _activeWarmer = state;

  const handle = {
    /** Close the prewarm encoder. Safe to call multiple times. No-op once claimed. */
    close: async () => {
      if (state.closed || state.claimed) return;
      state.closed = true;
      if (state.unclaimedTimer) {
        clearTimeout(state.unclaimedTimer);
        state.unclaimedTimer = null;
      }
      if (state.encoder) {
        try {
          state.encoder.close();
        } catch {}
        state.encoder = null;
      }
      if (_activeWarmer === state) _activeWarmer = null;
      perfMark("Recorder.encoderPrewarm.closed", { chunks: state.chunks });
    },
    get chunks() {
      return state.chunks;
    },
    get warm() {
      return state.warm;
    },
    get ok() {
      return state.encoder != null && state.chunks > 0;
    },
  };
  state.handle = handle;

  // Nothing may await between the guard above and `_activeWarmer = state`:
  // two concurrent starts would both pass it and orphan the loser's encoder.
  // Flags load async, so wait for them here (250ms cap) instead of racing
  // them at their defaults on every recording.
  try {
    await Promise.race([
      loadStartupFlags(),
      new Promise((resolve) => setTimeout(resolve, 250)),
    ]);
  } catch {}
  if (!isEncoderPrewarmEnabled() || state.closed) {
    if (_activeWarmer === state) _activeWarmer = null;
    endStart({ ok: false, reason: "disabled" });
    perfMark("Recorder.encoderPrewarm.skipped", { reason: "disabled" });
    return null;
  }

  try {
    state.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        state.chunks += 1;
        if (!state.warmDecoderConfig && meta?.decoderConfig) {
          state.warmDecoderConfig = meta.decoderConfig;
        }
        state.sink?.(chunk, meta);
      },
      error: (err) => {
        if (state.errorSink) {
          state.errorSink(err);
          return;
        }
        perfMark("Recorder.encoderPrewarm.encoderError", {
          msg: String(err?.message || err).slice(0, 120),
        });
      },
    });
    const config = {
      codec: cfg.codec,
      width: cfg.width,
      height: cfg.height,
      bitrate: Math.max(500_000, Number(cfg.bitrate) || 4_000_000),
      framerate: state.framerate,
      bitrateMode: "constant",
      latencyMode: "realtime",
      hardwareAcceleration: "prefer-hardware",
    };
    state.encoder.configure(config);
    state.config = config;
    state.canvas = new OffscreenCanvas(cfg.width, cfg.height);
    state.ctx = state.canvas.getContext("2d");
    if (!state.ctx) {
      throw new Error("no-canvas-2d-context");
    }

    // Without adoption there's nothing to gain from holding the session open:
    // only the OS encode service needs warming, and it survives the close.
    if (!isWarmAdoptEnabled()) {
      for (let i = 0; i < 6; i += 1) {
        if (state.closed) return handle;
        synthesizeAndEncode(
          state.encoder,
          state.canvas,
          state.ctx,
          i,
          state.framerate,
          i === 0,
        );
      }
      try {
        state.encoder.flush().catch(() => {});
      } catch {}
      await handle.close();
      endStart({ chunks: state.chunks, ok: state.chunks > 0, mode: "burst" });
      return handle;
    }

    // Feed until the session has ramped or a bound trips. No keep-alive ticker
    // afterwards: a chained sub-second timer on a background tab triggers
    // Chrome's intensive throttling, which makes storage IPCs take 11-19s.
    const startedAt = performance.now();
    let framesFed = 0;
    let stopReason = "feeding";
    for (;;) {
      if (state.closed || state.claimed) return handle;
      const progress = evaluatePrewarmProgress({
        chunksOut: state.chunks,
        queueSize: queueSizeOf(state.encoder),
        framesFed,
        elapsedMs: performance.now() - startedAt,
      });
      if (progress.done) {
        stopReason = progress.reason;
        break;
      }
      // Shallow feed: a deep queue hides whether the encoder has caught up,
      // which is the signal we're waiting on.
      if (queueSizeOf(state.encoder) < 4) {
        synthesizeAndEncode(
          state.encoder,
          state.canvas,
          state.ctx,
          framesFed,
          state.framerate,
          framesFed === 0,
        );
        framesFed += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 4));
    }

    // Drain so the adopting recorder starts at queue 0.
    try {
      await state.encoder.flush();
    } catch {}
    if (state.closed || state.claimed) return handle;

    state.warm =
      state.chunks >= PREWARM_MIN_WARM_CHUNKS &&
      state.encoder?.state === "configured" &&
      queueSizeOf(state.encoder) === 0;

    if (!state.warm) {
      // Never ramped: an open cold encoder is just a held HW slot.
      await handle.close();
      endStart({ chunks: state.chunks, ok: false, reason: stopReason });
      return handle;
    }

    // Safety net for flows that never adopt (MediaRecorder fallback,
    // cancelled start): don't hold the HW slot indefinitely.
    state.unclaimedTimer = setTimeout(() => {
      state.unclaimedTimer = null;
      if (!state.claimed && !state.closed) {
        perfMark("Recorder.encoderPrewarm.unclaimedTimeout", {
          chunks: state.chunks,
        });
        void handle.close();
      }
    }, PREWARM_UNCLAIMED_MAX_MS);

    endStart({ chunks: state.chunks, ok: true, framesFed, reason: stopReason });
    perfMark("Recorder.encoderPrewarm.ready", {
      framerate: state.framerate,
      width: cfg.width,
      height: cfg.height,
      chunks: state.chunks,
      framesFed,
      ms: Math.round(performance.now() - startedAt),
    });
  } catch (err) {
    endStart({ ok: false, error: String(err?.message || err).slice(0, 100) });
    perfMark("Recorder.encoderPrewarm.failed", {
      msg: String(err?.message || err).slice(0, 120),
    });
    if (state.encoder) {
      try {
        state.encoder.close();
      } catch {}
      state.encoder = null;
    }
    if (_activeWarmer === state) _activeWarmer = null;
    return null;
  }

  return handle;
};

/**
 * Take over the warm encoder for a real recording, or dispose it: the caller
 * opens its own straight after, and a lingering warm session contends for the
 * same VideoToolbox slot on macOS.
 *
 * @param {object} config  the recording's VideoEncoderConfig
 * @param {(chunk: any, meta: any) => void} sink  the recorder's output handler
 * @param {(err: any) => void} errorSink  the recorder's error handler
 * @param {{allowAdopt?: boolean, preferSoftware?: boolean}} [opts]
 * @returns {{encoder: any, reconfigured: boolean}|null}
 */
export const claimPrewarmedEncoder = (config, sink, errorSink, opts = {}) => {
  const state = _activeWarmer;
  const adoptable = canAdoptPrewarmedEncoder({
    hasWarmer: Boolean(state),
    warm: Boolean(state?.warm),
    claimed: Boolean(state?.claimed),
    closed: Boolean(state?.closed),
    encoderState: state?.encoder?.state ?? null,
    disabled: !isWarmAdoptEnabled(),
    allowAdopt: opts.allowAdopt !== false,
    preferSoftware:
      opts.preferSoftware === true ||
      config?.hardwareAcceleration === "prefer-software",
  });

  if (!adoptable) {
    if (state) {
      perfMark("Recorder.encoderPrewarm.adoptSkipped", {
        warm: Boolean(state.warm),
        claimed: Boolean(state.claimed),
        encoderState: state.encoder?.state ?? null,
        allowAdopt: opts.allowAdopt !== false,
      });
    }
    // Only a track eligible to adopt may dispose. Cloud starts screen and
    // camera together, and the camera (allowAdopt:false) arriving first would
    // close the warm encoder out from under the screen track's claim.
    if (opts.allowAdopt !== false) {
      void closeActiveEncoderPrewarm();
    }
    return null;
  }

  try {
    // Redirect output/error before any reconfigure so nothing the encoder
    // emits from here on is discarded.
    state.sink = sink || null;
    state.errorSink = errorSink || null;
    // Always reconfigure, even for an identical config. Chrome emits
    // decoderConfig (the SPS/PPS the muxer needs) only when the reported config
    // changes, and the warm encoder already spent that on the discard sink.
    const warmConfigBefore = state.config;
    const dimsChanged = shouldReconfigureAdoptedEncoder(warmConfigBefore, config);
    state.encoder.configure(config);
    state.config = config;
    state.claimed = true;
    if (state.unclaimedTimer) {
      clearTimeout(state.unclaimedTimer);
      state.unclaimedTimer = null;
    }
    const encoder = state.encoder;
    // Ownership passes to the recorder, which closes it at stop.
    _activeWarmer = null;
    perfMark("Recorder.encoderPrewarm.adopted", {
      dimsChanged,
      chunks: state.chunks,
      width: config?.width ?? null,
      height: config?.height ?? null,
    });
    return {
      encoder,
      reconfigured: dimsChanged,
      // Only drop the replay when the SPS is invalidated (codec or coded dims).
      // A bitrate-only reconfigure (the normal cloud case) leaves it correct and
      // Chrome may not re-emit one, so nulling it gives a header-only file.
      decoderConfigFallback: shouldInvalidateDecoderConfig(warmConfigBefore, config)
        ? null
        : state.warmDecoderConfig,
    };
  } catch (err) {
    perfMark("Recorder.encoderPrewarm.adoptFailed", {
      msg: String(err?.message || err).slice(0, 120),
    });
    state.sink = null;
    state.errorSink = null;
    state.claimed = false;
    void closeActiveEncoderPrewarm();
    return null;
  }
};

/** Returns the active prewarm handle if one exists, else null. */
export const getActiveEncoderPrewarm = () => _activeWarmer?.handle || null;

/** Synchronously close any active prewarm. Safe at any time. */
export const closeActiveEncoderPrewarm = async () => {
  const h = getActiveEncoderPrewarm();
  if (h) {
    try {
      await h.close();
    } catch {}
  }
};
