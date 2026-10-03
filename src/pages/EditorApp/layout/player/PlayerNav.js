import React, { useContext, useRef, useEffect } from "react";
import styles from "../../styles/player/_Nav.module.scss";
import { ContentStateContext } from "../../context/ContentState"; // Import the ContentState context

// Icons
import { LockOpen, Question } from "@phosphor-icons/react";

const URL = "/assets/";

const PlayerNav = () => {
  const [contentState, setContentState] = useContext(ContentStateContext); // Access the ContentState context
  const contentStateRef = useRef(null);

  useEffect(() => {
    contentStateRef.current = contentState;
  }, [contentState]);

  return (
    <div className={styles.nav}>
      <div className={styles.navWrap}>
        <div
          onClick={() => {
            chrome.runtime.sendMessage({ type: "open-home" });
          }}
          aria-label="home"
          className={styles.navLeft}
        >
          <img src={URL + "editor/logo.svg"} alt="Recordful Logo" />
        </div>
        <div className={styles.navRight}>
          <button
            className="button simpleButton blueButton"
            onClick={() => {
              chrome.runtime.sendMessage({ type: "open-help" });
            }}
          >
            <Question size={16} />
            {chrome.i18n.getMessage("getHelpNav")}
          </button>
          <button
            className="button primaryButton"
            onClick={() => {
              chrome.runtime.sendMessage({ type: "pricing" });
            }}
          >
            <LockOpen size={16} />{" "}
            {chrome.i18n.getMessage("unlockMoreFeatures") ||
              "Unlock more features"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlayerNav;
