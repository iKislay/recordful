// Backfills content scripts into tabs that were already open at install/update.
// Manifest content_scripts only auto-inject on future page loads, so without
// this those tabs can't record until they're reloaded.
//
// Paced deliberately: the bundle is ~1MB, and injecting it into every open tab
// at once has each tab's renderer parse, execute and mount the React tree
// simultaneously. With a couple of dozen tabs that saturates the CPU and the
// whole browser goes sluggish, tab switching included.
const INJECT_CONCURRENCY = 3;
// Long tail: one at a time with a gap, so a few hundred stale tabs cost
// background time instead of a pinned CPU.
const BACKFILL_CONCURRENCY = 1;
const BACKFILL_GAP_MS = 250;
// sendMessage never settles while a tab is still loading, so an unbounded
// ping parks a worker forever. Shorter on the click path.
const PING_TIMEOUT_MS = 750;
const BACKFILL_PING_TIMEOUT_MS = 2000;


// executeScript resolves as a promise only when no callback is passed. The
// callback form returns undefined, so awaiting these used to wait on nothing.
// Restricted or closed tabs reject; there's nothing to do about those.
const injectInto = (tabId, files) =>
  chrome.scripting
    .executeScript({ target: { tabId }, files })
    .catch(() => {});

const runPool = async (jobs, limit) => {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, jobs.length) },
    async () => {
      while (next < jobs.length) {
        const job = jobs[next];
        next += 1;
        await job();
      }
    },
  );
  await Promise.all(workers);
};

// A reload orphans every tab's content script, and the clicked tab shouldn't
// wait behind the backfill queue.
export const injectContentScriptIntoTab = async (tabId) => {
  if (typeof tabId !== "number") return false;
  const contentScripts = chrome.runtime.getManifest().content_scripts || [];
  const files = contentScripts.flatMap((cs) => cs.js || []);
  if (files.length === 0) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
    return true;
  } catch {
    return false;
  }
};

// Pings first: a blind send to a loading tab hangs instead of erroring, which
// is what made the popup take minutes. A resend would toggle the popup twice.
export const sendMessageEnsuringContentScript = async (tabId, message) => {
  const { sendMessageTab } = await import("../tabManagement");
  if (!(await hasContentScript(tabId))) {
    if (!(await injectContentScriptIntoTab(tabId))) {
      throw new Error(`content script injection failed for tab ${tabId}`);
    }
  }
  return sendMessageTab(tabId, message);
};

// Recently-used first. Sinks collapsed-group tabs without needing the
// tabGroups permission to identify them.
const injectionPriority = (tab, focusedWindowId) => {
  if (tab.active) return 0;
  if (focusedWindowId != null && tab.windowId === focusedWindowId) return 1;
  return 2;
};

// Skips the ~1MB re-parse when the script is already there. Only absence
// reads "Receiving end does not exist", so any other reply means it is.
// A timeout counts as absent. Injection is deduped by
// window.__recordfulContentBootstrapped, so guessing wrong costs one parse.
const hasContentScript = async (tabId, timeoutMs = PING_TIMEOUT_MS) => {
  const { sendMessageTab } = await import("../tabManagement");
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const result = await Promise.race([
      sendMessageTab(tabId, { type: "recordful-ping" }).then(
        () => "present",
        (err) =>
          String(err).includes("Receiving end does not exist")
            ? "absent"
            : "present",
      ),
      timeout,
    ]);
    return result === "present";
  } finally {
    clearTimeout(timer);
  }
};

// Recording start is latency-critical and runs on this same worker. Backfilling
// hundreds of tabs alongside it is what the user feels.
const recordingInFlight = async () => {
  try {
    const s = await chrome.storage.local.get([
      "recording",
      "pendingRecording",
      "restarting",
    ]);
    return Boolean(s.recording || s.pendingRecording || s.restarting);
  } catch {
    return false;
  }
};

const injectIfMissing = async (tabId, files, gapMs = 0) => {
  // gapMs > 0 marks the background tier, which waits out a live recording.
  while (gapMs > 0 && (await recordingInFlight())) {
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (await hasContentScript(tabId, gapMs > 0 ? BACKFILL_PING_TIMEOUT_MS : PING_TIMEOUT_MS))
    return;
  await injectInto(tabId, files);
  if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
};

export const executeScripts = async () => {
  const contentScripts = chrome.runtime.getManifest().content_scripts;
  const tabQueries = contentScripts.map((cs) =>
    chrome.tabs.query({ url: cs.matches })
  );
  const tabResults = await Promise.all(tabQueries);

  let focusedWindowId = null;
  try {
    focusedWindowId = (await chrome.windows.getLastFocused()).id;
  } catch {}

  const urgent = [];
  const background = [];
  for (let i = 0; i < tabResults.length; i++) {
    const cs = contentScripts[i];
    // Discarded and unloaded tabs have no renderer to inject into, and the
    // manifest registration covers them whenever they do load. Injecting here
    // would only wake tabs Chrome deliberately put to sleep.
    const tabs = tabResults[i].filter(
      (tab) =>
        typeof tab.id === "number" && !tab.discarded && tab.status !== "unloaded",
    );
    tabs.sort((a, b) => {
      const byTier =
        injectionPriority(a, focusedWindowId) -
        injectionPriority(b, focusedWindowId);
      if (byTier !== 0) return byTier;
      return (b.lastAccessed || 0) - (a.lastAccessed || 0);
    });
    for (const tab of tabs) {
      if (injectionPriority(tab, focusedWindowId) === 0) {
        urgent.push(() => injectIfMissing(tab.id, cs.js));
      } else {
        background.push(() => injectIfMissing(tab.id, cs.js, BACKFILL_GAP_MS));
      }
    }
  }

  await runPool(urgent, INJECT_CONCURRENCY);
  // Not awaited: tabs the trickle hasn't reached get injected on demand by
  // whatever needs them.
  void runPool(background, BACKFILL_CONCURRENCY);
};
