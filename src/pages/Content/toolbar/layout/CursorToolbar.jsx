import React, { useState, useEffect, useContext, useRef } from "react";
import * as Toolbar from "@radix-ui/react-toolbar";
import TooltipWrap from "../components/TooltipWrap";

import { toggledEffects } from "../../cursor/clickEffects";

// Context
import { contentStateContext } from "../../context/ContentState";

// Icons
import {
  CursorIcon,
  ClickCircleIcon,
  ClickRippleIcon,
  ClickPressureIcon,
  HighlightCursorIcon,
  SpotlightCursorIcon,
  HideCursorIcon,
} from "../components/SVG";

const CursorToolbar = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const lastClickedEffectRef = useRef(contentState.cursorMode || "none");

  useEffect(() => {
    if (contentState.cursorMode) {
      lastClickedEffectRef.current = contentState.cursorMode;
    }
  }, [contentState.cursorMode]);

  const deriveCursorMode = (effects, fallback) => {
    if (effects.length === 0) return "none";
    if (effects.length === 1) return effects[0];
    if (fallback && effects.includes(fallback)) return fallback;
    return effects[0] || "none";
  };

  const applyCursorSelection = (effect, shiftKey) => {
    if (effect === "none") {
      lastClickedEffectRef.current = "none";
      setContentState((prev) => ({
        ...prev,
        cursorEffects: [],
        cursorMode: "none",
      }));
      if (!shiftKey) {
        props.setMode(false);
      }
      chrome.storage.local.set({
        cursorEffects: [],
        cursorMode: "none",
      });
      return;
    }

    const currentEffects = Array.isArray(contentState.cursorEffects)
      ? contentState.cursorEffects
      : [];

    const nextEffects = shiftKey
      ? toggledEffects(currentEffects, effect)
      : [effect];

    lastClickedEffectRef.current = effect;
    const nextMode = deriveCursorMode(
      nextEffects,
      lastClickedEffectRef.current
    );

    setContentState((prev) => ({
      ...prev,
      cursorEffects: nextEffects,
      cursorMode: nextMode,
    }));
    if (!shiftKey) {
      props.setMode(false);
    }
    chrome.storage.local.set({
      cursorEffects: nextEffects,
      cursorMode: nextMode,
    });
  };

  const handleClick = (effect) => (event) => {
    applyCursorSelection(effect, Boolean(event.shiftKey));
  };

  const cursorEffects = Array.isArray(contentState.cursorEffects)
    ? contentState.cursorEffects
    : [];
  const isDefault = cursorEffects.length === 0;
  const toggleValues = isDefault ? ["none"] : cursorEffects;
  const isEffectActive = (effect) =>
    effect === "none" ? isDefault : cursorEffects.includes(effect);

  return (
    <Toolbar.Root
      className={"DrawingToolbar" + " " + props.visible}
      aria-label="Cursor options"
      tabIndex="0"
    >
      <Toolbar.ToggleGroup
        type="multiple"
        className="ToolbarToggleGroup"
        value={toggleValues}
        onValueChange={() => {}}
      >
        <TooltipWrap content="Default" shortcut="0">
          <div className="ToolbarToggleWrap">
            <Toolbar.ToggleItem
              className="ToolbarToggleItem"
              value="none"
              data-state={isEffectActive("none") ? "on" : "off"}
              onClick={handleClick("none")}
            >
              <CursorIcon />
            </Toolbar.ToggleItem>
          </div>
        </TooltipWrap>
        <Toolbar.Separator className="ToolbarSeparator" />
        <TooltipWrap
          content={chrome.i18n.getMessage("clickCircleTooltip")}
          shortcut="1"
        >
          <div className="ToolbarToggleWrap">
            <Toolbar.ToggleItem
              className="ToolbarToggleItem"
              value="circle"
              data-state={isEffectActive("circle") ? "on" : "off"}
              onClick={handleClick("circle")}
            >
              <ClickCircleIcon />
            </Toolbar.ToggleItem>
          </div>
        </TooltipWrap>
        <TooltipWrap
          content={chrome.i18n.getMessage("clickRippleTooltip")}
          shortcut="2"
        >
          <div className="ToolbarToggleWrap">
            <Toolbar.ToggleItem
              className="ToolbarToggleItem"
              value="ripple"
              data-state={isEffectActive("ripple") ? "on" : "off"}
              onClick={handleClick("ripple")}
            >
              <ClickRippleIcon />
            </Toolbar.ToggleItem>
          </div>
        </TooltipWrap>
        <TooltipWrap
          content={chrome.i18n.getMessage("clickPressureTooltip")}
          shortcut="3"
        >
          <div className="ToolbarToggleWrap">
            <Toolbar.ToggleItem
              className="ToolbarToggleItem"
              value="pressure"
              data-state={isEffectActive("pressure") ? "on" : "off"}
              onClick={handleClick("pressure")}
            >
              <ClickPressureIcon />
            </Toolbar.ToggleItem>
          </div>
        </TooltipWrap>
        <TooltipWrap
          content={chrome.i18n.getMessage("highlightCursorTooltip")}
          shortcut="4"
        >
          <div className="ToolbarToggleWrap">
            <Toolbar.ToggleItem
              className="ToolbarToggleItem"
              value="highlight"
              data-state={isEffectActive("highlight") ? "on" : "off"}
              onClick={handleClick("highlight")}
            >
              <HighlightCursorIcon />
            </Toolbar.ToggleItem>
          </div>
        </TooltipWrap>
        <TooltipWrap
          content={chrome.i18n.getMessage("spotlightCursorTooltip")}
          shortcut="5"
        >
          <div className="ToolbarToggleWrap">
            <Toolbar.ToggleItem
              className="ToolbarToggleItem"
              value="spotlight"
              data-state={isEffectActive("spotlight") ? "on" : "off"}
              onClick={handleClick("spotlight")}
            >
              <SpotlightCursorIcon />
            </Toolbar.ToggleItem>
          </div>
        </TooltipWrap>
      </Toolbar.ToggleGroup>
    </Toolbar.Root>
  );
};

export default CursorToolbar;
