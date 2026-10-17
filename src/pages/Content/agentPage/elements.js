// What the agent sees of the page: a compact list of the elements a person
// could interact with, each with a ref that stays the same for that element
// while it is on the page.
export const PageErrorCode = {
  StaleRef: "STALE_REF",
  ElementNotInteractable: "ELEMENT_NOT_INTERACTABLE",
  ElementObscured: "ELEMENT_OBSCURED",
  InvalidParams: "INVALID_PARAMS",
};

export const pageError = (code, message, data) =>
  Object.assign(new Error(message), { code, data });

// Recordful's own UI (popup, recording pill, countdown) and the agent cursor
// are never part of the page as far as the agent is concerned.
export const CURSOR_HOST_ID = "recordful-agent-cursor";
const OWN_UI_IDS = ["recordful-ui", "recordful-root-container", "recordful-dev-hud-portal", CURSOR_HOST_ID];
const OWN_UI = OWN_UI_IDS.map((id) => `#${id}`).join(", ");
export const isOwnUi = (el) => Boolean(el?.closest?.(OWN_UI));

const INTERACTIVE = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[contenteditable='']",
  "[contenteditable=true]",
  "[contenteditable=plaintext-only]",
  "[tabindex]:not([tabindex='-1'])",
  "[onclick]",
  ...[
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "combobox",
    "textbox",
    "searchbox",
    "slider",
    "spinbutton",
    "treeitem",
  ].map((role) => `[role=${role}]`),
].join(",");
const HEADING = "h1, h2, h3, [role=heading]";
const SKIP_SUBTREE = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "svg", "IFRAME", "OBJECT"]);
const MAX_ELEMENTS = 300;
const MAX_WALK = 25000;
const NAME_MAX = 100;

// ---- refs ------------------------------------------------------------------

let nextRef = 1;
const refOf = new WeakMap();
const byRef = new Map();

export const refFor = (el) => {
  let ref = refOf.get(el);
  if (!ref) {
    ref = `e${nextRef++}`;
    refOf.set(el, ref);
    byRef.set(ref, new WeakRef(el));
  }
  return ref;
};

export const resolveRef = (ref) => {
  const el = byRef.get(ref)?.deref();
  if (!el || !el.isConnected) {
    if (el === undefined && !byRef.has(ref)) {
      throw pageError(PageErrorCode.StaleRef, `No element ${ref} on this page. Take a new snapshot.`);
    }
    byRef.delete(ref);
    throw pageError(PageErrorCode.StaleRef, `Element ${ref} is no longer on the page. Take a new snapshot.`);
  }
  return el;
};

// ---- roles and names -------------------------------------------------------

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number", ""]);

export const inputType = (el) => (el.getAttribute("type") || "").toLowerCase();

export const isTextField = (el) => {
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return !el.readOnly;
  if (el.tagName === "INPUT") {
    const type = inputType(el);
    return (TEXT_INPUTS.has(type) || ["date", "time", "datetime-local", "month", "week"].includes(type)) && !el.readOnly;
  }
  return false;
};

export const roleOf = (el) => {
  const explicit = (el.getAttribute("role") || "").trim().split(/\s+/)[0];
  if (explicit) return explicit;
  switch (el.tagName) {
    case "A":
      return el.hasAttribute("href") ? "link" : "generic";
    case "BUTTON":
    case "SUMMARY":
      return "button";
    case "SELECT":
      return el.multiple || el.size > 1 ? "listbox" : "combobox";
    case "TEXTAREA":
      return "textbox";
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return "heading";
    case "INPUT": {
      const type = inputType(el);
      if (["button", "submit", "reset", "image", "file"].includes(type)) return "button";
      if (type === "checkbox" || type === "radio") return type;
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    default:
      if (el.isContentEditable) return "textbox";
      return "generic";
  }
};

const squash = (text) => String(text || "").replace(/\s+/g, " ").trim();
const clip = (text, max = NAME_MAX) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const textOf = (el) => squash(el.innerText ?? el.textContent);

export const nameOf = (el) => {
  const root = el.getRootNode();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = squash(
      labelledBy
        .split(/\s+/)
        .map((id) => root.getElementById?.(id) || document.getElementById(id))
        .filter(Boolean)
        .map(textOf)
        .join(" "),
    );
    if (text) return clip(text);
  }
  const aria = squash(el.getAttribute("aria-label"));
  if (aria) return clip(aria);

  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    const type = inputType(el);
    if (tag === "INPUT" && ["button", "submit", "reset"].includes(type)) {
      return clip(squash(el.value) || (type === "reset" ? "Reset" : "Submit"));
    }
    if (tag === "INPUT" && type === "image") return clip(squash(el.alt) || "Submit");
    const labels = el.labels ? [...el.labels].map(textOf).filter(Boolean) : [];
    if (labels.length) return clip(squash(labels.join(" ")));
    const hint = squash(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("aria-placeholder"));
    if (hint) return clip(hint);
    return "";
  }
  if (tag === "IMG") return clip(squash(el.alt || el.title));

  const text = textOf(el);
  if (text) return clip(text);
  const title = squash(el.getAttribute("title"));
  if (title) return clip(title);
  const img = el.querySelector?.("img[alt], svg[aria-label], [aria-label]");
  if (img) return clip(squash(img.getAttribute("alt") || img.getAttribute("aria-label")));
  return "";
};

// State a person would see: field contents, checked, expanded, and so on.
const stateOf = (el, role) => {
  const out = {};
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    const type = inputType(el);
    if (type === "checkbox" || type === "radio") out.checked = el.checked;
    else if (!["button", "submit", "reset", "image", "file"].includes(type)) {
      const value = String(el.value || "");
      if (value) out.value = type === "password" ? "•".repeat(Math.min(value.length, 8)) : clip(value, 200);
      if (el.readOnly) out.readOnly = true;
    }
  } else if (tag === "SELECT") {
    const selected = [...el.selectedOptions].map((o) => squash(o.label || o.text));
    if (selected.length) out.value = clip(selected.join(", "), 200);
    out.options = el.options.length;
  } else if (el.isContentEditable && role === "textbox") {
    const value = textOf(el);
    if (value) out.value = clip(value, 200);
  }
  for (const [attr, key] of [
    ["aria-checked", "checked"],
    ["aria-expanded", "expanded"],
    ["aria-selected", "selected"],
    ["aria-pressed", "pressed"],
  ]) {
    const value = el.getAttribute(attr);
    if (value === "true" || value === "false") out[key] = value === "true";
    else if (value === "mixed") out[key] = "mixed";
  }
  if (el.disabled || el.getAttribute("aria-disabled") === "true" || el.closest?.("[inert]")) {
    out.disabled = true;
  }
  if (role === "heading") {
    const level = Number(el.getAttribute("aria-level") || el.tagName.slice(1));
    if (level) out.level = level;
  }
  if (role === "link") {
    const href = el.getAttribute("href") || "";
    if (href && !href.startsWith("javascript:")) out.href = clip(href, 200);
  }
  if (el === deepActiveElement()) out.focused = true;
  return out;
};

// ---- geometry and visibility ----------------------------------------------

export const boxOf = (el) => {
  let rect = el.getBoundingClientRect();
  // An inline <a> wrapping a block reports an empty box; its child doesn't.
  if ((rect.width === 0 || rect.height === 0) && el.firstElementChild) {
    rect = el.firstElementChild.getBoundingClientRect();
  }
  return rect;
};

export const isVisible = (el) => {
  const rect = boxOf(el);
  if (rect.width < 1 || rect.height < 1) return false;
  // Not aria-hidden: modal dialogs (Recordful's own popup among them) mark
  // the whole page aria-hidden while they are open, yet it is still on screen.
  if (typeof el.checkVisibility === "function") {
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
};

const inViewport = (rect) =>
  rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;

export const deepActiveElement = () => {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
};

export const deepElementFromPoint = (x, y) => {
  let el = document.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
};

// A label standing in for its hidden checkbox reads as the checkbox.
export const describe = (el) => {
  const control = el.tagName === "LABEL" ? el.control : null;
  const role = control && ["checkbox", "radio"].includes(inputType(control)) ? inputType(control) : roleOf(el);
  return { ref: refFor(el), role, name: nameOf(control || el) || nameOf(el) };
};

// ---- snapshot --------------------------------------------------------------

// Elements in document order, through open shadow roots, skipping our own UI.
function* walk(root, budget) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (budget.left-- <= 0) {
      budget.exhausted = true;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      // Checking the node itself is enough: its subtree is skipped with it.
      if (SKIP_SUBTREE.has(node.tagName) || OWN_UI_IDS.includes(node.id)) continue;
      yield node;
    }
    const children = [];
    if (node.shadowRoot) children.push(node.shadowRoot);
    for (let child = node.firstElementChild; child; child = child.nextElementSibling) children.push(child);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

// Clickable divs with no role: a pointer cursor that starts here, not one
// inherited from a link or button around it. The walk visits parents first,
// so the cache makes this one style lookup per element.
const looksClickable = (el, cursorCache) => {
  const pointer = (node) => {
    if (!node) return false;
    let value = cursorCache.get(node);
    if (value === undefined) {
      value = getComputedStyle(node).cursor === "pointer";
      cursorCache.set(node, value);
    }
    return value;
  };
  if (!pointer(el) || pointer(el.parentElement)) return false;
  return !el.parentElement?.closest(INTERACTIVE);
};

// Big focusable or clickable wrappers (app roots, cards with tabindex) only
// add noise; a person clicks something inside them.
const isContainer = (el, rect) =>
  !el.matches("a[href], button, input, select, textarea, summary, [role]") &&
  rect.width * rect.height > window.innerWidth * window.innerHeight * 0.4;

// Checkboxes and radios are often hidden behind a styled label.
const visibleLabelFor = (control) =>
  [...(control.labels || [])].find((label) => !isOwnUi(label) && isVisible(label)) || null;

export const snapshot = ({ scope = "page" } = {}) => {
  const budget = { left: MAX_WALK, exhausted: false };
  const elements = [];
  const seen = new Set();
  let skipped = 0;
  const cursorCache = new Map();

  for (const el of walk(document.documentElement, budget)) {
    const isHeading = el.matches(HEADING);
    let target = el;
    let role;
    if (el.matches(INTERACTIVE) || isHeading) {
      role = roleOf(el);
    } else if (looksClickable(el, cursorCache)) {
      role = "clickable";
    } else {
      continue;
    }
    if (!isVisible(el)) {
      const label = (role === "checkbox" || role === "radio") && visibleLabelFor(el);
      if (!label) continue;
      target = label;
    }
    if (seen.has(target)) continue;
    const rect = boxOf(target);
    if (role === "generic" || role === "clickable") {
      if (isContainer(target, rect)) continue;
    }
    const visibleNow = inViewport(rect);
    if (scope === "viewport" && !visibleNow) continue;
    seen.add(target);
    if (elements.length >= MAX_ELEMENTS) {
      skipped++;
      continue;
    }
    const entry = {
      ref: refFor(target),
      role,
      name: target === el ? nameOf(el) : nameOf(el) || nameOf(target),
      ...stateOf(el, role),
      box: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
    };
    if (!visibleNow) entry.offscreen = true;
    elements.push(entry);
  }

  const scroller = document.scrollingElement || document.documentElement;
  const focused = deepActiveElement();
  return {
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY),
      maxY: Math.max(0, Math.round(scroller.scrollHeight - window.innerHeight)),
    },
    boxFormat: "[x, y, width, height] in CSS pixels from the viewport's top-left",
    focused: focused && focused !== document.body && !isOwnUi(focused) ? refFor(focused) : null,
    elements,
    ...(skipped ? { truncated: skipped, hint: 'More elements than fit; use scope "viewport" after scrolling.' } : {}),
    ...(budget.exhausted ? { walkTruncated: true } : {}),
    ...(document.querySelector("iframe") ? { note: "Content inside iframes isn't listed." } : {}),
  };
};
