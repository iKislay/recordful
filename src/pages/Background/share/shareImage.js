// "Share to X / Threads / Forg" from the website's screenshot editor: the page
// hands over the finished picture, this opens the network's own composer in
// a new tab and attaches it there. Nothing is uploaded to Recordful and
// nothing is posted: the person reads it over, adds words and presses Post.
//
// Only these composers can be opened, only by the Recordful site, so a
// message cannot make the extension visit anywhere else.
import { attachImageInPage } from "./attachImage";

const TARGETS = {
  x: "https://x.com/intent/post",
  threads: "https://www.threads.com/intent/post",
  forg: "https://forg.to/explore?compose=1",
};

const SITE_ORIGINS = (() => {
  const origins = ["http://localhost:3000"];
  try {
    origins.push(new URL(process.env.RECORDFUL_EDITOR_BASE).origin);
  } catch {}
  return origins;
})();

// A little over what a 3× screenshot of a long page weighs, as base64.
const MAX_BASE64 = 60 * 1024 * 1024;
const NAME = /^[\w .()-]{1,120}$/;

const loaded = async (tabId, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return true;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

async function share({ target, base64, mime, name }) {
  const url = TARGETS[target];
  if (!url) return { ok: false, error: "unknown-target" };
  if (typeof base64 !== "string" || !base64 || base64.length > MAX_BASE64) {
    return { ok: false, error: "bad-image" };
  }
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) return { ok: false, error: "bad-image" };
  const fileName = NAME.test(name) ? name : "screenshot.png";

  const tab = await chrome.tabs.create({ url, active: true });
  if (!(await loaded(tab.id))) return { ok: false, error: "no-load", opened: true };
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: attachImageInPage,
      args: [target, base64, mime, fileName],
    });
    const result = injected?.result;
    // `opened`: the composer is there either way, and the picture is not.
    return result?.ok ? { ok: true } : { ok: false, error: result?.why || "not-attached", opened: true };
  } catch {
    return { ok: false, error: "not-attached", opened: true };
  }
}

export const setupShareListener = () => {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message?.type !== "recordful-share-ping" && message?.type !== "recordful-share-image") return;
    if (!SITE_ORIGINS.includes(sender.origin)) return;
    if (message.type === "recordful-share-ping") {
      sendResponse({ ok: true, targets: Object.keys(TARGETS) });
      return;
    }
    share(message).then(sendResponse, () => sendResponse({ ok: false, error: "failed" }));
    // The answer comes later.
    return true;
  });
};
