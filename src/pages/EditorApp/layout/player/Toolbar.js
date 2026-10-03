import React, { useContext } from "react";
import { Crop, SelectionBackground, SpeakerHigh } from "@phosphor-icons/react";
import styles from "../../styles/player/_Player.module.scss";
import { ContentStateContext } from "../../context/ContentState";
import { canEdit, closeTool, openTool } from "./tools";

const TOOLS = [
  { mode: "crop", Icon: Crop, label: "cropButtonTitle" },
  { mode: "audio", Icon: SpeakerHigh, label: "addAudioButtonTitle" },
];

// The floating bar above the video. A tool opens its settings in the
// sidebar; pressing it again closes the tool and applies the change.
const Toolbar = () => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const unavailable = !canEdit(contentState) || contentState.isFfmpegRunning;

  return (
    <div className={styles.toolbar} role="toolbar">
      {TOOLS.map(({ mode, Icon, label }) => {
        const active = contentState.mode === mode;
        const name = chrome.i18n.getMessage(label);
        return (
          <button
            key={mode}
            className={styles.tool}
            aria-label={name}
            aria-pressed={active}
            title={name}
            disabled={unavailable}
            onClick={() =>
              active
                ? closeTool(contentState, setContentState)
                : openTool(contentState, setContentState, mode)
            }
          >
            <Icon size={18} />
          </button>
        );
      })}
      {/* Not built yet; shown so the toolbar's shape is settled. */}
      <button
        className={styles.tool}
        aria-label={chrome.i18n.getMessage("backgroundToolLabel")}
        title={chrome.i18n.getMessage("backgroundToolLabel")}
        disabled
      >
        <SelectionBackground size={18} />
      </button>
    </div>
  );
};

export default Toolbar;
