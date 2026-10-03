// Builds a diagnostic ZIP. Returns { blob, filename }. JSZip lives in
// the BG (make-zip handler) so the ~100 KB dep doesn't ship into every
// content script.
import { getStartFlowTrace } from "./startFlowTrace";

// Strip user-home paths and URL query/fragments (recording IDs,
// signed-URL tokens) before the zip leaves the machine.
const PII_REPLACEMENTS = [
  [/\/Users\/[^/\s"]+/g, "/Users/[redacted]"],
  [/\/home\/[^/\s"]+/g, "/home/[redacted]"],
  [/[A-Z]:\\Users\\[^\\\s"]+/g, "C:\\Users\\[redacted]"],
  [/(https?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/g, "$1?[query-redacted]"],
  [/(https?:\/\/[^\s#"'<>]+)#[^\s"'<>]*/g, "$1#[fragment-redacted]"],
  [/(chrome-extension:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/g, "$1?[query-redacted]"],
  [/(chrome-extension:\/\/[^\s#"'<>]+)#[^\s"'<>]*/g, "$1#[fragment-redacted]"],
];

const redactString = (s) => {
  let out = s;
  for (const [pat, repl] of PII_REPLACEMENTS) {
    out = out.replace(pat, repl);
  }
  return out;
};

const redactPii = (value, depth = 0) => {
  if (depth > 12) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactPii(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactPii(v, depth + 1);
    }
    return out;
  }
  return value;
};

const FAST_RECORDER_KEYS = [
  "fastRecorderBeta",
  "fastRecorderDecision",
  "fastRecorderDisabledForDevice",
  "fastRecorderDisabledReason",
  "fastRecorderDisabledDetails",
  "fastRecorderDisabledAt",
  "fastRecorderProbe",
  "fastRecorderValidation",
  "fastRecorderValidationFailed",
  "fastRecorderInUse",
  "fastRecorderSelectedEncoder",
  "useWebCodecsRecorder",
  "lastWebCodecsFailureAt",
  "lastWebCodecsFailureCode",
  // Detailed WebCodecs failure payload (framesEncoded, firstChunkSeen,
  // queue/flush stats). Key for diagnosing zero-frame / 28-byte-ftyp bugs.
  "lastWebCodecsFailureDetail",
  // HW→SW retry succeeded mid-session (Teams/Zoom/NVIDIA contention).
  "lastWebCodecsSwRetry",
  // Stop classification: separates low-storage from generic chunk-save-failed.
  "lastRecorderStopReason",
  "lastRecorderStopAt",
  // Mid-stream track-end (monitor unplug, tab close, "Stop sharing").
  // Includes savedChunks/duration/label/readyState to reconstruct from zip.
  "lastTrackEndEvent",
  "lastFailedValidation",
  "webcodecsConstructSnapshot",
  "recorderStartTimings",
  // Names the startup step a dead start hung on.
  "recorderStartProgress",
  // Chunks and bytes captured so far. Splits a stuck UI from a dead start.
  "recorderLiveProgress",
  // offscreen-diag carries this too but is console-only, so a start that
  // died on stream acquisition was unreadable from a zip.
  "lastStreamAcquireError",
  // Which start-dispatch branch ran (offscreen gDM, pre-acquired tab, picker).
  "lastStartDispatchBranch",
  "countdownFinishedAt",
  "lastStartRecordingCaller",
  "lastCountdownFinishedDecision",
  "lastStartAfterCountdown",
  "lastSubscriptionLoss",
];

// navigator.userAgent is reduced to Chrome/150.0.0.0; only the high-entropy
// hints carry the real build.
const readBrowserVersionDetail = async () => {
  try {
    const uaData = navigator.userAgentData;
    if (!uaData?.getHighEntropyValues) return null;
    const hints = await uaData.getHighEntropyValues([
      "fullVersionList",
      "platformVersion",
    ]);
    return {
      fullVersionList: hints?.fullVersionList || null,
      platformVersion: hints?.platformVersion || null,
    };
  } catch {
    return null;
  }
};

// A full disk fails every storage.set and OPFS write silently (those call
// sites swallow), so probe a real write as well as the quota.
const readStorageHealth = async () => {
  const out = { quotaBytes: null, usageBytes: null, writeOk: null };
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      out.quotaBytes = est.quota ?? null;
      out.usageBytes = est.usage ?? null;
    }
  } catch {}
  try {
    const probe = `diag-write-probe-${Date.now()}`;
    await chrome.storage.local.set({ diagWriteProbe: probe });
    const back = await chrome.storage.local.get(["diagWriteProbe"]);
    out.writeOk = back?.diagWriteProbe === probe;
    await chrome.storage.local.remove(["diagWriteProbe"]);
  } catch {
    out.writeOk = false;
  }
  return out;
};

// Enough to tell whether this profile has ever recorded, and how.
const LAST_RECORDING_KEYS = [
  "lastRecordingType",
  "lastRecordingBackendRef",
  "lastRecorderStopReason",
  "lastRecorderStopAt",
  "editorReadyAt",
  "editorReadyPath",
  "extensionInstalledAt",
];

export const buildDiagnosticZip = async ({
  extraConfig = {},
  source = "unknown",
} = {}) => {
  const userAgent = navigator.userAgent;

  const [
    platformInfo,
    diagData,
    fastRecorderData,
    lifecycleData,
    perfTimeline,
    uploadTelemetry,
    storageHealth,
    lastRecording,
  ] = await Promise.all([
      chrome.runtime.sendMessage({ type: "get-platform-info" }),
      chrome.runtime.sendMessage({ type: "get-diagnostic-log" }),
      new Promise((resolve) =>
        chrome.storage.local.get(FAST_RECORDER_KEYS, resolve),
      ),
      new Promise((resolve) =>
        chrome.storage.local.get(["lifecycleLog"], (r) =>
          resolve(Array.isArray(r?.lifecycleLog) ? r.lifecycleLog : []),
        ),
      ),
      new Promise((resolve) =>
        // Merge per-context perfTimeline.* keys by timestamp.
        chrome.storage.local.get(null, (all) => {
          const merged = [];
          for (const k of Object.keys(all || {})) {
            if (k === "perfTimeline" || k.startsWith("perfTimeline.")) {
              const arr = all[k];
              if (Array.isArray(arr)) merged.push(...arr);
            }
          }
          merged.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
          resolve(merged);
        }),
      ),
      new Promise((resolve) =>
        chrome.storage.local.get(["cloudUploadTelemetryEvents"], (r) =>
          resolve(
            Array.isArray(r?.cloudUploadTelemetryEvents)
              ? r.cloudUploadTelemetryEvents
              : [],
          ),
        ),
      ),
      readStorageHealth(),
      new Promise((resolve) =>
        chrome.storage.local.get(LAST_RECORDING_KEYS, resolve),
      ),
    ]);

  const manifestVersion = chrome.runtime.getManifest().version;
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const files = {};

  files["manifest.json"] = JSON.stringify({
    extensionVersion: manifestVersion,
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    chromeVersion: /Chrome\/([\d.]+)/.exec(userAgent)?.[1] || null,
    source,
  });

  files["environment.json"] = JSON.stringify({
    userAgent,
    browserVersionDetail: await readBrowserVersionDetail(),
    platformInfo,
    screen: {
      width: window.screen.availWidth,
      height: window.screen.availHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    deviceMemory: navigator.deviceMemory || null,
    storage: storageHealth,
    // Tells a localhost dev build apart from a store build when a report says
    // an API call just failed to fetch.
    apiBase: process.env.RECORDFUL_API_BASE_URL || null,
  });

  files["config.json"] = JSON.stringify({
    fastRecorder: fastRecorderData,
    lastRecording,
    ...extraConfig,
  });

  if (diagData?.log) {
    const annotated =
      typeof structuredClone === "function"
        ? structuredClone(diagData.log)
        : JSON.parse(JSON.stringify(diagData.log));
    if (annotated.sessions) {
      for (const session of annotated.sessions) {
        if (!session.events?.length) continue;
        const hints = [];
        const hasEditorOpen = session.events.some(
          (ev) => ev.e === "editor-open" && ev.d?.type === "editor",
        );
        const hasEditorReady = session.events.some(
          (ev) => ev.e === "editor-load-ready",
        );
        if (hasEditorOpen && !hasEditorReady) {
          hints.push("Editor handoff incomplete: editor opened but never finished loading");
        }
        if (hints.length > 0) session.hints = hints;
      }
    }
    files["sessions.json"] = JSON.stringify(redactPii(annotated));
  }

  if (diagData?.errors) {
    files["errors.json"] = JSON.stringify(redactPii(diagData.errors));
  }

  if (diagData?.flags) {
    files["storage-flags.json"] = JSON.stringify(redactPii(diagData.flags));
  }

  try {
    const trace = await getStartFlowTrace();
    if (trace) {
      files["start-flow-trace.json"] = JSON.stringify(trace);
    }
  } catch {}

  if (Array.isArray(lifecycleData) && lifecycleData.length > 0) {
    files["lifecycle-log.json"] = JSON.stringify(lifecycleData);
  }

  if (Array.isArray(perfTimeline) && perfTimeline.length > 0) {
    files["perf-timeline.json"] = JSON.stringify(perfTimeline);
  }

  if (Array.isArray(uploadTelemetry) && uploadTelemetry.length > 0) {
    files["upload-telemetry.json"] = JSON.stringify(redactPii(uploadTelemetry));
  }

  const filename = `recordful-diagnostics-${ts}.zip`;

  const resp = await chrome.runtime.sendMessage({
    type: "make-zip",
    files,
    filename,
  });
  if (!resp?.ok || typeof resp.base64 !== "string") {
    throw new Error(
      `make-zip failed: ${resp?.error || "no response from background"}`,
    );
  }
  // base64 over the message channel; structured-clone of ArrayBuffer
  // is unreliable across MV3 contexts.
  const bin = atob(resp.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/zip" });
  return { blob, filename: resp.filename || filename };
};
