import React, { useContext, useState } from "react";
import {
  ArrowSquareOut,
  BoundingBox,
  Browser,
  CaretRight,
  Monitor,
  Scroll,
} from "@phosphor-icons/react";

import { contentStateContext } from "../../context/ContentState";

// The screenshot tab: three ways to take one, each a single click. The popup
// gets out of the way first, the picture opens in the web editor, and the
// last way used is remembered for next time.

const t = (key, fallback) => chrome.i18n.getMessage(key) || fallback;

const MODES = [
  {
    mode: "area",
    Icon: BoundingBox,
    title: () => t("screenshotAreaTitle", "Selected area"),
    hint: () => t("screenshotAreaHint", "Drag a box, or click an element"),
  },
  {
    mode: "visible",
    Icon: Browser,
    title: () => t("screenshotVisibleTitle", "Visible part"),
    hint: () => t("screenshotVisibleHint", "What is on screen now"),
  },
  {
    mode: "page",
    Icon: Scroll,
    title: () => t("screenshotPageTitle", "Full page"),
    hint: () => t("screenshotPageHint", "Scrolls and stitches the whole page"),
  },
  {
    mode: "screen",
    Icon: Monitor,
    title: () => t("screenshotScreenTitle", "Entire screen or window"),
    hint: () => t("screenshotScreenHint", "Anything on your computer, not just this tab"),
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One frame of a screen or window the person picks in Chrome's own dialog.
 * Null if they cancel, or the page does not allow screen capture.
 */
const grabScreen = async () => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor", frameRate: 5 },
      audio: false,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      monitorTypeSurfaces: "include",
    });
  } catch (err) {
    return { error: err?.name === "NotAllowedError" && /policy/i.test(err?.message || "") ? "blocked" : "cancelled" };
  }
  const track = stream.getVideoTracks()[0];
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // The picker has to leave the screen before the frame is taken.
    await sleep(400);
    await new Promise((resolve) =>
      video.requestVideoFrameCallback ? video.requestVideoFrameCallback(resolve) : setTimeout(resolve, 50)
    );
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const label = track.label && !/^(screen|window|web-contents-media-stream):/i.test(track.label) ? track.label : "";
    return { dataUrl: canvas.toDataURL("image/png"), title: label };
  } finally {
    stream.getTracks().forEach((each) => each.stop());
  }
};

const STYLES = `
.rf-shot { display: flex; flex-direction: column; gap: 6px; padding: 2px 0 4px; }
.rf-shot-option { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 10px 12px; border-radius: 12px; cursor: pointer;
  background: var(--rf-wash-soft); transition: background 140ms ease, transform 140ms ease; }
.rf-shot-option:hover { background: var(--rf-wash-strong); }
.rf-shot-option:active { transform: scale(0.985); }
.rf-shot-option:focus-visible { box-shadow: 0 0 0 2px var(--rf-focus-ring); }
.rf-shot-option[data-last="true"] { background: var(--rf-bg-active); box-shadow: 0 0 0 1px var(--rf-border), 0 1px 3px rgba(0,0,0,0.06); }
.rf-shot-icon { flex: none; width: 34px; height: 34px; border-radius: 10px; display: flex;
  align-items: center; justify-content: center; color: var(--rf-text-strong);
  background: var(--rf-bg-active); box-shadow: 0 0 0 1px var(--rf-border); }
.rf-shot-option[data-last="true"] .rf-shot-icon { background: var(--rf-strong); color: var(--rf-text-contrast); box-shadow: none; }
.rf-shot-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.rf-shot-title { font-size: 13.5px; font-weight: 600; color: var(--rf-text-strong); letter-spacing: -0.01em; }
.rf-shot-hint { font-size: 12px; color: var(--rf-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rf-shot-caret { flex: none; color: var(--rf-icon); }
.rf-shot-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-top: 6px; padding: 0 2px; font-size: 12px; color: var(--rf-text-secondary); }
.rf-shot-link { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
  font-weight: 500; color: var(--rf-text); border-radius: 6px; padding: 2px 4px; }
.rf-shot-link:hover { color: var(--rf-text-strong); background: var(--rf-wash-hover); }
.rf-shot-error { font-size: 12px; color: var(--rf-danger); padding: 0 2px; }
`;

const ScreenshotTab = () => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [last, setLast] = useState(contentState.lastScreenshotMode || "area");
  const [error, setError] = useState("");

  const take = (mode) => {
    setError("");
    setLast(mode);
    chrome.storage.local.set({ lastScreenshotMode: mode });
    // The popup leaves first, so it is never in the picture.
    setContentState((prev) => ({
      ...prev,
      lastScreenshotMode: mode,
      showExtension: false,
      showPopup: false,
    }));
    const failed = (why) => {
      setContentState((prev) => ({ ...prev, showExtension: true, showPopup: true }));
      setError(
        why === "restricted"
          ? t("screenshotRestricted", "Chrome doesn't allow screenshots of this page.")
          : why === "blocked"
            ? t("screenshotScreenBlocked", "This site doesn't allow screen capture. Try it from another tab.")
            : t("screenshotFailed", "That screenshot didn't work. Try again.")
      );
    };
    const send = (extra = {}) =>
      chrome.runtime.sendMessage({ type: "take-screenshot", mode, ...extra }, (response) => {
        if (chrome.runtime.lastError || !response?.error) return;
        if (response.error === "busy") return;
        failed(response.error);
      });
    if (mode !== "screen") return send();
    grabScreen().then((grabbed) => {
      if (grabbed.dataUrl) send({ dataUrl: grabbed.dataUrl, title: grabbed.title });
      else if (grabbed.error === "blocked") failed("blocked");
      else setContentState((prev) => ({ ...prev, showExtension: true, showPopup: true }));
    });
  };

  return (
    <div className="rf-shot">
      <style>{STYLES}</style>
      {MODES.map(({ mode, Icon, title, hint }) => (
        <button
          key={mode}
          type="button"
          className="rf-shot-option"
          data-last={last === mode}
          onClick={() => take(mode)}
        >
          <span className="rf-shot-icon">
            <Icon size={18} weight={last === mode ? "bold" : "regular"} />
          </span>
          <span className="rf-shot-text">
            <span className="rf-shot-title">{title()}</span>
            <span className="rf-shot-hint">{hint()}</span>
          </span>
          <CaretRight size={14} className="rf-shot-caret" />
        </button>
      ))}
      {error && <div className="rf-shot-error">{error}</div>}
      <div className="rf-shot-foot">
        <span>{t("screenshotPrivacyNote", "Private by default. No watermark.")}</span>
        <button
          type="button"
          className="rf-shot-link"
          onClick={() =>
            window.open(`${process.env.RECORDFUL_EDITOR_BASE || process.env.RECORDFUL_APP_BASE}/editor/shot`, "_blank")
          }
        >
          {t("screenshotOpenEditor", "Edit a picture")}
          <ArrowSquareOut size={12} />
        </button>
      </div>
    </div>
  );
};

export default ScreenshotTab;
