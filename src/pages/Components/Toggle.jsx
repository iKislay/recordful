import React, { useEffect, useRef, useState } from "react";

/* Shared liquid toggle input — the ONLY toggle-input UI in the codebase.
   Popup Switch and the editor Switch are state/layout wrappers
   around this; toolbar ToggleGroup/ToggleItem and Checkbox are different
   controls (press buttons / checkmarks) and intentionally untouched. */

/* Geometry: compact iOS-style switch for dense settings rows:
   38x22 track, 16 droplet, 3px air. */
const TRACK_W = 38;
const TRACK_H = 22;
const THUMB = 16;
const PAD = (TRACK_H - THUMB) / 2;
const SHUT_X = PAD;
const OPEN_X = TRACK_W - THUMB - PAD;
const MID_X = (SHUT_X + OPEN_X) / 2;
const RADIUS = TRACK_H / 2;
/* Pasted study divided velocity by 600 for a 44px crossing; divisor scales
   with travel so the stretch peaks the same here (~16px travel). */
const STRETCH_DIVISOR = 240;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const CSS = `
.rf-toggle {
  all: unset;
  display: inline-block;
  width: ${TRACK_W}px;
  height: ${TRACK_H}px;
  border-radius: ${RADIUS}px;
  position: relative;
  flex: none;
  background-color: #e5e5e0;
  transition: background-color 160ms ease;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
  cursor: pointer;
  box-sizing: border-box;
}
.rf-toggle[data-on="true"] {
  background-color: #111111;
}
.rf-toggle[data-disabled="true"] {
  opacity: 0.5;
  cursor: not-allowed;
}
.rf-toggle:focus-visible {
  outline: none;
  box-shadow: 0px 0px 0px 2px rgba(17, 17, 17, 0.2);
}
.rf-toggle-thumb {
  display: block;
  position: absolute;
  left: 0;
  top: ${PAD}px;
  width: ${THUMB}px;
  height: ${THUMB}px;
  border-radius: 50%;
  background-color: #fff;
  box-shadow: 0px 1px 4px rgba(0, 0, 0, 0.25);
  transform-origin: center;
  will-change: transform;
  pointer-events: none;
}
`;

function Toggle({
  checked,
  defaultChecked = false,
  onCheckedChange,
  onChange,
  disabled = false,
  id,
  label,
  stretch = 36,
  speed = 50,
  className,
  style,
}) {
  const controlled = checked !== undefined;
  const [internal, setInternal] = useState(defaultChecked);
  const on = controlled ? checked : internal;
  const [held, setHeld] = useState(false);
  const [hot, setHot] = useState(false);
  const railRef = useRef(null);
  const thumbRef = useRef(null);
  /* pointer-ownership; the grab offset is taken at the first MOVE so no
     press anywhere can teleport the droplet (see `move`). */
  const grip = useRef(null);
  /* last few samples for the velocity the stretch is read from. */
  const trail = useRef([]);
  const onRef = useRef(on);
  onRef.current = on;
  /* first paint places the thumb with no transition so mount never slides. */
  const placed = useRef(false);

  const commit = (next) => {
    if (!controlled) setInternal(next);
    if (typeof onCheckedChange === "function") onCheckedChange(next);
    if (typeof onChange === "function") onChange(next);
  };

  /* Rest position. Skipped while held so a drag owns the thumb, and so
     grabbing mid-flight tears down the settle exactly where it got to. */
  const stiffness = 170 - (50 - clamp(speed, 0, 100)) * 1.1;
  const settleMs = Math.round(220 * (170 / stiffness));
  const restX = on ? OPEN_X : SHUT_X;
  const swell = hot && !disabled ? 1.035 : 1;

  const paint = (x, sx = 1, sy = 1) => {
    const el = thumbRef.current;
    if (el) el.style.transform = `translateX(${x}px) scaleX(${sx}) scaleY(${sy})`;
  };

  useEffect(() => {
    if (held) return;
    trail.current = [];
    const el = thumbRef.current;
    if (el) {
      el.style.transition = placed.current
        ? `transform ${settleMs}ms cubic-bezier(0.34, 1.1, 0.5, 1)`
        : "none";
      paint(restX, swell, swell);
      placed.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restX, held, settleMs, swell]);

  /* Track is drawn at whatever scale the page allows; divide back out so a
     client delta means track units. */
  const local = (clientX) => {
    const el = railRef.current;
    if (!el) return 0;
    const b = el.getBoundingClientRect();
    const k = b.width / (el.offsetWidth || b.width) || 1;
    return (clientX - b.left) / k;
  };

  const velocity = () => {
    const t = trail.current;
    if (t.length < 2) return 0;
    const a = t[0];
    const b = t[t.length - 1];
    const dt = (b.at - a.at) / 1000;
    if (dt <= 0) return 0;
    return (b.x - a.x) / dt;
  };

  const down = (e) => {
    if (disabled) return;
    grip.current = { id: e.pointerId, grab: null, moved: false };
    trail.current = [];
    setHeld(true);
    const el = thumbRef.current;
    if (el) el.style.transition = "none";
    try {
      railRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer; drag works without capture */
    }
  };

  const move = (e) => {
    const g = grip.current;
    if (!g || g.id !== e.pointerId || disabled) return;
    const at = local(e.clientX);
    /* Offset taken from where the droplet IS, so the first move asks for
       exactly the position it already has and produces no displacement. */
    if (g.grab === null) {
      const cur = onRef.current ? OPEN_X : SHUT_X;
      g.grab = at - cur;
    }
    const next = clamp(at - g.grab, SHUT_X, OPEN_X);
    const cur = trail.current.length
      ? trail.current[trail.current.length - 1].x
      : next;
    if (Math.abs(next - cur) > 0.4 || g.moved) g.moved = true;
    trail.current.push({ x: next, at: performance.now() });
    if (trail.current.length > 6) trail.current.shift();
    const v = velocity();
    const k = 1 + Math.min(0.4, Math.abs(v) / STRETCH_DIVISOR) * (clamp(stretch, 0, 100) / 100);
    paint(next, k * swell, swell / k);
    /* Flips as it passes the middle so the track answers under the finger. */
    const past = next > MID_X;
    if (past !== onRef.current) commit(past);
  };

  const up = (e) => {
    const g = grip.current;
    if (!g) return;
    grip.current = null;
    try {
      railRef.current?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* never captured; must still clear `held` or the thumb never settles */
    }
    /* A press that never travelled is a click and toggles. */
    if (!g.moved && !disabled) commit(!onRef.current);
    setHeld(false);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    commit(!onRef.current);
  };

  return (
    <>
      <style>{CSS}</style>
      <button
        ref={railRef}
        type="button"
        id={id}
        role="switch"
        aria-checked={!!on}
        aria-label={label}
        aria-disabled={disabled || undefined}
        data-on={!!on}
        data-disabled={disabled || undefined}
        disabled={disabled}
        className={["rf-toggle", className].filter(Boolean).join(" ")}
        style={style}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerEnter={() => setHot(true)}
        onPointerLeave={() => setHot(false)}
        onKeyDown={onKeyDown}
      >
        <span ref={thumbRef} className="rf-toggle-thumb" aria-hidden="true" />
      </button>
    </>
  );
}

export default Toggle;
