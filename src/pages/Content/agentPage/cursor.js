// The agent's cursor. Tab capture doesn't record the system pointer, and an
// agent has none anyway, so this rendered one is what viewers follow: it
// glides to each target along a slight curve, dips on press and leaves a
// ripple where it clicked. It also sends the pointer events a real mouse
// would along the way, so hover menus open and Recordful's own click
// tracking (smart zooms in the editor) sees the clicks.
import { CURSOR_HOST_ID, deepElementFromPoint, isOwnUi } from "./elements";

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.cursor {
  position: absolute; left: 0; top: 0; width: 24px; height: 24px;
  transform-origin: 3px 2px; will-change: transform;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.35));
  transition: opacity .2s ease;
}
.cursor svg { display: block; transition: transform .09s ease-out; transform-origin: 3px 2px; }
.cursor.pressed svg { transform: scale(.86); }
.ripple {
  position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px;
  border-radius: 50%; border: 2.5px solid rgba(76, 110, 245, .95);
  background: rgba(76, 110, 245, .18);
  animation: ripple .55s ease-out forwards;
}
@keyframes ripple {
  from { transform: scale(.25); opacity: 1; }
  to { transform: scale(1.35); opacity: 0; }
}
`;

const ARROW = `
<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.6 20.7 L10.7 14.2 L17 14.2 Z"
        fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;

let host = null;
let layer = null;
let cursorEl = null;
let pos = null;
let hovered = null;

const ensureOverlay = () => {
  if (host?.isConnected) return;
  host = document.createElement("div");
  host.id = CURSOR_HOST_ID;
  host.style.cssText =
    "position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>${STYLE}</style><div class="layer"><div class="cursor">${ARROW}</div></div>`;
  layer = shadow.querySelector(".layer");
  cursorEl = shadow.querySelector(".cursor");
  document.documentElement.appendChild(host);
  if (pos) place(pos.x, pos.y);
};

const place = (x, y) => {
  pos = { x, y };
  // The arrow's tip sits at (3, 2) in its box.
  if (cursorEl) cursorEl.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
};

const clampToViewport = ({ x, y }) => ({
  x: Math.min(Math.max(0, x), window.innerWidth - 1),
  y: Math.min(Math.max(0, y), window.innerHeight - 1),
});

export const position = () => (pos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : null);

// Picks up where the cursor was on the previous page, so a navigation doesn't
// make it jump.
export const restore = (saved) => {
  if (!pos && saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    pos = clampToViewport(saved);
  }
};

const mouseInit = (x, y, extra = {}) => ({
  bubbles: true,
  cancelable: true,
  composed: true,
  view: window,
  clientX: x,
  clientY: y,
  screenX: window.screenX + x,
  screenY: window.screenY + y,
  button: 0,
  buttons: 0,
  ...extra,
});

const pointerInit = (x, y, extra = {}) => ({
  ...mouseInit(x, y, extra),
  pointerId: 1,
  pointerType: "mouse",
  isPrimary: true,
});

const fire = (target, type, x, y, extra) => {
  const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
  const init = type.startsWith("pointer") ? pointerInit(x, y, extra) : mouseInit(x, y, extra);
  if (type.endsWith("enter") || type.endsWith("leave")) init.bubbles = false;
  return target.dispatchEvent(new Ctor(type, init));
};

const hoverAt = (x, y) => {
  const target = deepElementFromPoint(x, y);
  if (!target || isOwnUi(target)) return;
  if (target !== hovered) {
    if (hovered?.isConnected) {
      fire(hovered, "pointerout", x, y, { relatedTarget: target });
      fire(hovered, "pointerleave", x, y, { relatedTarget: target });
      fire(hovered, "mouseout", x, y, { relatedTarget: target });
      fire(hovered, "mouseleave", x, y, { relatedTarget: target });
    }
    fire(target, "pointerover", x, y, { relatedTarget: hovered });
    fire(target, "pointerenter", x, y, { relatedTarget: hovered });
    fire(target, "mouseover", x, y, { relatedTarget: hovered });
    fire(target, "mouseenter", x, y, { relatedTarget: hovered });
    hovered = target;
  }
  fire(target, "pointermove", x, y);
  fire(target, "mousemove", x, y);
};

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// rAF stops in hidden tabs; fall back to timers so actions still finish.
const nextFrame = () =>
  new Promise((resolve) =>
    document.hidden ? setTimeout(resolve, 16) : requestAnimationFrame(() => resolve()),
  );

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const jitter = (base, spread) => base + (Math.random() * 2 - 1) * spread;

// Glides to (x, y). Duration grows with distance the way a hand's does.
export const moveTo = async (x, y) => {
  ensureOverlay();
  const from = pos || { x: window.innerWidth * 0.55, y: window.innerHeight * 0.7 };
  if (!pos) place(from.x, from.y);
  const dx = x - from.x;
  const dy = y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) {
    place(x, y);
    hoverAt(x, y);
    return;
  }
  const duration = Math.min(1000, Math.max(280, 220 + dist * 0.55));
  // A slight arc: real pointer paths are never straight.
  const bend = (Math.random() < 0.5 ? -1 : 1) * Math.min(80, dist * 0.12);
  const cx = from.x + dx / 2 + (-dy / dist) * bend;
  const cy = from.y + dy / 2 + (dx / dist) * bend;
  const start = performance.now();
  let frame = 0;
  for (;;) {
    await nextFrame();
    const t = Math.min(1, (performance.now() - start) / duration);
    const e = easeInOut(t);
    const px = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * x;
    const py = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * y;
    place(px, py);
    // Every other frame is plenty for hover handlers.
    if (frame++ % 2 === 0 || t === 1) hoverAt(px, py);
    if (t === 1) break;
  }
};

export const ripple = (x, y) => {
  ensureOverlay();
  const ring = document.createElement("div");
  ring.className = "ripple";
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  layer.appendChild(ring);
  setTimeout(() => ring.remove(), 700);
};

// Press and release at the cursor, on target. Returns whether the page let
// the click through (no preventDefault on mousedown/click).
export const pressAt = async (target, x, y, { focus } = {}) => {
  ensureOverlay();
  cursorEl.classList.add("pressed");
  ripple(x, y);
  fire(target, "pointerdown", x, y, { buttons: 1 });
  const downAllowed = fire(target, "mousedown", x, y, { buttons: 1, detail: 1 });
  if (downAllowed && focus) focus();
  await sleep(jitter(85, 20));
  fire(target, "pointerup", x, y);
  fire(target, "mouseup", x, y, { detail: 1 });
  cursorEl.classList.remove("pressed");
  // Untrusted clicks still run activation behaviour: links follow,
  // checkboxes toggle, labels forward, forms submit.
  return fire(target, "click", x, y, { detail: 1 });
};
