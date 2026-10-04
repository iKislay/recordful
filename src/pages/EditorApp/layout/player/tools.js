// The editing tools in the sidebar. One is always open: audio by default,
// crop while the page is in crop mode. There is no Save or Cancel: a chosen
// audio file is added at once, a crop is applied when the tool is left, and
// Undo on the timeline takes either back.

/** Whether the recording can be edited at all (short enough, converted). */
export const canEdit = (contentState) =>
  contentState.mp4ready &&
  !contentState.noffmpeg &&
  (contentState.duration <= contentState.editLimit || contentState.override);

export const notAvailableLabel = (contentState) => {
  if (contentState.fallback && contentState.noffmpeg) {
    return chrome.i18n.getMessage(
      contentState.editLimit === 0
        ? "notAvailableLongRecording"
        : "notAvailableRecoveryMode",
    );
  }
  return chrome.i18n.getMessage("notAvailableLabel");
};

export const preparingLabel = (contentState) => {
  const base = chrome.i18n.getMessage("preparingLabel");
  const percent = Math.round(contentState.processingProgress || 0);
  return !contentState.mp4ready && percent > 0 ? `${base} (${percent}%)` : base;
};

/**
 * Why the tools cannot be used right now, in words, or null when they can.
 * A recording still being converted becomes editable on its own; one that is
 * too long or was recovered never does.
 */
export const unavailableReason = (contentState) => {
  if (canEdit(contentState)) return null;
  const never =
    contentState.noffmpeg ||
    (contentState.duration > contentState.editLimit && !contentState.override);
  return never ? notAvailableLabel(contentState) : preparingLabel(contentState);
};

const saved = (contentState) =>
  contentState.openToast?.(chrome.i18n.getMessage("sandboxToastSaved"), () =>
    contentState.undo?.(),
  );

export const enterCrop = (contentState, setContentState) => {
  if (!canEdit(contentState) || contentState.isFfmpegRunning) return;

  // The cropper draws over a still frame. If it is not cached yet, ask for
  // it and let the "new-frame" handler switch modes, otherwise the cropper
  // mounts over a blank stage.
  if (!contentState.frame) {
    setContentState((prev) => ({ ...prev, pendingCropEntry: true }));
    contentState.getFrame();
    return;
  }
  setContentState((prev) => ({ ...prev, mode: "crop" }));
};

/** Back to the audio tool, applying the crop if the box was changed. */
export const leaveCrop = async (contentState, setContentState) => {
  if (contentState.isFfmpegRunning) return;
  const { left, top, width, height } = contentState;
  const changed =
    left !== 0 ||
    top !== 0 ||
    width !== contentState.prevWidth ||
    height !== contentState.prevHeight;
  if (!changed) {
    setContentState((prev) => ({ ...prev, mode: "player", start: 0, end: 1 }));
    return;
  }
  // The page returns to the player when the cropped video arrives
  // (ContentState, "updated-blob").
  await contentState.handleCrop(left, top, width, height);
  setContentState((prev) => ({ ...prev, fromCropper: true }));
  saved(contentState);
};

/** Mixes `file` into the recording with the panel's volume and replace settings. */
export const addAudio = async (contentState, setContentState, file) => {
  if (!canEdit(contentState) || contentState.isFfmpegRunning) return;
  setContentState((prev) => ({
    ...prev,
    isFfmpegRunning: true,
    processingProgress: 0,
    fromAudio: true,
  }));
  contentState.addAudio(contentState.blob, file, contentState.volume);
  await contentState.waitForUpdatedBlob?.();
  saved(contentState);
};
