// Page actions, done the way a person would: scroll the target into view,
// move the cursor there, press, type a key at a time. Synthetic events don't
// trigger a browser's default actions for keys, so press() performs the
// usual effect itself (submit on Enter, focus on Tab, and so on).
import { jitter, moveTo, pressAt, sleep } from "./cursor";
import {
  boxOf,
  deepActiveElement,
  deepElementFromPoint,
  describe,
  inputType,
  isOwnUi,
  isTextField,
  isVisible,
  PageErrorCode,
  pageError,
  refFor,
  resolveRef,
  snapshot,
} from "./elements";

const FOCUSABLE =
  "a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable=''], [contenteditable=true], [contenteditable=plaintext-only]";

const isDisabled = (el) =>
  Boolean(el.disabled || el.getAttribute("aria-disabled") === "true" || el.closest("[inert]"));

// Scrolls smoothly until the element stops moving, like a person would
// before reaching for it.
const bringIntoView = async (el) => {
  const rect = boxOf(el);
  const margin = 24;
  const fullyIn =
    rect.top >= margin &&
    rect.left >= 0 &&
    rect.bottom <= window.innerHeight - margin &&
    rect.right <= window.innerWidth;
  if (fullyIn) return;
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  await settle(() => {
    const r = boxOf(el);
    return `${Math.round(r.top)},${Math.round(r.left)}`;
  });
};

// Waits until read() returns the same value for a few polls in a row.
const settle = async (read, { timeoutMs = 3000, stableMs = 150 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let last = read();
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(50);
    const now = read();
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableMs) {
      return;
    }
  }
};

// Whether a click at the point would reach el (or something inside it).
const reaches = (el, hit) => {
  if (!hit) return false;
  if (hit === el || el.contains(hit) || isOwnUi(hit)) return true;
  // A label forwards to its control, a control is reached through its label.
  if (hit.closest?.("label")?.control === el) return true;
  if (el.tagName === "LABEL" && el.control === hit) return true;
  // Shadow hosts: the hit is inside el's shadow tree.
  return el.shadowRoot ? el.shadowRoot.contains(hit) : false;
};

// The point to click: the middle of the element's visible part, nudged a
// little like a hand would, or another spot if something covers the middle.
const clickPoint = (el) => {
  const rect = boxOf(el);
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  if (right - left < 1 || bottom - top < 1) {
    throw pageError(PageErrorCode.ElementNotInteractable, "The element isn't on screen, even after scrolling.", describe(el));
  }
  const w = right - left;
  const h = bottom - top;
  const nudge = (size) => jitter(0, Math.min(3, size / 8));
  const candidates = [
    [left + w / 2 + nudge(w), top + h / 2 + nudge(h)],
    [left + w / 2, top + h / 2],
    [left + w * 0.25, top + h / 2],
    [left + w * 0.75, top + h / 2],
    [left + w / 2, top + h * 0.25],
    [left + w / 2, top + h * 0.75],
  ];
  let firstHit = null;
  for (const [x, y] of candidates) {
    const hit = deepElementFromPoint(x, y);
    if (reaches(el, hit)) return { x, y, hit: isOwnUi(hit) ? el : hit };
    firstHit = firstHit || hit;
  }
  const cover = firstHit?.closest?.("a[href], button, [role], label, input, select, textarea") || firstHit;
  throw pageError(
    PageErrorCode.ElementObscured,
    `Something covers the element${cover ? ` (${describe(cover).role} "${describe(cover).name}")` : ""}. Deal with it first, for example close the dialog or banner.`,
    { target: describe(el), obscuredBy: cover ? describe(cover) : null },
  );
};

const focusFor = (hit) => () => {
  const focusable = hit.closest?.(FOCUSABLE);
  if (focusable && !isDisabled(focusable)) focusable.focus({ preventScroll: true });
  else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
};

const clickElement = async (el) => {
  if (!isVisible(el)) {
    throw pageError(PageErrorCode.ElementNotInteractable, "The element is hidden.", describe(el));
  }
  if (isDisabled(el)) {
    throw pageError(PageErrorCode.ElementNotInteractable, "The element is disabled.", describe(el));
  }
  await bringIntoView(el);
  // Aim, travel, then re-check the target: the page may have shifted while
  // the cursor was on its way.
  let point = clickPoint(el);
  await moveTo(point.x, point.y);
  await sleep(jitter(110, 40));
  point = clickPoint(el);
  const allowed = await pressAt(point.hit, point.x, point.y, { focus: focusFor(point.hit) });
  return { point, allowed };
};

const click = async ({ ref }) => {
  const el = resolveRef(ref);
  const { point, allowed } = await clickElement(el);
  await sleep(120);
  return {
    clicked: describe(el),
    at: { x: Math.round(point.x), y: Math.round(point.y) },
    ...(allowed ? {} : { note: "The page cancelled the click's default action." }),
  };
};

// ---- typing ----------------------------------------------------------------

const valueSetter = (el) =>
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set ||
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;

// Inserts text at the caret the way the browser does for real typing, so
// frameworks see a normal input event. execCommand covers inputs, textareas
// and contenteditable with undo and selection intact; the setter fallback
// covers fields it refuses (some input types, detached selection).
const insertText = (el, text) => {
  const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
  const before = isField ? el.value : el.textContent;
  if (document.execCommand("insertText", false, text)) {
    const after = isField ? el.value : el.textContent;
    if (after !== before) return;
  }
  if (!isField) return;
  let start = el.value.length;
  let end = start;
  try {
    start = el.selectionStart ?? start;
    end = el.selectionEnd ?? end;
  } catch {
    // email/number inputs don't expose a selection.
  }
  valueSetter(el).call(el, el.value.slice(0, start) + text + el.value.slice(end));
  try {
    el.setSelectionRange(start + text.length, start + text.length);
  } catch {
    // As above.
  }
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
};

const deleteSelection = (el) => {
  if (document.execCommand("delete", false)) return;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    valueSetter(el).call(el, "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward" }));
  }
};

const selectAll = (el) => {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    el.select();
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};

const caretToEnd = (el) => {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      // email/number inputs: the caret is already at the end after focus.
    }
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};

const editableTarget = (el) => {
  if (isTextField(el)) return el;
  // A ref on a wrapper or label whose field is inside it.
  const inner = el.control || el.querySelector?.("input, textarea, [contenteditable='true'], [contenteditable='']");
  return inner && isTextField(inner) ? inner : null;
};

const fieldValue = (el) => {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    return inputType(el) === "password" ? "•".repeat(Math.min(el.value.length, 8)) : el.value;
  }
  return el.textContent;
};

const keyEvent = (target, type, key, mods = {}) =>
  target.dispatchEvent(
    new KeyboardEvent(type, {
      key,
      code: codeFor(key),
      keyCode: keyCodeFor(key),
      which: keyCodeFor(key),
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      ctrlKey: Boolean(mods.Control),
      shiftKey: Boolean(mods.Shift),
      altKey: Boolean(mods.Alt),
      metaKey: Boolean(mods.Meta),
    }),
  );

const selectOption = (select, text) => {
  const wanted = text.trim().toLowerCase();
  const options = [...select.options];
  const option =
    options.find((o) => (o.label || o.text).trim().toLowerCase() === wanted) ||
    options.find((o) => o.value.toLowerCase() === wanted) ||
    options.find((o) => (o.label || o.text).toLowerCase().includes(wanted));
  if (!option) {
    throw pageError(PageErrorCode.InvalidParams, `No option "${text}" in this list.`, {
      options: options.slice(0, 30).map((o) => (o.label || o.text).trim()),
    });
  }
  valueSetter(select).call(select, option.value);
  select.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return (option.label || option.text).trim();
};

const type = async ({ ref, text, clear, delayMs }) => {
  const el = resolveRef(ref);

  // Native dropdowns can't be opened by a script; choose the option directly.
  if (el.tagName === "SELECT") {
    await clickElement(el);
    const chosen = selectOption(el, text);
    return { typed: describe(el), value: chosen };
  }

  const field = editableTarget(el);
  if (!field) {
    throw pageError(PageErrorCode.ElementNotInteractable, "That element isn't a text field.", describe(el));
  }
  await clickElement(field === el || isVisible(el) ? el : field);
  if (deepActiveElement() !== field && !field.contains(deepActiveElement())) {
    field.focus({ preventScroll: true });
  }

  if (clear) {
    selectAll(field);
    if (!text) deleteSelection(field);
  } else {
    caretToEnd(field);
  }

  if (delayMs === 0) {
    if (text) insertText(field, text);
  } else {
    for (const ch of text) {
      const key = ch === "\n" ? "Enter" : ch;
      const allowed = keyEvent(field, "keydown", key);
      if (allowed) {
        keyEvent(field, "keypress", key);
        if (ch === "\n" && field.tagName === "INPUT") {
          // A newline in a one-line field is an Enter press; leave submitting to press().
        } else {
          insertText(field, ch);
        }
      }
      keyEvent(field, "keyup", key);
      let pause = Math.max(15, jitter(delayMs, delayMs * 0.5));
      if (ch === " ") pause += Math.random() * delayMs * 0.8;
      else if (/[.,!?;:]/.test(ch)) pause += Math.random() * delayMs * 2;
      await sleep(pause);
    }
  }
  return { typed: describe(field === el ? el : field), value: fieldValue(field) };
};

// ---- keys ------------------------------------------------------------------

const KEY_CODES = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  Delete: 46,
  " ": 32,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
};

function keyCodeFor(key) {
  if (KEY_CODES[key]) return KEY_CODES[key];
  if (/^F([1-9]|1[0-2])$/.test(key)) return 111 + Number(key.slice(1));
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

function codeFor(key) {
  if (key === " ") return "Space";
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key.length === 1 ? "" : key;
}

const MODIFIER_NAMES = new Set(["Control", "Shift", "Alt", "Meta"]);

const parseKey = (combo) => {
  const parts = combo === "+" ? ["+"] : combo.endsWith("++") ? [...combo.slice(0, -2).split("+"), "+"] : combo.split("+");
  const key = parts.pop();
  const mods = {};
  for (const mod of parts) {
    if (!MODIFIER_NAMES.has(mod)) throw pageError(PageErrorCode.InvalidParams, `Unknown modifier "${mod}"`);
    mods[mod] = true;
  }
  if (!key) throw pageError(PageErrorCode.InvalidParams, `No key in "${combo}"`);
  return { key: key === "Space" ? " " : key, mods };
};

const tabbables = () =>
  [...document.querySelectorAll(FOCUSABLE)]
    .filter((el) => el.tabIndex >= 0 && !isDisabled(el) && !isOwnUi(el) && isVisible(el))
    .map((el, index) => ({ el, index }))
    .sort((a, b) => {
      // Positive tabindex first, in order, then everything else in document order.
      const ta = a.el.tabIndex > 0 ? a.el.tabIndex : Infinity;
      const tb = b.el.tabIndex > 0 ? b.el.tabIndex : Infinity;
      return ta === tb ? a.index - b.index : ta - tb;
    })
    .map(({ el }) => el);

const moveFocus = (backwards) => {
  const list = tabbables();
  if (!list.length) return null;
  const current = deepActiveElement();
  const at = list.indexOf(current);
  const next =
    at === -1 ? list[backwards ? list.length - 1 : 0] : list[(at + (backwards ? -1 : 1) + list.length) % list.length];
  next.focus();
  return next;
};

const isActivatable = (el) =>
  el.matches?.("button, a[href], summary, input[type=button], input[type=submit], input[type=reset], [role=button], [role=link], [role=tab], [role=menuitem], [role=option]");

const isToggle = (el) => el.matches?.("input[type=checkbox], input[type=radio], [role=checkbox], [role=switch], [role=radio]");

const scrollPage = (dy, dx = 0) => window.scrollBy({ top: dy, left: dx, behavior: "smooth" });

// The browser's own effect of a key, which synthetic events don't trigger.
const defaultKeyAction = (target, key, mods) => {
  const editable = isTextField(target);
  const plain = !mods.Control && !mods.Meta && !mods.Alt;
  switch (key) {
    case "Enter":
      if (target.tagName === "TEXTAREA" || (editable && target.isContentEditable)) {
        if (plain) insertText(target, "\n");
        return "newline";
      }
      if (target.tagName === "INPUT" && target.form && editable) {
        target.form.requestSubmit();
        return "submitted";
      }
      if (isActivatable(target)) {
        target.click();
        return "activated";
      }
      return null;
    case " ":
      if (editable) {
        insertText(target, " ");
        return "typed";
      }
      if (isActivatable(target) || isToggle(target)) {
        target.click();
        return "activated";
      }
      scrollPage((mods.Shift ? -1 : 1) * window.innerHeight * 0.8);
      return "scrolled";
    case "Tab": {
      const next = moveFocus(Boolean(mods.Shift));
      return next ? `focused ${refFor(next)}` : null;
    }
    case "Backspace":
    case "Delete":
      if (editable) {
        document.execCommand(key === "Backspace" ? "delete" : "forwardDelete", false);
        return "deleted";
      }
      return null;
    case "ArrowDown":
    case "ArrowUp":
      if (editable || target !== document.body) return null;
      scrollPage(key === "ArrowDown" ? 60 : -60);
      return "scrolled";
    case "PageDown":
    case "PageUp":
      if (editable) return null;
      scrollPage((key === "PageDown" ? 1 : -1) * window.innerHeight * 0.85);
      return "scrolled";
    case "Home":
    case "End":
      if (editable) return null;
      window.scrollTo({ top: key === "Home" ? 0 : document.documentElement.scrollHeight, behavior: "smooth" });
      return "scrolled";
    default:
      if (key.length !== 1) return null;
      if ((mods.Control || mods.Meta) && key.toLowerCase() === "a" && editable) {
        selectAll(target);
        return "selected all";
      }
      if (plain && editable) {
        insertText(target, mods.Shift ? key.toUpperCase() : key);
        return "typed";
      }
      return null;
  }
};

const press = async ({ key: combo }) => {
  const { key, mods } = parseKey(String(combo));
  const target = deepActiveElement() || document.body;
  const allowed = keyEvent(target, "keydown", key, mods);
  let effect = null;
  if (allowed) {
    if (key.length === 1 || key === "Enter") keyEvent(target, "keypress", key, mods);
    effect = defaultKeyAction(target, key, mods);
  }
  await sleep(jitter(70, 20));
  keyEvent(target, "keyup", key, mods);
  await sleep(100);
  return {
    pressed: combo,
    target: target === document.body ? { role: "document" } : describe(target),
    effect: allowed ? effect : "prevented by the page",
  };
};

// ---- scrolling -------------------------------------------------------------

const scrollableAncestor = (el) => {
  for (let node = el; node && node !== document.body; node = node.parentElement || node.getRootNode()?.host) {
    if (!(node instanceof Element)) continue;
    const style = getComputedStyle(node);
    const canY = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    const canX = /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
    if (canY || canX) return node;
  }
  return null;
};

const scroll = async ({ ref, direction, amount }, cursorPos) => {
  if (ref) {
    const el = resolveRef(ref);
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    await settle(() => Math.round(boxOf(el).top));
    const rect = boxOf(el);
    return { scrolledTo: describe(el), box: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)] };
  }
  // Scroll whatever is under the cursor, like a mouse wheel would; the page
  // when the cursor isn't over a scrollable panel.
  const under = cursorPos ? deepElementFromPoint(cursorPos.x, cursorPos.y) : null;
  const panel = under && !isOwnUi(under) ? scrollableAncestor(under) : null;
  const scroller = panel || document.scrollingElement || document.documentElement;
  const vertical = direction === "up" || direction === "down";
  const sign = direction === "down" || direction === "right" ? 1 : -1;
  const viewport = panel ? (vertical ? panel.clientHeight : panel.clientWidth) : vertical ? window.innerHeight : window.innerWidth;
  const distance = sign * (amount || Math.round(viewport * 0.8));
  const before = { x: scroller.scrollLeft, y: scroller.scrollTop };
  const opts = { [vertical ? "top" : "left"]: distance, behavior: "smooth" };
  if (panel) panel.scrollBy(opts);
  else window.scrollBy(opts);
  await settle(() => `${scroller.scrollLeft},${scroller.scrollTop}`);
  const max = vertical ? scroller.scrollHeight - scroller.clientHeight : scroller.scrollWidth - scroller.clientWidth;
  const now = vertical ? scroller.scrollTop : scroller.scrollLeft;
  return {
    scrolled: { x: Math.round(scroller.scrollLeft - before.x), y: Math.round(scroller.scrollTop - before.y) },
    position: { x: Math.round(scroller.scrollLeft), y: Math.round(scroller.scrollTop) },
    container: panel ? describe(panel) : "page",
    atEnd: sign > 0 ? now >= max - 1 : now <= 1,
  };
};

// ---- waiting ---------------------------------------------------------------

// One look; the worker polls, so a wait survives navigations.
const check = ({ text, ref, state }) => {
  let present;
  if (text !== undefined) {
    present = (document.body?.innerText || "").toLowerCase().includes(String(text).toLowerCase());
  } else {
    let el = null;
    try {
      el = resolveRef(ref);
    } catch (err) {
      if (state === "hidden") return { satisfied: true, gone: true };
      throw err;
    }
    present = isVisible(el);
  }
  return { satisfied: state === "hidden" ? !present : present };
};

export const performAction = async (action, params, cursorPos) => {
  switch (action) {
    case "snapshot":
      return snapshot(params);
    case "click":
      return click(params);
    case "type":
      return type(params);
    case "press":
      return press(params);
    case "scroll":
      return scroll(params, cursorPos);
    case "check":
      return check(params);
    default:
      throw pageError(PageErrorCode.InvalidParams, `Unknown page action ${action}`);
  }
};
