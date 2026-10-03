import React, { useContext } from "react";
import { X } from "@phosphor-icons/react";
import styles from "../../styles/player/_Player.module.scss";
import { ContentStateContext } from "../../context/ContentState";
import CropUI from "../editor/CropUI";
import AudioUI from "../editor/AudioUI";
import { closeTool } from "./tools";

// The settings of the open tool. Hidden when no tool is open, so the video
// has the whole width.
const Sidebar = () => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const { mode } = contentState;
  if (mode !== "crop" && mode !== "audio") return null;

  return (
    <aside className={styles.sidebar}>
      <button
        className={styles.sidebarClose}
        aria-label={chrome.i18n.getMessage("closeModalLabel")}
        disabled={contentState.isFfmpegRunning}
        onClick={() => closeTool(contentState, setContentState)}
      >
        <X size={16} />
      </button>
      {mode === "crop" ? <CropUI /> : <AudioUI />}
    </aside>
  );
};

export default Sidebar;
