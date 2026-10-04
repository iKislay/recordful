import React, { useContext } from "react";
import styles from "../../styles/player/_Player.module.scss";
import { ContentStateContext } from "../../context/ContentState";
import CropUI from "../editor/CropUI";
import AudioUI from "../editor/AudioUI";
import Toolbar from "./Toolbar";
import { unavailableReason } from "./tools";

// The tool rail and the selected tool's settings. Always on screen; when the
// recording cannot be edited the panel says why instead of showing settings
// that would do nothing.
const Sidebar = () => {
  const [contentState] = useContext(ContentStateContext);
  const reason = unavailableReason(contentState);

  return (
    <aside className={styles.sidebar}>
      <Toolbar />
      <div className={styles.toolPanel}>
        {reason ? (
          <p className={styles.toolNote}>{reason}</p>
        ) : contentState.mode === "crop" ? (
          <CropUI />
        ) : (
          <AudioUI />
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
