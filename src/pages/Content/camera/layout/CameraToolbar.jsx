import React, { useState, useEffect, useContext } from "react";

import * as Toolbar from "@radix-ui/react-toolbar";

import TooltipWrap from "../../toolbar/components/TooltipWrap";

import { CameraCloseIcon, Pip } from "../../toolbar/components/SVG";
import { FlipHorizontal } from "@phosphor-icons/react";

import { contentStateContext } from "../../context/ContentState";

const CameraToolbar = () => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const pipSupported =
    typeof document !== "undefined" && document.pictureInPictureEnabled;

  return (
    <Toolbar.Root className="camera-toolbar">
      <Toolbar.Button
        className="CameraToolbarButton"
        onClick={() => {
          setContentState((prevContentState) => ({
            ...prevContentState,
            cameraActive: false,
          }));
          chrome.storage.local.set({ cameraActive: false });
        }}
      >
        <CameraCloseIcon />
      </Toolbar.Button>
      <TooltipWrap
        content={
          chrome.i18n.getMessage("flipCameraLabel") || "Flip camera"
        }
      >
        <Toolbar.Button
          className="CameraToolbarButton"
          data-state={contentState.cameraFlipped ? "on" : "off"}
          aria-pressed={!!contentState.cameraFlipped}
          aria-label={chrome.i18n.getMessage("flipCameraLabel") || "Flip camera"}
          onClick={() => {
            const flipped = !contentState.cameraFlipped;
            setContentState((prevContentState) => ({
              ...prevContentState,
              cameraFlipped: flipped,
            }));
            chrome.storage.local.set({ cameraFlipped: flipped });
          }}
        >
          <FlipHorizontal size={16} />
        </Toolbar.Button>
      </TooltipWrap>
      {/* Manual toggle, deliberately not gated on surface or recordingType.
          Auto-PiP is decided in surfaceHandler; this is the way back into PiP
          after closing it, and `surface` is not reliably set on every flow. */}
      {pipSupported && (
        <TooltipWrap
          content={chrome.i18n.getMessage("togglePictureinPictureModeTooltip")}
        >
          <Toolbar.Button
            className="CameraToolbarButton CameraMore"
            onClick={() => {
              chrome.runtime.sendMessage({ type: "toggle-pip" });
            }}
          >
            <Pip />
          </Toolbar.Button>
        </TooltipWrap>
      )}
    </Toolbar.Root>
  );
};

export default CameraToolbar;
