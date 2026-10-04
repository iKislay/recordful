import React, { useContext } from "react";
import { Crop, SelectionBackground, SpeakerHigh } from "@phosphor-icons/react";
import styles from "../../styles/player/_Player.module.scss";
import { ContentStateContext } from "../../context/ContentState";
import { canEdit, enterCrop, leaveCrop } from "./tools";

// The rail of tools on the sidebar's left edge. One is always selected.
const Toolbar = () => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const cropping = contentState.mode === "crop";
  const unavailable = !canEdit(contentState) || contentState.isFfmpegRunning;

  const tools = [
    {
      Icon: Crop,
      label: chrome.i18n.getMessage("cropButtonTitle"),
      active: cropping,
      select: () => !cropping && enterCrop(contentState, setContentState),
    },
    {
      Icon: SpeakerHigh,
      label: chrome.i18n.getMessage("addAudioButtonTitle"),
      active: !cropping,
      select: () => cropping && leaveCrop(contentState, setContentState),
    },
    // Not built yet; shown so the rail's shape is settled.
    {
      Icon: SelectionBackground,
      label: chrome.i18n.getMessage("backgroundToolLabel"),
      disabled: true,
    },
  ];

  return (
    <div className={styles.toolbar} role="toolbar" aria-orientation="vertical">
      {tools.map(({ Icon, label, active, select, disabled }) => (
        <button
          key={label}
          className={styles.tool}
          aria-label={label}
          aria-pressed={Boolean(active)}
          title={label}
          disabled={disabled || unavailable}
          onClick={select}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
};

export default Toolbar;
