// Opening and closing the crop and audio tools. There is no Save or Cancel:
// closing a tool applies what was changed in it, and Undo on the timeline
// takes it back.

/** Whether the recording can be edited at all (short enough, converted). */
export const canEdit = (contentState) =>
  contentState.mp4ready &&
  !contentState.noffmpeg &&
  (contentState.duration <= contentState.editLimit || contentState.override);

export const openTool = (contentState, setContentState, tool) => {
  if (!canEdit(contentState) || contentState.isFfmpegRunning) return;

  // The cropper draws over a still frame. If it is not cached yet, ask for
  // it and let the "new-frame" handler switch modes, otherwise the cropper
  // mounts over a blank stage.
  if (tool === "crop" && !contentState.frame) {
    setContentState((prev) => ({ ...prev, pendingCropEntry: true }));
    contentState.getFrame();
    return;
  }
  setContentState((prev) => ({ ...prev, mode: tool }));
};

export const closeTool = async (contentState, setContentState) => {
  if (contentState.isFfmpegRunning) return;
  const { mode, left, top, width, height, pendingAudio } = contentState;
  const saved = () =>
    contentState.openToast?.(chrome.i18n.getMessage("sandboxToastSaved"), () =>
      contentState.undo?.(),
    );

  const cropChanged =
    left !== 0 ||
    top !== 0 ||
    width !== contentState.prevWidth ||
    height !== contentState.prevHeight;
  if (mode === "crop" && cropChanged) {
    // The page returns to the player when the cropped video arrives
    // (ContentState, "updated-blob").
    await contentState.handleCrop(left, top, width, height);
    setContentState((prev) => ({ ...prev, fromCropper: true }));
    saved();
    return;
  }

  if (mode === "audio" && pendingAudio) {
    setContentState((prev) => ({
      ...prev,
      isFfmpegRunning: true,
      processingProgress: 0,
      fromAudio: true,
    }));
    contentState.addAudio(contentState.blob, pendingAudio, contentState.volume);
    await contentState.waitForUpdatedBlob?.();
    saved();
    return;
  }

  setContentState((prev) => ({
    ...prev,
    mode: "player",
    start: 0,
    end: 1,
    pendingAudio: null,
  }));
};
