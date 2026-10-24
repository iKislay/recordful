// The click effects of the recording toolbar, drawn the way the web editor
// draws them (recordful-ee, lib/cursor.ts: keep the two in step), so a click
// looks the same whichever of them shows it.

// What a click can show, besides the cursor highlight and the spotlight.
export const CLICK_EFFECTS = ["circle", "ripple", "pressure"];

// Every effect the toolbar offers. "target" is what the click ring was called
// before there were three; it is kept as the circle.
export const CURSOR_EFFECTS = [...CLICK_EFFECTS, "highlight", "spotlight"];

export const normalizeCursorEffects = (effects) => {
  if (!Array.isArray(effects)) return [];
  return [
    ...new Set(
      effects.map((effect) => (effect === "target" ? "circle" : effect)),
    ),
  ].filter((effect) => CURSOR_EFFECTS.includes(effect));
};

/**
 * The effects after `effect` is switched on or, when it was on, off. A click
 * shows one effect at a time, so switching one on replaces another.
 */
export const toggledEffects = (effects, effect) => {
  if (effects.includes(effect)) return effects.filter((each) => each !== effect);
  const kept = CLICK_EFFECTS.includes(effect)
    ? effects.filter((each) => !CLICK_EFFECTS.includes(each))
    : effects;
  return [...kept, effect];
};

// How long a click's effect lasts, in seconds.
const DURATION = { circle: 0.45, ripple: 0.7, pressure: 0.35 };
// How large an effect is, as a share of the recorded picture's height: about
// the height of a usual cursor, which is what it surrounds.
const SIZE = 0.03;
// How far from its centre an effect reaches, in units of its size.
const REACH = 1.6;

/** `t` from 0 to 1, slowing as it arrives. */
const out = (t) => 1 - (1 - t) ** 3;

// Draws a click's effect, `since` seconds after it, around 0, 0.
function drawEffect(context, effect, since, unit) {
  const t = since / DURATION[effect];
  context.save();
  if (effect === "circle") {
    context.beginPath();
    context.arc(0, 0, unit * (0.35 + 0.65 * out(t)), 0, Math.PI * 2);
    context.fillStyle = `rgba(255, 255, 255, ${0.45 * (1 - t)})`;
    context.fill();
    context.strokeStyle = `rgba(0, 0, 0, ${0.25 * (1 - t)})`;
    context.lineWidth = unit * 0.05;
    context.stroke();
  } else if (effect === "ripple") {
    // Rings one after another, each widening as it fades.
    for (const delay of [0, 0.18]) {
      const r = (since - delay) / (DURATION.ripple - 0.18);
      if (r < 0 || r > 1) continue;
      context.beginPath();
      context.arc(0, 0, unit * (0.2 + 1.1 * out(r)), 0, Math.PI * 2);
      context.lineWidth = unit * 0.09 * (1 - r) + unit * 0.02;
      context.strokeStyle = `rgba(0, 0, 0, ${0.3 * (1 - r)})`;
      context.stroke();
      context.lineWidth *= 0.5;
      context.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - r)})`;
      context.stroke();
    }
  } else {
    // A soft dent, closing as it lets go.
    context.beginPath();
    context.arc(0, 0, unit * 0.55 * (1 - 0.4 * out(t)), 0, Math.PI * 2);
    context.fillStyle = `rgba(0, 0, 0, ${0.18 * (1 - t)})`;
    context.fill();
  }
  context.restore();
}

/**
 * How tall the recorded picture is, in the page's pixels: the page's own
 * height for a tab, the region's for a region, and the window's or the
 * screen's when those are what is recorded.
 */
export function pictureHeight({ surface, region, regionHeight }) {
  if (region) return regionHeight;
  if (surface === "monitor") return window.screen.height;
  if (surface === "window") return window.outerHeight;
  return window.innerHeight;
}

/** Shows `effect` where the pointer pressed, `x` and `y` in the viewport. */
export function showClickEffect(effect, x, y, height) {
  const unit = height * SIZE;
  // A whole number of pixels, so the effect sits where the click was.
  const half = Math.ceil(unit * REACH);
  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.round(half * 2 * ratio);
  Object.assign(canvas.style, {
    position: "fixed",
    left: `${x - half}px`,
    top: `${y - half}px`,
    width: `${half * 2}px`,
    height: `${half * 2}px`,
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  const context = canvas.getContext("2d");
  const start = performance.now();
  const frame = (now) => {
    const since = Math.max(0, now - start) / 1000;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (since >= DURATION[effect]) {
      canvas.remove();
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, half * ratio, half * ratio);
    drawEffect(context, effect, since, unit);
    requestAnimationFrame(frame);
  };
  document.documentElement.append(canvas);
  requestAnimationFrame(frame);
}
