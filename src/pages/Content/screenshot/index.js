// The page's side of taking a screenshot. The service worker captures the
// visible tab (chrome.tabs.captureVisibleTab); this script gets the page
// ready for each capture and says what was on it:
//
//   shot-prepare   hides Recordful's own UI; for "area", lets the person drag
//                  out a part or click an element first
//   shot-restore   shows the UI again
//   shot-page-*    scrolls a full page frame by frame: lazy pictures are
//                  loaded first, and fixed or sticky bars (headers, cookie
//                  banners, chat bubbles) show once, at the top, instead of
//                  repeating down the picture
//
// With each it sends the page's text and where it sat, so the editor can copy
// the text without guessing at it, and the parts that look private (emails,
// phone and card numbers, keys and tokens) so it can hide them in one click.
// Positions are CSS pixels; the worker scales them to the picture.

import { captureDomScreenshot, domCaptureAvailable } from "./domCapture";

const OVERLAY_ID = "recordful-shot-overlay";
const MAX_TEXTS = 6000;
const MAX_TEXT_LENGTH = 2000;

const frames = (n = 2) =>
  new Promise((resolve) => {
    const step = (left) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
    step(n);
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Recordful's own UI is never in the picture.

let hiddenUi = null;
const hideUi = () => {
  const root = document.getElementById("recordful-ui");
  if (!root || hiddenUi) return;
  hiddenUi = { root, visibility: root.style.visibility };
  root.style.setProperty("visibility", "hidden", "important");
};
const showUi = () => {
  if (!hiddenUi) return;
  hiddenUi.root.style.visibility = hiddenUi.visibility;
  hiddenUi = null;
};

// ---------------------------------------------------------------------------
// Private-looking text.

const luhn = (digits) => {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
};

const PATTERNS = [
  { kind: "email", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  {
    kind: "card",
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    ok: (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits);
    },
  },
  {
    kind: "secret",
    re: /\b(?:(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
  },
  {
    // A long unbroken run of letters and digits, mixed: a token or a key.
    kind: "secret",
    re: /\b[A-Za-z0-9_-]{32,}\b/g,
    ok: (m) => /\d/.test(m) && /[a-z]/i.test(m) && !/^[a-z_-]+$/i.test(m),
  },
  {
    kind: "phone",
    re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]?\d{3,4}\b/g,
    ok: (m) => {
      const digits = m.replace(/\D/g, "").length;
      return digits >= 9 && digits <= 15;
    },
  },
  {
    kind: "ip",
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  },
];

const findPrivate = (text) => {
  const found = [];
  for (const { kind, re, ok } of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (ok && !ok(m[0])) continue;
      // An earlier pattern already covers it (a card is not also a phone).
      if (found.some((f) => m.index < f.end && m.index + m[0].length > f.start)) continue;
      found.push({ kind, start: m.index, end: m.index + m[0].length });
    }
  }
  return found;
};

// ---------------------------------------------------------------------------
// The page's text, with where it sat.

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME"]);

const visibleElement = (el) => {
  if (!el || SKIP.has(el.tagName)) return false;
  if (el.closest(`#recordful-ui, #${OVERLAY_ID}`)) return false;
  if (typeof el.checkVisibility === "function") {
    return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  }
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
};

/**
 * Every bit of text inside `area` (CSS pixels of the viewport), positioned
 * relative to its corner plus `offset`. Private-looking parts are their own
 * boxes, flagged, so the editor can cover just them.
 */
const collectTexts = (area, offset = { x: 0, y: 0 }) => {
  const texts = [];
  const range = document.createRange();
  const inArea = (r) =>
    r.width > 0 &&
    r.height > 0 &&
    r.right > area.x &&
    r.bottom > area.y &&
    r.left < area.x + area.w &&
    r.top < area.y + area.h;
  const push = (r, t, s) => {
    if (texts.length >= MAX_TEXTS) return;
    texts.push({
      x: r.left - area.x + offset.x,
      y: r.top - area.y + offset.y,
      w: r.width,
      h: r.height,
      t: t.slice(0, MAX_TEXT_LENGTH),
      ...(s && { s }),
    });
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.nodeValue.trim() && visibleElement(node.parentElement)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  for (let node = walker.nextNode(); node && texts.length < MAX_TEXTS; node = walker.nextNode()) {
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    if (!inArea(box)) continue;
    const text = node.nodeValue.replace(/\s+/g, " ").trim();
    push(box, text);
    for (const hit of findPrivate(node.nodeValue)) {
      try {
        range.setStart(node, hit.start);
        range.setEnd(node, hit.end);
      } catch {
        continue;
      }
      // One box a line, when the match wraps.
      for (const r of range.getClientRects()) {
        if (inArea(r)) push(r, node.nodeValue.slice(hit.start, hit.end), hit.kind);
      }
    }
  }

  // What is typed into fields is not text in the page, but shows.
  for (const field of document.querySelectorAll("input, textarea")) {
    if (texts.length >= MAX_TEXTS) break;
    const type = (field.type || "text").toLowerCase();
    if (!["text", "email", "tel", "search", "url", "number", "textarea"].includes(type)) continue;
    const value = field.value?.trim();
    if (!value || !visibleElement(field)) continue;
    const r = field.getBoundingClientRect();
    if (!inArea(r)) continue;
    const hits = findPrivate(value);
    push(r, value, hits[0]?.kind ?? (type === "email" || type === "tel" ? (type === "tel" ? "phone" : "email") : undefined));
  }
  return texts;
};

// ---------------------------------------------------------------------------
// Picking an area: drag out a box, or click an element to take just it.

const pickArea = () =>
  new Promise((resolve) => {
    document.getElementById(OVERLAY_ID)?.remove();
    const host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;-webkit-user-select:none;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .dim { position: fixed; inset: 0; }
        .box { position: fixed; display: none; box-sizing: border-box;
          border: 1.5px solid #fff; border-radius: 3px;
          box-shadow: 0 0 0 100vmax rgba(10, 10, 12, 0.45), 0 0 0 0.5px rgba(0,0,0,0.4) inset; }
        .box.element { border-color: #8a34fa; border-width: 2px;
          box-shadow: 0 0 0 100vmax rgba(10, 10, 12, 0.35); background: rgba(138,52,250,0.06); }
        .size { position: fixed; display: none; padding: 3px 7px; border-radius: 6px;
          background: rgba(28,28,28,0.88); color: #fff;
          font: 500 11px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
          font-variant-numeric: tabular-nums; pointer-events: none; white-space: nowrap; }
        .hint { position: fixed; left: 50%; top: 18px; transform: translateX(-50%);
          padding: 8px 14px; border-radius: 999px; background: rgba(28,28,28,0.9); color: #fff;
          font: 500 12.5px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
          box-shadow: 0 8px 24px rgba(0,0,0,0.25); pointer-events: none; white-space: nowrap;
          transition: opacity 150ms ease; }
        .hint b { font-weight: 600; }
        .hint span { opacity: 0.6; margin: 0 6px; }
        .full { position: fixed; inset: 0; background: rgba(10,10,12,0.35); }
      </style>
      <div class="full"></div>
      <div class="box"></div>
      <div class="size"></div>
      <div class="hint"><b>Drag</b> to select<span>·</span><b>Click</b> an element<span>·</span><b>Enter</b> for the whole view<span>·</span><b>Esc</b> to cancel</div>
    `;
    const full = shadow.querySelector(".full");
    const box = shadow.querySelector(".box");
    const size = shadow.querySelector(".size");
    const hint = shadow.querySelector(".hint");
    document.documentElement.appendChild(host);

    let start = null;
    let current = null;
    let element = null;

    const show = (r, isElement) => {
      full.style.display = "none";
      box.style.display = "block";
      box.classList.toggle("element", !!isElement);
      box.style.left = `${r.x}px`;
      box.style.top = `${r.y}px`;
      box.style.width = `${r.w}px`;
      box.style.height = `${r.h}px`;
      size.style.display = "block";
      size.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
      const below = r.y + r.h + 26 < window.innerHeight;
      size.style.left = `${Math.max(4, r.x)}px`;
      size.style.top = `${below ? r.y + r.h + 6 : Math.max(4, r.y - 24)}px`;
      hint.style.opacity = r.y < 60 && r.x < window.innerWidth / 2 + 220 && r.x + r.w > window.innerWidth / 2 - 220 ? "0" : "1";
    };

    const elementAt = (x, y) => {
      host.style.pointerEvents = "none";
      const stack = document.elementsFromPoint(x, y);
      host.style.pointerEvents = "";
      for (const el of stack) {
        if (el === host || el === document.documentElement || el === document.body) continue;
        if (el.closest("#recordful-ui")) continue;
        const r = el.getBoundingClientRect();
        // The whole page is "the whole view", not an element.
        if (r.width >= window.innerWidth - 4 && r.height >= window.innerHeight - 4) continue;
        if (r.width < 16 || r.height < 16) continue;
        return el;
      }
      return null;
    };

    const clip = (r) => {
      const x = Math.max(0, r.x);
      const y = Math.max(0, r.y);
      return {
        x,
        y,
        w: Math.min(window.innerWidth, r.x + r.w) - x,
        h: Math.min(window.innerHeight, r.y + r.h) - y,
      };
    };

    const finish = (result) => {
      cleanup();
      resolve(result);
    };
    const onMove = (e) => {
      if (start) {
        current = {
          x: Math.min(start.x, e.clientX),
          y: Math.min(start.y, e.clientY),
          w: Math.abs(e.clientX - start.x),
          h: Math.abs(e.clientY - start.y),
        };
        if (current.w > 3 || current.h > 3) show(current, false);
        return;
      }
      element = elementAt(e.clientX, e.clientY);
      if (element) {
        const r = element.getBoundingClientRect();
        show(clip({ x: r.left, y: r.top, w: r.width, h: r.height }), true);
      }
    };
    const onDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      current = null;
    };
    const onUp = (e) => {
      if (!start) return;
      e.preventDefault();
      const dragged = current && current.w > 4 && current.h > 4;
      start = null;
      if (dragged) return finish(clip(current));
      // A click: the element under the pointer.
      const el = elementAt(e.clientX, e.clientY);
      if (el) {
        const r = el.getBoundingClientRect();
        return finish(clip({ x: r.left, y: r.top, w: r.width, h: r.height }));
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finish({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
      }
    };
    const cleanup = () => {
      host.removeEventListener("mousemove", onMove, true);
      host.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mouseup", onUp, true);
      window.removeEventListener("keydown", onKey, true);
      host.remove();
    };
    host.addEventListener("mousemove", onMove, true);
    host.addEventListener("mousedown", onDown, true);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("keydown", onKey, true);
  });

// ---------------------------------------------------------------------------
// A full page.

let page = null;

/** The element that scrolls the page: the document, or a big inner panel. */
const findScroller = () => {
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollHeight > window.innerHeight + 4) return { el: doc, window: true };
  let best = null;
  let bestArea = window.innerWidth * window.innerHeight * 0.3;
  for (const el of document.querySelectorAll("body *")) {
    if (el.scrollHeight <= el.clientHeight + 40 || el.clientHeight < 200) continue;
    const style = getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best ? { el: best, window: false } : { el: doc, window: true };
};

const scrollTo = (y) => {
  if (page.scroller.window) window.scrollTo({ top: y, left: page.startX, behavior: "instant" });
  else page.scroller.el.scrollTop = y;
};
const scrollTop = () => (page.scroller.window ? window.scrollY : page.scroller.el.scrollTop);

const isFloating = (el) => {
  const pos = getComputedStyle(el).position;
  return pos === "fixed" || pos === "sticky";
};

/**
 * What stays put while the page scrolls under it, sorted by where it sits:
 * a bar at the top (a header) belongs in the first frame only, a bar at the
 * bottom (a chat's message box, a cookie banner) in the last frame only.
 * Shown in every frame, either repeats down the picture, or lands in its
 * middle. Something pinned that fills most of the screen (a scroll-driven
 * showcase) is part of the content and stays.
 */
const findFloating = () => {
  const found = [];
  const vh = window.innerHeight;
  const consider = (el, host = el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.height > vh * 0.5 && r.width > window.innerWidth * 0.5) return;
    const middle = r.top + r.height / 2;
    found.push({ el: host, at: middle < vh / 2 ? "top" : "bottom" });
  };
  // The whole document: some widgets attach beside <body>, not in it.
  for (const el of document.documentElement.querySelectorAll("*")) {
    if (el === document.body || el.closest("head, #recordful-ui")) continue;
    // A widget drawn in its own shadow root (chat bubbles, dev badges).
    if (el.shadowRoot) {
      const inner = [...el.shadowRoot.querySelectorAll("*")].find(isFloating);
      if (inner) {
        consider(inner, el);
        continue;
      }
    }
    if (!isFloating(el)) continue;
    // Inside something already counted: hidden with it.
    if (found.some((f) => f.el.contains(el))) continue;
    consider(el);
  }
  return found;
};

const setOpacity = (el, hidden) => {
  if (hidden) {
    if (!page.saved.has(el))
      page.saved.set(el, [el.style.getPropertyValue("opacity"), el.style.getPropertyPriority("opacity")]);
    // Opacity, not visibility: a child can make itself visible again, it
    // cannot undo this.
    el.style.setProperty("opacity", "0", "important");
  } else if (page.saved.has(el)) {
    const [value, priority] = page.saved.get(el);
    if (value) el.style.setProperty("opacity", value, priority);
    else el.style.removeProperty("opacity");
    page.saved.delete(el);
  }
};

/** Bars for this frame: the top ones in the first, the bottom ones in the last. */
const placeFloating = (first, last) => {
  for (const { el, at } of page.floating) setOpacity(el, at === "top" ? !first : !last);
};

const pageBegin = async (maxHeight) => {
  const scroller = findScroller();
  page = {
    scroller,
    startX: window.scrollX,
    startY: scroller.window ? window.scrollY : scroller.el.scrollTop,
    floating: [],
    saved: new Map(),
    behavior: document.documentElement.style.scrollBehavior,
  };
  document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
  hideUi();
  const el = scroller.el;
  const r = scroller.window
    ? { left: 0, top: 0, width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight }
    : el.getBoundingClientRect();
  const view = {
    x: Math.max(0, r.left),
    y: Math.max(0, r.top),
    w: Math.min(r.width, (scroller.window ? r.width : el.clientWidth)),
    h: Math.min(scroller.window ? r.height : el.clientHeight, window.innerHeight - Math.max(0, r.top)),
  };
  // A quick pass down the page wakes pictures that load as they come near.
  const total = () => Math.min(el.scrollHeight, maxHeight);
  for (let y = 0; y < total(); y += view.h) {
    scrollTo(y);
    await sleep(90);
  }
  scrollTo(0);
  await sleep(350);
  await frames(2);
  page.floating = findFloating();
  page.view = view;
  return { view, total: total() };
};

const pageScroll = async (y, last) => {
  if (!page) return null;
  placeFloating(y <= 0, last);
  scrollTo(y);
  await frames(2);
  // Long enough for what fades in as it scrolls into view, and for a smooth
  // scrolling script to settle where it was sent.
  await sleep(380);
  if (Math.abs(scrollTop() - y) > 2) {
    scrollTo(y);
    await frames(2);
    await sleep(200);
  }
  return { y: scrollTop() };
};

const pageEnd = async (maxHeight) => {
  if (!page) return { texts: [] };
  // The text is read with the page at the top, where every frame lines up.
  scrollTo(0);
  await frames(2);
  for (const el of [...page.saved.keys()]) setOpacity(el, false);
  await frames(1);
  const { view } = page;
  const el = page.scroller.el;
  // Text below the fold is read relative to the content's top.
  const texts = collectTexts(
    { x: view.x, y: view.y - 0, w: view.w, h: Math.min(el.scrollHeight, maxHeight) + 10 },
    { x: 0, y: 0 },
  ).filter((t) => t.y < maxHeight);
  scrollTo(page.startY);
  if (page.behavior) document.documentElement.style.scrollBehavior = page.behavior;
  else document.documentElement.style.removeProperty("scroll-behavior");
  page = null;
  showUi();
  return { texts };
};

// ---------------------------------------------------------------------------

const about = () => ({
  url: location.href,
  title: document.title,
  viewport: { w: window.innerWidth, h: window.innerHeight },
  dpr: window.devicePixelRatio || 1,
});

const handle = async (message) => {
  switch (message.type) {
    case "shot-prepare": {
      let area = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
      if (message.mode === "area") {
        hideUi();
        const picked = await pickArea();
        if (!picked || picked.w < 2 || picked.h < 2) {
          showUi();
          return { cancelled: true };
        }
        area = picked;
      } else hideUi();
      // The overlay and our UI are gone from the screen before it is taken.
      await frames(2);
      await sleep(30);
      return { ...about(), area, texts: collectTexts(area) };
    }
    case "shot-about":
      return about();
    case "shot-restore":
      showUi();
      return { ok: true };
    case "shot-dom-capture": {
      if (!domCaptureAvailable()) return { dataUrl: null };
      const dataUrl = await captureDomScreenshot(message?.scale ?? 2);
      return { dataUrl };
    }
    case "shot-page-begin":
      return { ...about(), ...(await pageBegin(message.maxHeight)) };
    case "shot-page-scroll":
      return pageScroll(message.y, message.last === true);
    case "shot-page-end":
      return pageEnd(message.maxHeight);
    default:
      return undefined;
  }
};

export const initScreenshot = () => {
  if (window.__recordfulScreenshotReady) return;
  window.__recordfulScreenshotReady = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message?.type !== "string" || !message.type.startsWith("shot-")) return;
    handle(message).then(sendResponse, (err) => sendResponse({ error: String(err?.message || err) }));
    return true;
  });
};
