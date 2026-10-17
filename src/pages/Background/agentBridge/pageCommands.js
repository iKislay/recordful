// Page tools: navigate, snapshot, click, type, press, scroll, waitFor and
// screenshot, performed in the armed tab so an agent with no browser tool of
// its own can walk through a feature while Recordful records it. The work
// inside the page happens in the content script (Content/agentPage), which
// also draws the cursor the video shows; this side picks the tab, carries
// state across navigations and handles what only the worker can do.
import { sendMessageEnsuringContentScript } from "../utils/executeScripts";
import { getArmedTab } from "./armedTab";
import { AgentBridgeError, AgentErrorCode } from "./errors";

// Must match Content/agentPage/index.js.
const PAGE_MESSAGE = "recordful-agent-page";
const REF = /^e[1-9]\d{0,6}$/;
const NAVIGATION_SETTLE_MS = 350;
const NAVIGATION_AFTER_ACTION_MS = 10000;
const WAIT_POLL_MS = 250;
const WAIT_CHECK_TIMEOUT_MS = 2000;
const SCREENSHOT_MAX_WIDTH = 1280;
// Leaves room under the bridge's 1 MiB frame cap for the JSON around it.
const SCREENSHOT_MAX_BASE64 = 900 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Per tab, in memory: where the cursor was (so it doesn't jump after a
// navigation) and which document the agent's refs came from. Lost if the
// worker restarts, which only costs the stale-ref check and cursor continuity.
const cursorByTab = new Map();
const snapshotDocByTab = new Map();

const invalid = (message) => new AgentBridgeError(AgentErrorCode.InvalidParams, message);

const optionalInt = (value, name, min, max, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalid(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const requireRef = (ref) => {
  if (typeof ref !== "string" || !REF.test(ref)) {
    throw invalid('ref must look like "e12", taken from the latest snapshot');
  }
  return ref;
};

const isScriptableUrl = (url) => /^(https?|file):/i.test(String(url || ""));

const describeTab = (tab) => ({ tabId: tab.id, url: tab.url || null, title: tab.title || null });

// The recorded tab while a recording runs (the one with Recordful's pill),
// otherwise the tab the user handed over. Never anything else.
const resolvePageTab = async () => {
  const snap = await chrome.storage.local.get(["recording", "recordingUiTabId"]);
  const armed = await getArmedTab();
  const candidates = [];
  if (snap.recording && Number.isInteger(snap.recordingUiTabId)) {
    candidates.push(snap.recordingUiTabId);
  }
  if (armed) candidates.push(armed.tabId);

  for (const tabId of candidates) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && (isScriptableUrl(tab.url) || tab.status === "loading")) return tab;
  }
  if (candidates.length === 0) {
    throw new AgentBridgeError(
      AgentErrorCode.NotArmed,
      "No tab has been handed to Recordful. Ask the user to click the Recordful toolbar icon on the tab to record.",
      { hint: "Page tools only act on the tab where the user clicked the Recordful icon, or the tab being recorded." },
    );
  }
  const tab = await chrome.tabs.get(candidates[candidates.length - 1]).catch(() => null);
  if (!tab) {
    throw new AgentBridgeError(
      AgentErrorCode.NotArmed,
      "The tab handed to Recordful was closed. Ask the user to click the Recordful icon on the tab to record.",
    );
  }
  throw new AgentBridgeError(
    AgentErrorCode.PageNotScriptable,
    "Recordful can't act on this page (browser pages, the Web Store and error pages block extensions). Navigate to an http(s) page first.",
    { tab: describeTab(tab) },
  );
};

const waitForLoad = async (tabId, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      throw new AgentBridgeError(AgentErrorCode.NavigationFailed, "The tab was closed while loading");
    }
    if (tab.status === "complete") return { tab, loaded: true };
    if (Date.now() >= deadline) return { tab, loaded: false };
    await sleep(100);
  }
};

const isPortClosed = (err) => {
  const message = String(err?.message || err);
  return (
    message.includes("message port closed") ||
    message.includes("message channel closed") ||
    message.includes("Receiving end does not exist") ||
    message.includes("back/forward cache")
  );
};

// Sends one action to the content script and unwraps its reply.
const sendToPage = async (tab, action, params = {}, { checkDoc = false } = {}) => {
  const message = {
    type: PAGE_MESSAGE,
    action,
    params,
    cursor: cursorByTab.get(tab.id) || null,
    expectDocId: checkDoc ? snapshotDocByTab.get(tab.id) || null : null,
  };
  let reply;
  try {
    reply = await sendMessageEnsuringContentScript(tab.id, message);
  } catch (err) {
    const portClosed = isPortClosed(err);
    throw new AgentBridgeError(
      AgentErrorCode.PageNotScriptable,
      portClosed
        ? "The page went away (navigated or reloaded) before it answered."
        : `Recordful couldn't reach this page: ${String(err?.message || err)}`,
      { tab: describeTab(tab), portClosed },
    );
  }
  if (!reply || typeof reply !== "object" || !("ok" in reply)) {
    // Every agent build's content script answers; no answer means the page
    // went away mid-action or it is running an older bundle.
    throw new AgentBridgeError(
      AgentErrorCode.PageNotScriptable,
      "The page didn't answer. If the extension was just reloaded, reload the page.",
      { tab: describeTab(tab) },
    );
  }
  if (reply.cursor) cursorByTab.set(tab.id, reply.cursor);
  if (!reply.ok) {
    const e = reply.error || {};
    throw new AgentBridgeError(e.code || AgentErrorCode.Internal, e.message || "Page action failed", e.data);
  }
  return reply;
};

// After a click or key press: did it start a navigation? Reports it and waits
// for the new page, so the agent's next snapshot sees it.
const settleAfterAction = async (tabId, urlBefore) => {
  await sleep(NAVIGATION_SETTLE_MS);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return null;
  if (tab.status !== "loading" && tab.url === urlBefore) return null;
  if (tab.status !== "loading") {
    return { url: tab.url, title: tab.title || null, sameDocument: true };
  }
  const { tab: loaded, loaded: done } = await waitForLoad(tabId, NAVIGATION_AFTER_ACTION_MS);
  return { url: loaded.url, title: loaded.title || null, loaded: done };
};

// An action that may navigate away, closing the message port before the
// content script answers. That close is the navigation, not a failure.
const actThenSettle = async (tab, action, params, options) => {
  let reply = null;
  try {
    reply = await sendToPage(tab, action, params, options);
  } catch (err) {
    if (!err?.data?.portClosed) throw err;
  }
  const navigation = await settleAfterAction(tab.id, tab.url);
  return {
    ...(reply?.result || { done: true, note: "The page unloaded during the action." }),
    ...(navigation ? { navigation } : {}),
  };
};

const navigate = async ({ url, timeoutMs } = {}) => {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw invalid("url must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalid("url must be an absolute http(s) URL");
  }
  const timeout = optionalInt(timeoutMs, "timeoutMs", 1000, 60000, 20000);
  const tab = await resolvePageTab();
  const startedAt = Date.now();
  try {
    await chrome.tabs.update(tab.id, { url: parsed.href });
  } catch (err) {
    throw new AgentBridgeError(AgentErrorCode.NavigationFailed, String(err?.message || err));
  }
  snapshotDocByTab.delete(tab.id);
  // tabs.update returns before the old page starts unloading.
  await sleep(150);
  const { tab: after, loaded } = await waitForLoad(tab.id, timeout);
  return {
    url: after.url || parsed.href,
    title: after.title || null,
    loaded,
    waitedMs: Date.now() - startedAt,
    ...(loaded ? {} : { hint: "The page was still loading when the wait ran out; it may still be usable." }),
  };
};

const snapshot = async ({ scope } = {}) => {
  if (scope !== undefined && scope !== "page" && scope !== "viewport") {
    throw invalid('scope must be "page" or "viewport"');
  }
  const tab = await resolvePageTab();
  if (tab.status === "loading") await waitForLoad(tab.id, 5000);
  const reply = await sendToPage(tab, "snapshot", { scope: scope || "page" });
  snapshotDocByTab.set(tab.id, reply.docId);
  return { tabId: tab.id, ...reply.result };
};

const click = async ({ ref } = {}) => {
  const tab = await resolvePageTab();
  return actThenSettle(tab, "click", { ref: requireRef(ref) }, { checkDoc: true });
};

const type = async ({ ref, text, clear, delayMs } = {}) => {
  if (typeof text !== "string" || text.length > 2000) {
    throw invalid("text must be a string of at most 2000 characters");
  }
  if (clear !== undefined && typeof clear !== "boolean") throw invalid("clear must be a boolean");
  const tab = await resolvePageTab();
  const reply = await sendToPage(
    tab,
    "type",
    { ref: requireRef(ref), text, clear: Boolean(clear), delayMs: optionalInt(delayMs, "delayMs", 0, 300, 70) },
    { checkDoc: true },
  );
  return reply.result;
};

const press = async ({ key } = {}) => {
  if (typeof key !== "string" || key.length === 0 || key.length > 40) {
    throw invalid('key must be a key name such as "Enter", "Tab" or "Shift+Tab"');
  }
  const tab = await resolvePageTab();
  return actThenSettle(tab, "press", { key });
};

const scroll = async ({ ref, direction, amount } = {}) => {
  if ((ref === undefined) === (direction === undefined)) throw invalid("Give exactly one of ref or direction.");
  if (direction !== undefined && !["up", "down", "left", "right"].includes(direction)) {
    throw invalid('direction must be "up", "down", "left" or "right"');
  }
  const tab = await resolvePageTab();
  const params =
    ref !== undefined
      ? { ref: requireRef(ref) }
      : { direction, amount: optionalInt(amount, "amount", 1, 20000, null) };
  const reply = await sendToPage(tab, "scroll", params, { checkDoc: ref !== undefined });
  return reply.result;
};

// Polls from the worker rather than waiting inside the page, so the wait
// survives the navigations it is often waiting on.
const waitFor = async ({ text, ref, state, timeoutMs } = {}) => {
  if ((text === undefined) === (ref === undefined)) throw invalid("Give exactly one of text or ref.");
  if (text !== undefined && (typeof text !== "string" || !text || text.length > 500)) {
    throw invalid("text must be a non-empty string of at most 500 characters");
  }
  if (state !== undefined && state !== "visible" && state !== "hidden") {
    throw invalid('state must be "visible" or "hidden"');
  }
  const want = state || "visible";
  const timeout = optionalInt(timeoutMs, "timeoutMs", 100, 60000, 10000);
  const params = text !== undefined ? { text, state: want } : { ref: requireRef(ref), state: want };
  const startedAt = Date.now();
  const deadline = startedAt + timeout;
  let lastError = null;

  for (;;) {
    const tab = await resolvePageTab().catch((err) => {
      lastError = err;
      return null;
    });
    if (tab && tab.status !== "loading") {
      try {
        const reply = await Promise.race([
          sendToPage(tab, "check", params, { checkDoc: ref !== undefined }),
          sleep(WAIT_CHECK_TIMEOUT_MS).then(() => null),
        ]);
        if (reply?.result?.satisfied) {
          return { satisfied: true, waitedMs: Date.now() - startedAt, ...reply.result };
        }
      } catch (err) {
        // The element's page is gone: hidden is met, visible never will be.
        if (err?.code === AgentErrorCode.StaleRef) {
          if (want === "hidden") {
            return { satisfied: true, waitedMs: Date.now() - startedAt, gone: true };
          }
          throw err;
        }
        // Between pages there is briefly nothing to ask; keep polling.
        lastError = err;
      }
    }
    if (Date.now() >= deadline) break;
    await sleep(WAIT_POLL_MS);
  }
  throw new AgentBridgeError(
    AgentErrorCode.WaitTimeout,
    `${text !== undefined ? `Text "${text}"` : `Element ${ref}`} was not ${want} after ${timeout}ms`,
    lastError ? { lastError: String(lastError.message || lastError) } : undefined,
  );
};

const bytesToBase64 = (bytes) => {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

// Shrinks high-DPI captures to a size models read well and the bridge's frame
// cap allows.
const encodeScreenshot = async (dataUrl) => {
  const source = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(source);
  try {
    for (const [maxWidth, quality] of [
      [SCREENSHOT_MAX_WIDTH, 0.72],
      [SCREENSHOT_MAX_WIDTH, 0.5],
      [960, 0.5],
    ]) {
      const scale = Math.min(1, maxWidth / bitmap.width);
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
      const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      if (data.length <= SCREENSHOT_MAX_BASE64) {
        return { data, width, height, scale: Number(scale.toFixed(3)) };
      }
    }
  } finally {
    bitmap.close();
  }
  throw new AgentBridgeError(AgentErrorCode.Internal, "Screenshot too large to send");
};

const screenshot = async () => {
  const tab = await resolvePageTab();
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!tab.active || !win || win.state === "minimized") {
    throw new AgentBridgeError(
      AgentErrorCode.TabNotActive,
      "The recorded tab isn't showing (another tab is in front, or the window is minimized), so it can't be captured.",
      { tab: describeTab(tab) },
    );
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
  const image = await encodeScreenshot(dataUrl);
  return { mimeType: "image/jpeg", ...image, ...describeTab(tab) };
};

// Page actions run one at a time on their own queue, so a snapshot never
// lands in the middle of a click's cursor animation, and a slow recorder
// start doesn't hold up the agent getting to the starting page.
export const pageCommands = {
  "page.navigate": { run: navigate, queue: "page" },
  "page.snapshot": { run: snapshot, queue: "page" },
  "page.click": { run: click, queue: "page" },
  "page.type": { run: type, queue: "page" },
  "page.press": { run: press, queue: "page" },
  "page.scroll": { run: scroll, queue: "page" },
  "page.waitFor": { run: waitFor, queue: "page" },
  "page.screenshot": { run: screenshot, queue: "page" },
};
