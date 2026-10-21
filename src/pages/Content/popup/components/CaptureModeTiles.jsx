import React, { useRef } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";

import TooltipWrap from "./TooltipWrap";

// Capture-mode picker modelled on macOS's screenshot bar: three tiles, icon
// over label, one soft highlight that slides to the picked tile.
// Screen and Window both record through the desktop picker (recordingType
// "screen"); Window only asks it to open on the window list. Area is the
// tab region with the draggable crop box (recordingType "region").

const ICON_PROPS = {
  width: 26,
  height: 26,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

const ScreenIcon = () => (
  <svg {...ICON_PROPS}>
    <rect x="2.75" y="4.25" width="18.5" height="15" rx="3.25" />
    <rect
      x="6.5"
      y="14.5"
      width="11"
      height="2.25"
      rx="1.125"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

const WindowIcon = () => (
  <svg {...ICON_PROPS}>
    <rect x="2.75" y="4.25" width="18.5" height="15" rx="3.25" />
    <path d="M2.75 9h18.5" />
    <circle cx="6.1" cy="6.65" r="0.85" fill="currentColor" stroke="none" />
    <circle cx="8.6" cy="6.65" r="0.85" fill="currentColor" stroke="none" />
    <circle cx="11.1" cy="6.65" r="0.85" fill="currentColor" stroke="none" />
  </svg>
);

// Solid rounded corners with one dash centred on each side, like the macOS
// selection glyph; a plain dasharray would break the corners unevenly.
const AreaIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M3.5 8.4V7.5a4 4 0 0 1 4-4h.9" />
    <path d="M15.6 3.5h.9a4 4 0 0 1 4 4v.9" />
    <path d="M20.5 15.6v.9a4 4 0 0 1-4 4h-.9" />
    <path d="M8.4 20.5h-.9a4 4 0 0 1-4-4v-.9" />
    <path d="M11 3.5h2M20.5 11v2M11 20.5h2M3.5 11v2" />
  </svg>
);

export const CAPTURE_MODES = [
  { id: "screen", label: "screenType", Icon: ScreenIcon },
  { id: "window", label: "windowType", Icon: WindowIcon },
  { id: "area", label: "areaType", Icon: AreaIcon },
];

const CaptureModeTiles = ({ value, onChange, areaDisabled }) => {
  const reduce = useReducedMotion() ?? false;
  const tileRefs = useRef({});

  const isDisabled = (id) => id === "area" && areaDisabled;
  const enabled = CAPTURE_MODES.filter((mode) => !isDisabled(mode.id));

  // Radio-group keyboard model: arrows move the selection, skipping the
  // disabled tile, and focus follows it.
  const onKeyDown = (e) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step || !enabled.length) return;
    e.preventDefault();
    const at = Math.max(
      0,
      enabled.findIndex((mode) => mode.id === value)
    );
    const next = enabled[(at + step + enabled.length) % enabled.length];
    onChange(next.id);
    tileRefs.current[next.id]?.focus();
  };

  return (
    <LayoutGroup id="rf-capture-modes">
      <div
        className="capture-modes"
        role="radiogroup"
        aria-label={chrome.i18n.getMessage("captureModeLabel") || undefined}
        onKeyDown={onKeyDown}
      >
        {CAPTURE_MODES.map(({ id, label, Icon }) => {
          const selected = value === id;
          const disabled = isDisabled(id);
          const tile = (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled || undefined}
              tabIndex={selected ? 0 : -1}
              ref={(el) => {
                tileRefs.current[id] = el;
              }}
              className={
                "capture-mode" +
                (selected ? " is-selected" : "") +
                (disabled ? " is-disabled" : "")
              }
              onClick={() => {
                if (disabled || selected) return;
                onChange(id);
              }}
            >
              {selected && (
                <motion.span
                  layoutId="capture-mode-highlight"
                  className="capture-mode-highlight"
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 520, damping: 40, mass: 0.8 }
                  }
                />
              )}
              <span className="capture-mode-icon">
                <Icon />
              </span>
              <span className="capture-mode-label">
                {chrome.i18n.getMessage(label)}
              </span>
            </button>
          );
          return disabled ? (
            <TooltipWrap
              key={id}
              name="capture-mode-slot"
              content={chrome.i18n.getMessage("areaUnavailableTooltip")}
              side="bottom"
            >
              {tile}
            </TooltipWrap>
          ) : (
            <div key={id} className="capture-mode-slot">
              {tile}
            </div>
          );
        })}
      </div>
    </LayoutGroup>
  );
};

export default CaptureModeTiles;
