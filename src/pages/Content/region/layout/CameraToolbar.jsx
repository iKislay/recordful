import React, { useState, useEffect, useContext } from "react";

import * as Toolbar from "@radix-ui/react-toolbar";

import { CameraCloseIcon, CameraMoreIcon } from "../../toolbar/components/SVG";
import { FlipHorizontal } from "@phosphor-icons/react";
import TooltipWrap from "../../toolbar/components/TooltipWrap";

// Context
import { contentStateContext } from "../../context/ContentState";

const CameraToolbar = () => {
  const [contentState, setContentState] = useContext(contentStateContext);

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
      <Toolbar.Button className="CameraToolbarButton CameraMore">
        <CameraMoreIcon />
      </Toolbar.Button>
    </Toolbar.Root>
  );
};

export default CameraToolbar;
