import React, { useContext, useState, useEffect } from "react";
import Trimmer from "../../components/editor/Trimmer";
import styles from "../../styles/edit/_TrimUI.module.scss";

// Icons
import {
  ArrowUUpLeft,
  ArrowUUpRight,
  Clock,
  Scissors,
  SpeakerSlash,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";

// Context
import { ContentStateContext } from "../../context/ContentState"; // Import the ContentState context

const TrimUI = (props) => {
  const [contentState, setContentState] = useContext(ContentStateContext); // Access the ContentState context
  const [undoDisabled, setUndoDisabled] = useState(true);
  const [redoDisabled, setRedoDisabled] = useState(true);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);

  useEffect(() => {
    setStartTime(contentState.start * contentState.duration);
    setEndTime(contentState.end * contentState.duration);
  }, [contentState.duration, contentState.start, contentState.end]);

  useEffect(() => {
    if (contentState.history.length > 2) {
      setUndoDisabled(false);
    } else {
      setUndoDisabled(true);
    }
  }, [contentState.history]);

  useEffect(() => {
    if (contentState.redoHistory.length > 0) {
      setRedoDisabled(false);
    } else {
      setRedoDisabled(true);
    }
  }, [contentState.redoHistory]);

  const toTimeStamp = (time) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time - minutes * 60);

    if (seconds < 10) {
      return `${minutes}:0${seconds}`;
    } else {
      return `${minutes}:${seconds}`;
    }
  };

  return (
    <div className={styles.trimWrap}>
      <div className={styles.controls}>
        <div className={styles.actions}>
          <button
            className="button secondaryButton"
            onClick={() => contentState.handleTrim(false)}
            disabled={
              contentState.isFfmpegRunning ||
              (contentState.start === 0 && contentState.end === 1)
            }
          >
            <Scissors size={16} />
            {contentState.trimming
              ? chrome.i18n.getMessage("sandboxEditorTrimProgressButton") +
                (contentState.processingProgress > 0
                  ? ` ${contentState.processingProgress}%`
                  : "")
              : chrome.i18n.getMessage("sandboxEditorTrimButton")}
          </button>
          <button
            className="button secondaryButton"
            disabled={
              (contentState.start === 0 && contentState.end === 1) ||
              contentState.isFfmpegRunning
            }
            onClick={() => contentState.handleTrim(true)}
          >
            <Trash size={16} />
            {contentState.cutting
              ? chrome.i18n.getMessage("sandboxEditorCutProgressButton") +
                (contentState.processingProgress > 0
                  ? ` ${contentState.processingProgress}%`
                  : "")
              : chrome.i18n.getMessage("sandboxEditorCutButton")}
          </button>
          <button
            className="button secondaryButton"
            onClick={() => contentState.handleMute()}
            disabled={contentState.isFfmpegRunning}
          >
            <SpeakerSlash size={16} />
            {contentState.muting
              ? chrome.i18n.getMessage("sandboxEditorMuteProgressButton") +
                (contentState.processingProgress > 0
                  ? ` ${contentState.processingProgress}%`
                  : "")
              : chrome.i18n.getMessage("sandboxEditorMuteButton")}
          </button>
        </div>
        <div className={styles.timeWrap}>
          <Clock size={16} />
          <span>{toTimeStamp(startTime) + " - " + toTimeStamp(endTime)}</span>
        </div>

        <div className={styles.controlsRight}>
          <button
            className="button simpleButton"
            onClick={() => contentState.undo()}
            disabled={undoDisabled || contentState.isFfmpegRunning}
          >
            <ArrowUUpLeft size={16} />
            {chrome.i18n.getMessage("undoLabel")}
          </button>
          <button
            className="button simpleButton"
            onClick={() => contentState.redo()}
            disabled={redoDisabled || contentState.isFfmpegRunning}
          >
            <ArrowUUpRight size={16} />
            {chrome.i18n.getMessage("redoLabel")}
          </button>
        </div>
      </div>
      <Trimmer />
      {(!contentState.dragInteracted || contentState.duration > 3) && (
        <div className={styles.trimInfo}>
          <div className={styles.trimInfoLeft}>
            <WarningCircle size={16} />
          </div>
          <div className={styles.trimInfoRight}>
            {chrome.i18n.getMessage("sandboxEditorTrimInfo")}
            <div
              className={styles.trimInfoLink}
              onClick={() => {
                chrome.runtime.sendMessage({ type: "trim-info" });
              }}
            >
              {chrome.i18n.getMessage("learnMoreDot")}
            </div>
          </div>
        </div>
      )}
      {contentState.dragInteracted && contentState.duration <= 3 && (
        <div className={styles.trimInfo}>
          <div className={styles.trimInfoLeft}>
            <WarningCircle size={16} />
          </div>
          <div className={styles.trimInfoRight}>
            {chrome.i18n.getMessage("sandboxEditorTooSmallInfo")}
            <div
              className={styles.trimInfoLink}
              onClick={() => {
                chrome.runtime.sendMessage({ type: "trim-info" });
              }}
            >
              {chrome.i18n.getMessage("learnMoreDot")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrimUI;
