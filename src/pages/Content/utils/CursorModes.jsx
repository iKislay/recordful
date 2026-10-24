import React, { useState, useEffect, useContext, useMemo, useRef } from "react";

import { contentStateContext } from "../context/ContentState";
import {
  CLICK_EFFECTS,
  pictureHeight,
  showClickEffect,
} from "../cursor/clickEffects";

const CursorModes = () => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const effectsRef = useRef(new Set());
  // Refs to avoid querySelector per mousemove.
  const cursorHighlightRef = useRef(null);
  // What is recorded, which sets how large a click's effect is.
  const pictureRef = useRef({ surface: "default", region: false, regionHeight: 0 });
  const spotlightRef = useRef(null);

  useEffect(() => {
    const nextEffects = Array.isArray(contentState.cursorEffects)
      ? contentState.cursorEffects
      : [];
    effectsRef.current = new Set(nextEffects);
  }, [contentState.cursorEffects]);

  useEffect(() => {
    pictureRef.current = {
      ...pictureRef.current,
      region: Boolean(contentState.customRegion),
      regionHeight: contentState.regionHeight,
    };
  }, [contentState.customRegion, contentState.regionHeight]);

  useEffect(() => {
    const surfaceOf = (surface) => {
      pictureRef.current = { ...pictureRef.current, surface: surface || "default" };
    };
    chrome.storage.local
      .get("surface")
      .then(({ surface }) => surfaceOf(surface))
      .catch(() => {});
    const onChanged = (changes, area) => {
      if (area === "local" && changes.surface) surfaceOf(changes.surface.newValue);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const mouseDownHandler = (e) => {
    const effect = CLICK_EFFECTS.find((each) => effectsRef.current.has(each));
    if (effect) {
      showClickEffect(
        effect,
        e.clientX,
        e.clientY,
        pictureHeight(pictureRef.current),
      );
    }
  };

  const [lastMousePosition, setLastMousePosition] = useState({ x: 0, y: 0 });
  const lastMouseRef = useRef(lastMousePosition);

  useEffect(() => {
    lastMouseRef.current = lastMousePosition;
  }, [lastMousePosition]);

  const updateCursorPosition = () => {
    const scrollTop = window.scrollY;
    const scrollLeft = window.scrollX;
    const mouseX = lastMouseRef.current.x;
    const mouseY = lastMouseRef.current.y;

    if (effectsRef.current.has("highlight")) {
      const highlight = cursorHighlightRef.current;
      if (highlight) {
        highlight.style.top = mouseY + scrollTop + "px";
        highlight.style.left = mouseX + scrollLeft + "px";
      }
    }

    if (effectsRef.current.has("spotlight")) {
      const spotlight = spotlightRef.current;
      if (spotlight) {
        spotlight.style.top = mouseY + scrollTop + "px";
        spotlight.style.left = mouseX + scrollLeft + "px";
      }
    }
  };

  // Coalesce DOM writes + setState into one RAF; mousemove fires at >120Hz
  // on modern trackpads.
  const stateRafRef = useRef(null);
  const scheduleCursorUpdate = () => {
    // With no effect active the callback below does nothing, and we're injected on
    // every page, so skip the rAF rather than schedule an empty frame per move.
    if (effectsRef.current.size === 0) return;
    if (stateRafRef.current !== null) return;
    stateRafRef.current = requestAnimationFrame(() => {
      stateRafRef.current = null;
      if (effectsRef.current.size > 0) {
        updateCursorPosition();
      }
      // Spotlight is the only effect reading lastMousePosition from render.
      if (effectsRef.current.has("spotlight")) {
        setLastMousePosition(lastMouseRef.current);
      }
    });
  };
  const mouseMoveHandler = (e) => {
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    scheduleCursorUpdate();
  };

  const scrollHandler = () => {
    scheduleCursorUpdate();
  };

  useEffect(() => {
    document.addEventListener("mousedown", mouseDownHandler);
    document.addEventListener("mousemove", mouseMoveHandler);
    document.addEventListener("scroll", scrollHandler);

    return () => {
      document.removeEventListener("mousedown", mouseDownHandler);
      document.removeEventListener("mousemove", mouseMoveHandler);
      document.removeEventListener("scroll", scrollHandler);
      if (stateRafRef.current !== null) {
        cancelAnimationFrame(stateRafRef.current);
        stateRafRef.current = null;
      }
    };
  }, []);

  // Derive once per render so JSX doesn't re-scan the array three times.
  // Memoized styles let React skip diffing on highlight/target while
  // spotlight (depends on lastMousePosition) re-styles freely.
  const effects = contentState.cursorEffects;
  const showHighlight = Array.isArray(effects) && effects.includes("highlight");
  const showSpotlight = Array.isArray(effects) && effects.includes("spotlight");

  const highlightStyle = useMemo(
    () => ({
      display: "block",
      visibility: showHighlight ? "visible" : "hidden",
      position: "absolute",
      top: 0,
      left: 0,
      width: "80px",
      height: "80px",
      pointerEvents: "none",
      zIndex: 99999999999,
      background: "yellow",
      opacity: ".5",
      transform: "translate(-50%, -50%)",
      borderRadius: "50%",
      animation: "none",
    }),
    [showHighlight],
  );

  return (
    <div>
      <div
        ref={cursorHighlightRef}
        className="cursor-highlight"
        style={highlightStyle}
      ></div>
      <div
        ref={spotlightRef}
        className="spotlight"
        style={{
          position: "absolute",
          display: showSpotlight ? "block" : "none",
          top: lastMousePosition.y + "px",
          left: lastMousePosition.x + "px",
          width: "100px",
          height: "100px",
          borderRadius: "50%",
          boxShadow: "0 0 0 9999px var(--rf-fixed-overlay)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          zIndex: 99999999999,
        }}
      ></div>
    </div>
  );
};

export default CursorModes;
