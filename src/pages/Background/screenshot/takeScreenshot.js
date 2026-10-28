// Takes a screenshot of the active tab and opens it in the website's editor.
//
//   area     the person drags out a part, or clicks an element
//   visible  what is on screen
//   page     the whole page, scrolled and stitched
//
// Each capture is chrome.tabs.captureVisibleTab, which Chrome allows about
// twice a second; a full page waits between frames to stay under it. The
// picture is cropped and stitched here with an OffscreenCanvas, kept in the
// extension's IndexedDB (utils/shotStore), and the editor reads it through
// the editor bridge page: it never leaves the browser until the editor keeps
// it in the cloud.
import { registerMessage } from "../../../messaging/messageRouter";
import { putShot, pruneShots, SHOT_PREFIX } from "../../utils/shotStore";
import { getCurrentTab } from "../tabManagement";
import { sendMessageEnsuringContentScript } from "../utils/executeScripts";

const EDITOR_BASE = process.env.RECORDFUL_EDITOR_BASE || "https://recordful.app";
// The fewest milliseconds between two captures (Chrome's limit is 2 a second).
const CAPTURE_GAP_MS = 560;
// A canvas side may not pass 32767 pixels, nor its area what memory allows.
const MAX_SIDE = 32000;
const MAX_PIXELS = 140_000_000;

let busy = false;
let lastCapture = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const capture = async (windowId) => {
  const gap = Date.now() - lastCapture;
  if (gap < CAPTURE_GAP_MS) await wait(CAPTURE_GAP_MS - gap);
  lastCapture = Date.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
};

const tell = (tabId, message) =>
  new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response ?? null);
    });
  });

const badge = (text) => {
  try {
    chrome.action.setBadgeBackgroundColor({ color: "#8a34fa" });
    chrome.action.setBadgeText({ text });
  } catch {}
};

const scaleTexts = (texts, ratio) =>
  (texts || []).map((t) => ({
    ...t,
    x: t.x * ratio,
    y: t.y * ratio,
    w: t.w * ratio,
    h: t.h * ratio,
  }));

const toBlob = (canvas) => canvas.convertToBlob({ type: "image/png" });

/** Pages the browser does not let an extension see. */
const restricted = (url = "") =>
  /^(chrome|edge|about|devtools|view-source|chrome-extension):/.test(url) ||
  /chromewebstore\.google\.com|chrome\.google\.com\/webstore/.test(url);

async function shoot(tab, mode) {
  // The page's script answers for the area, the text and the full page; on a
  // page it cannot reach, what is visible is still taken, without text.
  let ready = !!(await tell(tab.id, { type: "shot-about" }));
  if (!ready) {
    try {
      await sendMessageEnsuringContentScript(tab.id, { type: "shot-about" });
      ready = !!(await tell(tab.id, { type: "shot-about" }));
    } catch {}
  }

  if (mode === "page" && ready) return shootPage(tab);

  const prep = ready ? await tell(tab.id, { type: "shot-prepare", mode }) : null;
  if (prep?.cancelled) return null;
  let bitmap;
  try {
    // Prefer a DOM-based capture for crisp text/code when the page supports it.
    let domDataUrl = null;
    if (ready && (mode === "visible" || mode === "area")) {
      const res = await tell(tab.id, { type: "shot-dom-capture", scale: 2 });
      domDataUrl = res?.dataUrl || null;
    }
    if (domDataUrl) {
      const blob = await (await fetch(domDataUrl)).blob();
      bitmap = await createImageBitmap(blob);
    } else {
      bitmap = await capture(tab.windowId);
    }
  } finally {
    if (ready) void tell(tab.id, { type: "shot-restore" });
  }
  const viewW = prep?.viewport?.w || bitmap.width;
  const ratio = bitmap.width / viewW;
  const area = prep?.area ?? { x: 0, y: 0, w: viewW, h: bitmap.height / ratio };
  const sx = Math.round(area.x * ratio);
  const sy = Math.round(area.y * ratio);
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(area.w * ratio)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(area.h * ratio)));
  const out = new OffscreenCanvas(sw, sh);
  out.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close?.();
  return {
    blob: await toBlob(out),
    url: prep?.url ?? tab.url ?? "",
    title: prep?.title ?? tab.title ?? "",
    texts: scaleTexts(prep?.texts, ratio),
  };
}

async function shootPage(tab) {
  // The deepest a page goes before the scale is known, in CSS pixels.
  const probe = await tell(tab.id, { type: "shot-about" });
  const guess = probe?.dpr || 1;
  const begin = await tell(tab.id, { type: "shot-page-begin", maxHeight: Math.floor(MAX_SIDE / guess) });
  if (!begin?.view) return null;
  const { view } = begin;
  let ratio = 0;
  let width = 0;
  let total = begin.total;
  let out = null;
  let ctx = null;
  let reached = 0;
  try {
    for (let i = 0; ; i++) {
      const target = Math.min(i * view.h, Math.max(0, total - view.h));
      const last = target >= total - view.h;
      const at = await tell(tab.id, { type: "shot-page-scroll", y: target, last });
      if (!at) break;
      const bitmap = await capture(tab.windowId);
      if (!out) {
        // Device pixels per CSS pixel, from the frame itself: zoom and
        // display scaling are in it, whatever the page says.
        ratio = bitmap.width / (begin.viewport?.w || bitmap.width);
        width = Math.round(view.w * ratio);
        total = Math.min(total, Math.floor(MAX_SIDE / ratio), Math.floor(MAX_PIXELS / (width * ratio)));
        out = new OffscreenCanvas(width, Math.round(total * ratio));
        ctx = out.getContext("2d");
      }
      badge(`${Math.min(99, Math.round(((at.y + view.h) / total) * 100))}%`);
      // The page may scroll less than asked at its end; the frame lands
      // where it really is, and covers what the one before overlapped.
      const sx = Math.round(view.x * ratio);
      const sy = Math.round(view.y * ratio);
      const sh = Math.min(Math.round(view.h * ratio), bitmap.height - sy);
      ctx.drawImage(bitmap, sx, sy, width, sh, 0, Math.round(at.y * ratio), width, sh);
      bitmap.close?.();
      reached = Math.max(reached, at.y + view.h);
      if (at.y + view.h >= total - 1 || target >= total - view.h) break;
      if (i > 400) break;
    }
  } finally {
    badge("");
  }
  const end = await tell(tab.id, { type: "shot-page-end", maxHeight: total });
  if (!out) return null;
  // A page that stopped short is cut where its frames ended.
  total = Math.min(total, reached || total);
  let canvas = out;
  if (Math.round(total * ratio) < out.height) {
    canvas = new OffscreenCanvas(width, Math.round(total * ratio));
    canvas.getContext("2d").drawImage(out, 0, 0);
  }
  return {
    blob: await toBlob(canvas),
    url: begin.url ?? tab.url ?? "",
    title: begin.title ?? tab.title ?? "",
    texts: scaleTexts(end?.texts, ratio).filter((t) => t.y < canvas.height),
  };
}

/** Keeps a picture taken elsewhere (a screen or window) and opens the editor. */
async function keepAndOpen(taken, tab) {
  const name = `${SHOT_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await putShot({ name, takenAt: Date.now(), ...taken });
  void pruneShots().catch(() => {});
  const url = `${EDITOR_BASE}/editor/shot?take=${encodeURIComponent(name)}&ext=${chrome.runtime.id}`;
  await chrome.tabs.create({ url, ...(tab ? { index: tab.index + 1, openerTabId: tab.id } : {}) });
  return { ok: true, name };
}

/** Takes a screenshot of `tab` (else the active tab) and opens the editor. */
export async function takeScreenshot(mode = "area", tab = null) {
  if (busy) return { error: "busy" };
  const target = tab ?? (await getCurrentTab());
  if (!target?.id) return { error: "no-tab" };
  if (restricted(target.url)) return { error: "restricted" };
  busy = true;
  try {
    const taken = await shoot(target, mode);
    if (!taken) return { cancelled: true };
    return await keepAndOpen(taken, target);
  } catch (err) {
    console.warn("[recordful] screenshot failed", err);
    return { error: String(err?.message || err) };
  } finally {
    busy = false;
  }
}

export const setupScreenshotHandlers = () => {
  registerMessage("take-screenshot", async (message, sender) => {
    // From the popup on a page: that page. Its UI closes itself first.
    const tab = sender?.tab?.id ? sender.tab : null;
    // A screen or window: the popup took the frame through Chrome's picker.
    if (message.mode === "screen") {
      if (typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:image/")) {
        return { error: "no-picture" };
      }
      const blob = await (await fetch(message.dataUrl)).blob();
      return keepAndOpen({ blob, url: "", title: message.title || "", texts: [] }, tab);
    }
    // Give the popup a moment to leave the screen.
    await wait(120);
    return takeScreenshot(message.mode, tab);
  });
};
