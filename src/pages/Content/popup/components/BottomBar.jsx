import React, { useContext, useEffect, useState } from "react";
import { DotsThree, Palette } from "@phosphor-icons/react";

import Switch from "./Switch";
import TimeSetter from "./TimeSetter";
import BackgroundEffects from "./BackgroundEffects";
import SettingsMenu from "../layout/SettingsMenu";

// Context
import { contentStateContext } from "../../context/ContentState";

// Push-to-talk glyph, supplied as a custom SVG (walkie-talkie). Kept verbatim.
const PushToTalkIcon = ({ size = 20 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 32 32"
    aria-hidden="true"
  >
    <path d="M0 0h32v32H0z" fill="none" />
    <path fill="currentColor" d="M13 11h6v2h-6zm0 4h6v2h-6z" />
    <circle cx="16" cy="23" r="2" fill="currentColor" />
    <path
      fill="currentColor"
      d="M22 7h-1V2h-2v5h-9a2 2 0 0 0-2 2v2H6v2h2v2H6v2h2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2M10 28V9h12v19Z"
    />
  </svg>
);

const writeFlag = (setContentState, key, checked) => {
  setContentState((prevContentState) => ({
    ...prevContentState,
    [key]: checked,
  }));
  chrome.storage.local.set({ [key]: checked });
};

// Dark bottom bar: Effects (background effects toggle), Push to talk, and
// More (the former "Show more options" rows). Replaces the Settings
// collapsible; same contentState/storage writes as the old Switch rows.
const BottomBar = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcut = isMac ? "⌥⇧E" : "Alt⇧E";

  // The help section visibility was driven by the old Settings open state.
  useEffect(() => {
    setContentState((prevContentState) => ({
      ...prevContentState,
      settingsOpen: moreOpen,
    }));
  }, [moreOpen]);

  const effectsAvailable =
    contentState.cameraPermission &&
    contentState.defaultVideoInput != "none" &&
    contentState.cameraActive &&
    (!contentState.isLoggedIn || contentState.instantMode);
  const micAvailable = Boolean(contentState.microphonePermission);

  const toggleEffects = () => {
    if (!effectsAvailable) return;
    writeFlag(
      setContentState,
      "backgroundEffectsActive",
      !contentState.backgroundEffectsActive
    );
  };

  const togglePushToTalk = () => {
    if (!micAvailable) return;
    const next = !contentState.pushToTalk;
    writeFlag(setContentState, "pushToTalk", next);
    if (!next) {
      setContentState((prevContentState) => ({
        ...prevContentState,
        micActive: true,
      }));
    }
  };

  return (
    <div className="bottom-bar-wrap">
      {contentState.backgroundEffectsActive && effectsAvailable && (
        <BackgroundEffects />
      )}
      {moreOpen && (
        <div className="more-panel">
          <SettingsMenu
            shadowRef={props.shadowRef}
            open={menuOpen}
            setOpen={setMenuOpen}
          />
          <Switch
            label={chrome.i18n.getMessage("hideToolbarLabel")}
            name="hideUI"
            value="hideUI"
            anchorId="pro-onboarding-toolbar-toggle"
          />
          <Switch
            label={chrome.i18n.getMessage("countdownLabel")}
            name="countdown"
            value="countdown"
          />
          <Switch
            label={chrome.i18n.getMessage("alarmLabel")}
            name="alarm"
            value="alarm"
          />
          {contentState.alarm && <TimeSetter />}
          <Switch
            label={chrome.i18n.getMessage("micReminderPopup")}
            name="askMicrophone"
            value="askMicrophone"
          />
          {contentState.recordingType != "camera" &&
            !contentState.isSubscribed && (
              <Switch
                label={
                  chrome.i18n.getMessage("zoomToPointPopup") +
                  " (" +
                  shortcut +
                  ")"
                }
                name="zoomEnabled"
                value="zoomEnabled"
                experimental={true}
              />
            )}
        </div>
      )}
      <div className="bottom-bar">
        <button
          type="button"
          className={
            "bottom-bar-item" +
            (contentState.backgroundEffectsActive && effectsAvailable
              ? " active"
              : "")
          }
          onClick={toggleEffects}
          disabled={!effectsAvailable}
          aria-pressed={Boolean(
            contentState.backgroundEffectsActive && effectsAvailable
          )}
          aria-label={
            chrome.i18n.getMessage("effectsLabel") || "Effects"
          }
        >
          <Palette size={20} />
          <span>{chrome.i18n.getMessage("effectsLabel") || "Effects"}</span>
        </button>
        <button
          type="button"
          className={
            "bottom-bar-item" +
            (contentState.pushToTalk ? " active" : "")
          }
          onClick={togglePushToTalk}
          disabled={!micAvailable}
          aria-pressed={Boolean(contentState.pushToTalk)}
          aria-label={chrome.i18n.getMessage("pushToTalkLabel")}
        >
          <PushToTalkIcon size={20} />
          <span>{chrome.i18n.getMessage("pushToTalkLabel")}</span>
        </button>
        <button
          type="button"
          className={"bottom-bar-item" + (moreOpen ? " active" : "")}
          onClick={() => setMoreOpen((prev) => !prev)}
          aria-pressed={moreOpen}
          aria-label={chrome.i18n.getMessage("moreLabel") || "More"}
        >
          <DotsThree size={20} weight="bold" />
          <span>{chrome.i18n.getMessage("moreLabel") || "More"}</span>
        </button>
      </div>
    </div>
  );
};

export default BottomBar;
