// MP4 audio needs AAC and Linux Chromium ships no AAC encoder, so the MP4
// transcode drops the track and hands back a silent file. Polyfill it in wasm.
import {
  Input,
  Output,
  BufferTarget,
  BlobSource,
  Mp4OutputFormat,
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  canEncodeAudio,
} from "mediabunny";

// The polyfill spawns its worker from a blob URL. That works in MV3 today only
// because crbug/1504703 is unpatched, and a CSP block would hang, not throw.
const PROBE_TIMEOUT_MS = 8000;

const PROBE_SAMPLE_RATE = 48000;
const PROBE_CHANNELS = 2;
const PROBE_FRAMES = 1024;
const PROBE_CHUNKS = 4;

const devLog =
  process.env.RECORDFUL_DEV_MODE === "true"
    ? (label, data) => console.log("[remux][aac]", label, data || "")
    : () => {};

let verdict = null;
let resolvedPath = "unresolved";

// Reported on the done message so a silent-audio report shows whether the
// wasm fallback ran at all.
export const getAacPath = () => resolvedPath;

// Encodes silence and reads it back: registerAacEncoder() succeeding proves
// nothing about the wasm worker actually coming up.
const probeAacEncoder = async () => {
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target,
  });
  const source = new AudioSampleSource({ codec: "aac", bitrate: 128000 });
  output.addAudioTrack(source);
  await output.start();

  const silence = new Float32Array(PROBE_FRAMES * PROBE_CHANNELS);
  for (let i = 0; i < PROBE_CHUNKS; i += 1) {
    const sample = new AudioSample({
      data: silence,
      format: "f32",
      numberOfChannels: PROBE_CHANNELS,
      sampleRate: PROBE_SAMPLE_RATE,
      timestamp: (i * PROBE_FRAMES) / PROBE_SAMPLE_RATE,
    });
    await source.add(sample);
    sample.close();
  }

  await output.finalize();

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength === 0) return false;

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(new Blob([buffer])),
  });
  const track = await input.getPrimaryAudioTrack().catch(() => null);
  return track?.codec === "aac";
};

// Machines with native AAC never reach the polyfill, so tests name the worker
// to exercise it anyway. Nothing in the extension sets this.
const FORCE_WORKER_NAME = "recordful-force-aac-polyfill";

// Worker realms only. A page's window.name is attacker-influenceable.
const isForced = () =>
  typeof WorkerGlobalScope !== "undefined" &&
  typeof self !== "undefined" &&
  self.name === FORCE_WORKER_NAME;

const resolveAacEncoder = async () => {
  const forced = isForced();
  try {
    if (!forced && (await canEncodeAudio("aac"))) {
      devLog("native");
      resolvedPath = "native";
      return true;
    }
  } catch {}

  try {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  } catch (err) {
    devLog("register-failed", {
      err: String(err?.message || err).slice(0, 200),
    });
    resolvedPath = "register-failed";
    return false;
  }

  let timer = null;
  try {
    // A blocked worker never settles, so the timeout is the only exit.
    const ok = await Promise.race([
      probeAacEncoder(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
      }),
    ]);
    devLog(ok ? "polyfill-ok" : "polyfill-unusable");
    resolvedPath = ok ? "polyfill" : "polyfill-unusable";
    return ok;
  } catch (err) {
    devLog("probe-failed", {
      err: String(err?.message || err).slice(0, 200),
    });
    resolvedPath = "probe-failed";
    return false;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
};

// Cached for the realm's lifetime: the result is device-global, and a failed
// probe must not be retried per download.
export const ensureAacEncoder = () => {
  if (!verdict) verdict = resolveAacEncoder();
  return verdict;
};
