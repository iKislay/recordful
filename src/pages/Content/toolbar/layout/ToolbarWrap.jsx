import React, {
  useLayoutEffect,
  useEffect,
  useContext,
  useState,
  useRef,
} from "react";
import * as Toolbar from "@radix-ui/react-toolbar";

import { Rnd } from "react-rnd";

// Drawing toolbar; was previously React.lazy'd to keep fabric out of
// the content-script hot bundle, but lazy chunks can't be loaded from
// a content script on strict-CSP pages (host's script-src blocks
// chrome-extension:// <script> injection even with
// web_accessible_resources). Static import is the only working option.
import DrawingToolbar from "./DrawingToolbar";
import CursorToolbar from "./CursorToolbar";
import BlurToolbar from "./BlurToolbar";

import ToolTrigger from "../components/ToolTrigger";
import Toast from "../components/Toast";

import { CloseIconPopup } from "../components/SVG";

import { contentStateContext, timerContext } from "../../context/ContentState";

import {
  GrabIcon,
  StopIcon,
  DrawIcon,
  PauseIcon,
  ResumeIcon,
  CursorIcon,
  TargetCursorIcon,
  HighlightCursorIcon,
  SpotlightCursorIcon,
  RestartIcon,
  DiscardIcon,
  CameraIcon,
  BlurIcon,
  OnboardingArrow,
  CloseButtonToolbar,
} from "../components/SVG";
import MicToggle from "../components/MicToggle";

// Furthest the toolbar may rest from the screen edge it is docked to.
const MAX_EDGE_GAP = 48;

// Docked left or right the toolbar is vertical; docked top or bottom it is
// horizontal, and ToolbarTop / ToolbarBottom name the side its popouts open
// on (away from the edge).
const EDGE_CLASS = {
  left: "ToolbarVertical",
  right: "ToolbarVertical ToolbarRight",
  top: "ToolbarBottom",
  bottom: "ToolbarTop",
};

// Another edge takes over only once the pointer is this much closer to it,
// so the toolbar doesn't flip in a corner or the moment it is grabbed there.
const EDGE_SWITCH_MARGIN = 80;

const nearestEdge = (x, y, current) => {
  const distances = {
    left: x,
    right: window.innerWidth - x,
    top: y,
    bottom: window.innerHeight - y,
  };
  return Object.keys(distances).reduce(
    (a, b) => (distances[b] + EDGE_SWITCH_MARGIN < distances[a] ? b : a),
    current,
  );
};

const ToolbarWrap = () => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [t] = useContext(timerContext);
  const [mode, setMode] = React.useState("");
  const modeRef = React.useRef(mode);
  const [hovering, setHovering] = React.useState(false);
  const DragRef = React.useRef(null);
  const ToolbarRef = React.useRef(null);
  // Positions saved before docking existed carry no edge.
  const [edge, setEdge] = React.useState(
    contentState.toolbarPosition.edge ||
      (contentState.toolbarPosition.right ? "right" : "left"),
  );
  const [elastic, setElastic] = React.useState("");
  const [shake, setShake] = React.useState("");
  const [dragging, setDragging] = React.useState("");
  const [timer, setTimer] = React.useState(0);
  const [timestamp, setTimestamp] = React.useState("00:00");
  const [transparent, setTransparent] = React.useState(false);
  const [forceTransparent, setForceTransparent] = React.useState("");
  const [visuallyHidden, setVisuallyHidden] = useState(false);
  const timeRef = React.useRef("");

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    setContentState((prev) => ({
      ...prev,
      setToolbarMode: setMode,
      toolbarMode: mode,
    }));
  }, [mode]);

  useEffect(() => {
    if (contentState.toolbarHover && contentState.hideUI) {
      setTransparent("ToolbarTransparent");
    } else {
      setTransparent(false);
      setForceTransparent("");
    }
  }, [contentState.toolbarHover, contentState.hideUI]);

  useEffect(() => {
    if (!contentState.toolbarHover) return;
    if (!contentState.shadowRef) return;
    if (!contentState.hideUI) return;
    const handleMouseDown = (e) => {
      if (contentState.toolbarHover && contentState.hideUI) {
        if (ToolbarRef.current && ToolbarRef.current.contains(e.target)) return;
        if (
          contentState.shadowRef &&
          (contentState.shadowRef.contains(e.target) ||
            contentState.shadowRef === e.target ||
            contentState.shadowRef === e.target.parentNode)
        )
          return;

        setForceTransparent("ForceTransparent");
      }
    };

    const handleMouseUp = (e) => {
      setForceTransparent("");
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [contentState.toolbarHover, contentState.shadowRef, contentState.hideUI]);

  useEffect(() => {
    if (!isNaN(t)) {
      setTimer(t);
      const clampedT = Math.max(0, t);
      const hours = Math.floor(clampedT / 3600);
      const minutes = Math.floor((clampedT % 3600) / 60);
      const seconds = clampedT % 60;

      let newTimestamp =
        hours > 0
          ? `${hours.toString().padStart(2, "0")}:${minutes
              .toString()
              .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
          : `${minutes.toString().padStart(2, "0")}:${seconds
              .toString()
              .padStart(2, "0")}`;

      if (hours > 0) {
        timeRef.current.style.width = "58px";
      } else {
        timeRef.current.style.width = "42px";
      }

      setTimestamp(newTimestamp);
    }
  }, [t]);

  // The grab handle pops 12px out of the vertical pill's top edge; keep it
  // reachable.
  const HANDLE_OVERHANG = 12;

  // offsetWidth/Height ignore the drag scale + shake transforms.
  const clampToViewport = (x, y) => {
    const { offsetWidth, offsetHeight } = ToolbarRef.current;
    return {
      x: Math.max(0, Math.min(x, window.innerWidth - offsetWidth)),
      y: Math.max(
        HANDLE_OVERHANG,
        Math.min(y, window.innerHeight - offsetHeight),
      ),
    };
  };

  // Pulls a position to within MAX_EDGE_GAP of the docked edge.
  const dockToEdge = (x, y) => {
    const { offsetWidth, offsetHeight } = ToolbarRef.current;
    if (edge === "left") x = Math.min(x, MAX_EDGE_GAP);
    if (edge === "right")
      x = Math.max(x, window.innerWidth - offsetWidth - MAX_EDGE_GAP);
    if (edge === "top") y = Math.min(y, MAX_EDGE_GAP);
    if (edge === "bottom")
      y = Math.max(y, window.innerHeight - offsetHeight - MAX_EDGE_GAP);
    return clampToViewport(x, y);
  };

  // Changing edge changes the pill's size, so re-dock once it has rendered.
  // Not mid-drag: the pill follows the cursor until it is dropped.
  useLayoutEffect(() => {
    if (dragging) return;
    function setToolbarPosition() {
      const { x, y } = DragRef.current.getDraggablePosition();
      DragRef.current.updatePosition(dockToEdge(x, y));
    }
    window.addEventListener("resize", setToolbarPosition);
    setToolbarPosition();
    return () => window.removeEventListener("resize", setToolbarPosition);
  }, [edge, dragging]);

  const handleChange = (value) => {
    setMode(value);
  };

  // Position and edge at drag start; Escape drops the toolbar back here.
  const dragStartRef = useRef(null);
  const dragCancelledRef = useRef(false);

  // react-draggable only ends a drag on a document mouseup, so hand it one.
  const endDrag = (e) => {
    document.dispatchEvent(
      new MouseEvent("mouseup", { clientX: e.clientX, clientY: e.clientY }),
    );
  };

  useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      dragCancelledRef.current = true;
      endDrag(e);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [dragging]);

  const handleDragStart = (e, d) => {
    dragStartRef.current = { x: d.x, y: d.y, edge };
    setDragging("ToolbarDragging");
  };

  const handleDrag = (e, d) => {
    // The mouseup was swallowed (released over a disabled button, outside
    // the window, ...): the button is no longer held, so drop instead of
    // leaving the toolbar glued to the cursor.
    if (e.buttons === 0) {
      endDrag(e);
      return;
    }

    setEdge((current) => nearestEdge(e.clientX, e.clientY, current));

    const clamped = clampToViewport(d.x, d.y);
    setShake(clamped.x !== d.x || clamped.y !== d.y ? "ToolbarShake" : "");
  };

  const handleDrop = (e, d) => {
    setShake("");
    setDragging("");
    setTimeout(() => {
      setElastic("");
    }, 250);

    // Back to where the drag started, which is already docked and saved.
    if (dragCancelledRef.current) {
      dragCancelledRef.current = false;
      const { edge: startEdge, ...start } = dragStartRef.current;
      setElastic("ToolbarElastic");
      setEdge(startEdge);
      DragRef.current.updatePosition(start);
      return;
    }

    const { x: xpos, y: ypos } = dockToEdge(d.x, d.y);
    if (xpos !== d.x || ypos !== d.y) setElastic("ToolbarElastic");
    DragRef.current.updatePosition({ x: xpos, y: ypos });

    const right = xpos >= window.innerWidth / 2;
    const bottom = ypos >= window.innerHeight / 2;
    const toolbarPosition = {
      offsetX: right ? window.innerWidth - xpos : xpos,
      offsetY: bottom ? window.innerHeight - ypos : ypos,
      left: !right,
      right,
      top: !bottom,
      bottom,
      edge,
    };

    setContentState((prevContentState) => ({
      ...prevContentState,
      toolbarPosition,
    }));
    chrome.storage.local.set({ toolbarPosition });
  };

  useEffect(() => {
    let x = contentState.toolbarPosition.offsetX;
    let y = contentState.toolbarPosition.offsetY;

    if (contentState.toolbarPosition.bottom) {
      y = window.innerHeight - contentState.toolbarPosition.offsetY;
    }

    if (contentState.toolbarPosition.right) {
      x = window.innerWidth - contentState.toolbarPosition.offsetX;
    }

    // handleDrop docks into the viewport: saved positions from a larger
    // display can land off-screen (external monitor saved, restored on
    // built-in).
    handleDrop(null, { x: x, y: y });
  }, []);

  useEffect(() => {
    if (!contentState.openToast) return;
    if (contentState.drawingMode) {
      contentState.openToast(chrome.i18n.getMessage("drawingModeToast"), () => {
        setMode("");
      });
    }
    if (contentState.blurMode) {
      contentState.openToast(chrome.i18n.getMessage("blurModeToast"), () => {
        setMode("");
      });
    }
  }, [contentState.drawingMode, contentState.blurMode, contentState.openToast]);

  useEffect(() => {
    if (contentState.drawingMode) setMode("draw");
    else if (contentState.blurMode) setMode("blur");
    else setMode("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode === "draw") {
      setContentState((prevContentState) => ({
        ...prevContentState,
        drawingMode: true,
        showOnboardingArrow: false,
      }));
    } else {
      setContentState((prevContentState) => ({
        ...prevContentState,
        drawingMode: false,
      }));
    }
    if (mode === "blur") {
      setContentState((prevContentState) => ({
        ...prevContentState,
        blurMode: true,
        drawingMode: false,
      }));
    } else {
      setContentState((prevContentState) => ({
        ...prevContentState,
        blurMode: false,
      }));
    }
  }, [mode]);

  const enableCamera = () => {
    setContentState((prevContentState) => ({
      ...prevContentState,
      cameraActive: true,
    }));
    chrome.storage.local.set({
      cameraActive: true,
    });
    setContentState((prevContentState) => ({
      ...prevContentState,
      pipEnded: true,
      pipActive: false,
    }));
  };

  return (
    <div>
      <Toast />
      <div
        className={
          contentState.paused && contentState.recording
            ? "ToolbarPaused"
            : "ToolbarPaused hidden"
        }
      ></div>
      <div className={"ToolbarBounds" + " " + shake}></div>
      <Rnd
        default={{
          x: 200,
          y: 500,
        }}
        className={
          "react-draggable" + " " + elastic + " " + shake + " " + dragging
        }
        dragHandleClassName="grab"
        enableResizing={false}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDrop}
        ref={DragRef}
        id="pro-onboarding-recording-toolbar"
      >
        <Toolbar.Root
          id="pro-onboarding-recording-toolbar-root"
          className={
            "ToolbarRoot" +
            " " +
            EDGE_CLASS[edge] +
            " " +
            transparent +
            " " +
            forceTransparent +
            (visuallyHidden ? " visually-hidden-toolbar" : "")
          }
          ref={ToolbarRef}
          onMouseOver={() => {
            setHovering(true);
          }}
          onMouseLeave={() => {
            setHovering(false);
          }}
        >
          <ToolTrigger grab type="button" content="">
            <GrabIcon />
          </ToolTrigger>
          {!contentState.recording && (
            <div
              className={`popup-controls toolbar-controls ${
                hovering ? "open" : ""
              }`}
              onClick={() => {
                if (contentState.openToast) {
                  contentState.openToast(
                    chrome.i18n.getMessage("reopenToolbarToast"),
                    () => {},
                  );
                }

                setVisuallyHidden(true);

                setContentState((prev) => ({
                  ...prev,

                  drawingMode: false,
                  blurMode: false,
                }));
                // Wait for toast (~3s) before real hide.
                setTimeout(() => {
                  setContentState((prev) => ({
                    ...prev,
                    hideToolbar: true,
                    drawingMode: false,
                    blurMode: false,
                    hideUIAlerts: false,
                    toolbarHover: false,
                    hideUI: true,
                  }));

                  chrome.storage.local.set({
                    hideToolbar: true,
                    hideUIAlerts: false,
                    toolbarHover: false,
                    hideUI: true,
                  });
                }, 3000);
              }}
            >
              <div className="popup-control popup-close">
                <CloseIconPopup />
              </div>
            </div>
          )}
          <div
            className={"ToolbarRecordingControls"}
            id="pro-onboarding-recording-toolbar-controls"
          >
            <ToolTrigger
              type="button"
              content={chrome.i18n.getMessage("finishRecordingTooltip")}
              disabled={!contentState.recording || contentState.finalizingRecording}
              onClick={() => {
                contentState.stopRecording();
              }}
            >
              <StopIcon width="20" height="20" />
            </ToolTrigger>
            <div
              className={`ToolbarRecordingTime ${
                contentState.timeWarning ? "TimerWarning" : ""
              }`}
              ref={timeRef}
            >
              {timestamp}
            </div>
            <ToolTrigger
              type="button"
              content={chrome.i18n.getMessage("restartRecordingTooltip")}
              disabled={!contentState.recording || contentState.finalizingRecording}
              onClick={() => {
                contentState.tryRestartRecording();
              }}
            >
              <RestartIcon />
            </ToolTrigger>
            {!contentState.paused && (
              <ToolTrigger
                type="button"
                content={chrome.i18n.getMessage("pauseRecordingTooltip")}
                disabled={!contentState.recording || contentState.finalizingRecording}
                onClick={() => {
                  contentState.pauseRecording();
                }}
              >
                <PauseIcon />
              </ToolTrigger>
            )}
            {contentState.recording && contentState.paused && (
              <ToolTrigger
                type="button"
                resume
                content={chrome.i18n.getMessage("resumeRecordingTooltip")}
                disabled={!contentState.recording || contentState.finalizingRecording}
                onClick={() => {
                  contentState.resumeRecording();
                }}
              >
                <ResumeIcon />
              </ToolTrigger>
            )}
            <ToolTrigger
              type="button"
              content={chrome.i18n.getMessage("cancelRecordingTooltip")}
              disabled={!contentState.recording || contentState.finalizingRecording}
              onClick={() => {
                if (contentState.tryDismissRecording !== undefined) {
                  contentState.tryDismissRecording();
                }
              }}
            >
              <DiscardIcon />
            </ToolTrigger>
          </div>
          <Toolbar.Separator className="ToolbarSeparator" />
          <Toolbar.ToggleGroup
            type="single"
            className="ToolbarToggleGroup"
            value={mode}
            onValueChange={handleChange}
          >
            <div className="ToolbarToggleWrap">
              {contentState.showOnboardingArrow && (
                <div className="OnboardingArrow">
                  <div className="OnboardingText">
                    {chrome.i18n.getMessage("clickHereDrawOnboarding")}
                  </div>
                  <div className="ArrowShape">
                    <OnboardingArrow />
                  </div>
                </div>
              )}
              <ToolTrigger
                type="mode"
                content={chrome.i18n.getMessage("toggleDrawingToolsTooltip")}
                value="draw"
                shortcut={contentState.toggleDrawingModeShortcut}
                disabled={contentState.recordingType === "camera"}
              >
                {mode === "draw" && <CloseButtonToolbar />}
                {mode !== "draw" && <DrawIcon />}
              </ToolTrigger>
              <DrawingToolbar visible={mode === "draw" ? "show-toolbar" : ""} />
            </div>
            <div className="ToolbarToggleWrap">
              <ToolTrigger
                type="mode"
                content={chrome.i18n.getMessage("toggleBlurToolTooltip")}
                value="blur"
                shortcut={contentState.toggleBlurModeShortcut}
                disabled={contentState.recordingType === "camera"}
              >
                {mode === "blur" && <CloseButtonToolbar />}
                {mode !== "blur" && <BlurIcon />}
              </ToolTrigger>
              <BlurToolbar visible={mode === "blur" ? "show-toolbar" : ""} />
            </div>

            <div className="ToolbarToggleWrap">
              <ToolTrigger
                type="mode"
                content={chrome.i18n.getMessage("toggleCursorOptionsTooltip")}
                value="cursor"
                shortcut={contentState.toggleCursorModeShortcut}
                disabled={contentState.recordingType === "camera"}
              >
                {contentState.cursorMode === "target" && <TargetCursorIcon />}
                {contentState.cursorMode === "highlight" && (
                  <HighlightCursorIcon />
                )}
                {contentState.cursorMode === "spotlight" && (
                  <SpotlightCursorIcon />
                )}
                {contentState.cursorMode === "none" && <CursorIcon />}
              </ToolTrigger>
              <CursorToolbar
                visible={mode === "cursor" ? "show-toolbar" : ""}
                mode={mode}
                setMode={setMode}
              />
            </div>
            <Toolbar.Separator className="ToolbarSeparator" />
            <MicToggle />
            {(!contentState.cameraActive ||
              contentState.defaultVideoInput === "none") &&
              (!contentState.isSubscribed || !contentState.recording) &&
              contentState.recordingType != "camera-only" && (
                <ToolTrigger
                  type="button"
                  content={
                    contentState.cameraActive && contentState.cameraPermission
                      ? chrome.i18n.getMessage("disableCameraTooltip")
                      : !contentState.cameraActive &&
                        contentState.cameraPermission
                      ? chrome.i18n.getMessage("enableCameraTooltip")
                      : chrome.i18n.getMessage("noCameraPermissionsTooltip")
                  }
                  value="camera"
                  onClick={enableCamera}
                  disabled={
                    !contentState.cameraPermission ||
                    contentState.defaultVideoInput === "none"
                  }
                >
                  <CameraIcon />
                </ToolTrigger>
              )}
          </Toolbar.ToggleGroup>
        </Toolbar.Root>
      </Rnd>
    </div>
  );
};

export default ToolbarWrap;
