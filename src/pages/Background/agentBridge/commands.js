// Recorder actions an agent can request. Each one goes through the same
// messages the keyboard shortcuts send (onCommandListener.js), so every gate a
// human start passes through (permissions, quota, countdown, the popup's
// mode/mic/camera settings) applies to an agent start too.
import { getCurrentTab, sendMessageTab } from "../tabManagement";
import { sendMessageRecord } from "../recording/sendMessageRecord.js";
import { sendMessageEnsuringContentScript } from "../utils/executeScripts";
import { AgentBridgeError, AgentErrorCode } from "./errors";

const POLL_MS = 250;
// pendingRecording can clear a beat before recording flips true on a healthy
// start, so only call it a failure once it has stayed clear this long.
const PENDING_CLEARED_GRACE_MS = 2000;
// Stop hands off to the content-script pill; if that tab didn't act, go
// straight to the recorder like the shortcut's fallback does.
const STOP_DIRECT_FALLBACK_MS = 3000;
const EDITOR_WAIT_MS = 15000;
const PAUSE_WAIT_MS = 8000;
const OPTIONAL_PERMISSIONS = ["desktopCapture", "offscreen", "alarms"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clampTimeout = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 1000 || value > 120000) {
    throw new AgentBridgeError(
      AgentErrorCode.InvalidParams,
      "timeoutMs must be an integer between 1000 and 120000",
    );
  }
  return value;
};

// Polls storage until check() returns a value or the deadline passes (null).
const waitFor = async (keys, check, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await chrome.storage.local.get(keys);
    const result = await check(snap);
    if (result) return result;
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
};

// Same exclusions as the start-recording shortcut; that path opens the
// playground instead, which would surprise an agent, so we refuse.
const isRecordableUrl = (url) => {
  const u = String(url || "");
  if (u.startsWith("chrome://")) return false;
  if (
    u.startsWith("chrome-extension://") &&
    !u.includes("/playground.html") &&
    !u.includes("/setup.html")
  ) {
    return false;
  }
  return (
    !u.includes("stackoverflow.com/") &&
    !u.includes("chrome.google.com/webstore") &&
    !u.includes("chromewebstore.google.com")
  );
};

const resolveTab = async (tabId) => {
  if (tabId !== undefined && tabId !== null) {
    if (!Number.isInteger(tabId)) {
      throw new AgentBridgeError(AgentErrorCode.InvalidParams, "tabId must be an integer");
    }
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      throw new AgentBridgeError(AgentErrorCode.NoTargetTab, `No tab with id ${tabId}`);
    }
  }
  const tab = await getCurrentTab();
  if (!tab?.id) {
    throw new AgentBridgeError(
      AgentErrorCode.NoTargetTab,
      "No active tab in the last focused window",
    );
  }
  return tab;
};

const describeTab = (tab) =>
  tab ? { id: tab.id, windowId: tab.windowId, url: tab.url || null, title: tab.title || null } : null;

const grantedPermissions = async () => {
  const entries = await Promise.all(
    OPTIONAL_PERMISSIONS.map(async (permission) => [
      permission,
      await chrome.permissions.contains({ permissions: [permission] }),
    ]),
  );
  return Object.fromEntries(entries);
};

const recorderState = (snap) => {
  if (snap.restarting) return "restarting";
  if (snap.recording) return snap.paused ? "paused" : "recording";
  if (snap.pendingRecording) return "starting";
  return "idle";
};

const STATE_KEYS = [
  "recording",
  "pendingRecording",
  "restarting",
  "paused",
  "recordingType",
  "recordingUiTabId",
  "recordingStartTime",
];

const getStatus = async () => {
  const snap = await chrome.storage.local.get(STATE_KEYS);
  const manifest = chrome.runtime.getManifest();
  return {
    state: recorderState(snap),
    recordingType: snap.recordingType || null,
    recordingUiTabId: snap.recordingUiTabId ?? null,
    recordingStartTime: snap.recordingStartTime ?? null,
    activeTab: describeTab(await getCurrentTab()),
    permissions: await grantedPermissions(),
    extension: { id: chrome.runtime.id, version: manifest.version },
    editor: process.env.RECORDFUL_EDITOR,
  };
};

const startRecording = async ({ tabId, timeoutMs } = {}) => {
  const timeout = clampTimeout(timeoutMs, 30000);
  const before = await chrome.storage.local.get(STATE_KEYS);
  if (before.recording || before.pendingRecording || before.restarting) {
    throw new AgentBridgeError(
      AgentErrorCode.AlreadyRecording,
      `Recorder is ${recorderState(before)}; stop it first`,
    );
  }

  const tab = await resolveTab(tabId);
  if (!isRecordableUrl(tab.url)) {
    throw new AgentBridgeError(
      AgentErrorCode.TabNotRecordable,
      "Recordful can't record this page (browser pages and the Web Store block extensions). Navigate to the app first.",
      { url: tab.url || null },
    );
  }
  if (tabId !== undefined && tabId !== null) {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  }

  // storage.onChanged sees every transition; polling alone can miss a
  // pending flag that sets and clears between ticks.
  let sawPending = false;
  let pendingClearedAt = null;
  const onChanged = (changes, area) => {
    if (area !== "local" || !changes.pendingRecording) return;
    if (changes.pendingRecording.newValue) {
      sawPending = true;
      pendingClearedAt = null;
    } else if (sawPending) {
      pendingClearedAt = Date.now();
    }
  };
  chrome.storage.onChanged.addListener(onChanged);

  const requestedAt = Date.now();
  try {
    await sendMessageEnsuringContentScript(tab.id, { type: "start-stream" });

    const outcome = await waitFor(
      ["recording", "pendingRecording"],
      (snap) => {
        if (snap.recording) return "recording";
        if (snap.pendingRecording) sawPending = true;
        if (
          pendingClearedAt !== null &&
          Date.now() - pendingClearedAt > PENDING_CLEARED_GRACE_MS
        ) {
          return "failed";
        }
        return null;
      },
      timeout,
    );

    const after = await chrome.storage.local.get([
      ...STATE_KEYS,
      "lastCountdownFinishedDecision",
    ]);
    const base = {
      tabId: tab.id,
      recordingType: after.recordingType || null,
      waitedMs: Date.now() - requestedAt,
    };

    if (outcome === "recording") {
      return { outcome: "recording", ...base, recordingStartTime: after.recordingStartTime ?? null };
    }
    if (outcome === "failed") {
      throw new AgentBridgeError(
        AgentErrorCode.StartFailed,
        "Recordful began starting and then gave up. A prompt on the page (Chrome capture permissions, sign-in, storage) probably needs a human click.",
        { ...base, lastCountdownFinishedDecision: after.lastCountdownFinishedDecision || null },
      );
    }
    if (sawPending || after.pendingRecording) {
      // Not an error: the start is alive, just waiting on something.
      return {
        outcome: "pending",
        ...base,
        hint:
          after.recordingType === "screen"
            ? "Chrome's screen-share picker is most likely waiting for the user to choose what to share."
            : "Chrome only allows tab capture after the user has invoked Recordful on this tab (clicked its toolbar icon or pressed its shortcut). If they haven't, the start stalls here: ask them to do that, then retry.",
      };
    }
    throw new AgentBridgeError(
      AgentErrorCode.StartFailed,
      "Recordful never began starting. The page may be showing a prompt that needs a human click, or the content script is blocked on this page.",
      base,
    );
  } finally {
    chrome.storage.onChanged.removeListener(onChanged);
  }
};

const stopRecording = async ({ timeoutMs } = {}) => {
  const timeout = clampTimeout(timeoutMs, 30000);
  const before = await chrome.storage.local.get([...STATE_KEYS, "sandboxTab"]);
  if (!before.recording) {
    throw new AgentBridgeError(
      AgentErrorCode.NotRecording,
      before.pendingRecording
        ? "The recorder is still starting; wait for it before stopping"
        : "No recording in progress",
    );
  }

  const message = { type: "stop-recording-tab", reason: "agent-stop" };
  const targetTabId = before.recordingUiTabId || (await getCurrentTab())?.id;
  const startedAt = Date.now();
  let sentDirect = false;
  try {
    await sendMessageTab(targetTabId, message);
  } catch {
    await sendMessageRecord(message).catch(() => {});
    sentDirect = true;
  }

  const stopped = await waitFor(
    ["recording"],
    async (snap) => {
      if (!snap.recording) return true;
      if (!sentDirect && Date.now() - startedAt > STOP_DIRECT_FALLBACK_MS) {
        sentDirect = true;
        await sendMessageRecord(message).catch(() => {});
      }
      return false;
    },
    timeout,
  );
  if (!stopped) {
    throw new AgentBridgeError(
      AgentErrorCode.StopFailed,
      `Recording still running after ${timeout}ms`,
    );
  }

  // The editor opens after the recording finalizes; report it when it shows.
  const editorTabId = await waitFor(
    ["sandboxTab"],
    (snap) =>
      Number.isInteger(snap.sandboxTab) && snap.sandboxTab !== before.sandboxTab
        ? snap.sandboxTab
        : null,
    EDITOR_WAIT_MS,
  );
  let editorTab = null;
  if (editorTabId) {
    editorTab = await chrome.tabs.get(editorTabId).catch(() => null);
  }
  return {
    outcome: "stopped",
    editorTabId: editorTabId || null,
    editorUrl: editorTab?.url || null,
    hint: editorTabId ? undefined : "The editor had not opened yet; it may still be finalizing the recording.",
  };
};

const setPaused = async (wantPaused) => {
  const before = await chrome.storage.local.get(STATE_KEYS);
  if (!before.recording) {
    throw new AgentBridgeError(AgentErrorCode.NotRecording, "No recording in progress");
  }
  if (Boolean(before.paused) === wantPaused) {
    return { outcome: wantPaused ? "paused" : "recording", changed: false };
  }

  // The pill's toggle keeps its own UI state in sync; the direct recorder
  // message is only for when the pill's tab is gone.
  const targetTabId = before.recordingUiTabId || (await getCurrentTab())?.id;
  try {
    await sendMessageTab(targetTabId, { type: "pause-recording" });
  } catch {
    await sendMessageRecord({
      type: wantPaused ? "pause-recording-tab" : "resume-recording-tab",
    }).catch(() => {});
  }

  const ok = await waitFor(
    ["paused"],
    (snap) => Boolean(snap.paused) === wantPaused,
    PAUSE_WAIT_MS,
  );
  if (!ok) {
    throw new AgentBridgeError(
      AgentErrorCode.Internal,
      `${wantPaused ? "Pause" : "Resume"} did not take effect within ${PAUSE_WAIT_MS}ms`,
    );
  }
  return { outcome: wantPaused ? "paused" : "recording", changed: true };
};

// Answers the Phase 0 question directly: can the worker get a tab-capture
// stream with no user gesture? The ID is never consumed and expires on its own.
const probeCapture = async ({ tabId } = {}) => {
  const snap = await chrome.storage.local.get(STATE_KEYS);
  if (snap.recording || snap.pendingRecording || snap.restarting) {
    throw new AgentBridgeError(
      AgentErrorCode.AlreadyRecording,
      "Probing would interfere with the running recording",
    );
  }
  const tab = await resolveTab(tabId);
  const tabCapture = await new Promise((resolve) => {
    try {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: Boolean(streamId), error: streamId ? null : "empty stream id" });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err?.message || err) });
    }
  });
  return {
    tab: describeTab(tab),
    recordable: isRecordableUrl(tab.url),
    tabCapture,
    permissions: await grantedPermissions(),
    recordingType: snap.recordingType || null,
  };
};

export const commands = {
  "status.get": { run: getStatus, exclusive: false },
  "recording.start": { run: startRecording, exclusive: true },
  "recording.stop": { run: stopRecording, exclusive: true },
  "recording.pause": { run: () => setPaused(true), exclusive: true },
  "recording.resume": { run: () => setPaused(false), exclusive: true },
  "capture.probe": { run: probeCapture, exclusive: true },
};
