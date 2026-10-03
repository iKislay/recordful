import React, { useContext } from "react";

// Components
import Toggle from "../../../Components/Toggle";

// Styles
import styles from "../../styles/edit/_Switch.module.scss";

// Context
import { ContentStateContext } from "../../context/ContentState"; // Import the ContentState context

// Row wrapper around the shared Toggle input. Toggle UI lives only in
// src/pages/Components/Toggle.jsx; this file keeps the editor's label and
// contentState wiring.
const Switch = () => {
  const [contentState, setContentState] = useContext(ContentStateContext);

  return (
    <form>
      <div className={styles.SwitchRow}>
        <label
          className={styles.Label}
          htmlFor="replaceAudio"
          style={{ paddingRight: 15 }}
        >
          {chrome.i18n.getMessage("replaceAudioEditor")}
        </label>
        <Toggle
          id="replaceAudio"
          label={chrome.i18n.getMessage("replaceAudioEditor")}
          checked={!!contentState.replaceAudio}
          onCheckedChange={(checked) => {
            setContentState((prevContentState) => ({
              ...prevContentState,
              replaceAudio: checked,
            }));
          }}
        />
      </div>
    </form>
  );
};

export default Switch;
