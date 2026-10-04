import React, { useContext, useEffect, Suspense, lazy } from "react";
import styles from "../../styles/player/_Content.module.scss";

import VideoPlayer from "../../components/player/VideoPlayer";
import EditVideoPlayer from "../../components/editor/VideoPlayer";
import Title from "../../components/player/Title";
import HelpButton from "../../components/player/HelpButton";
import ProBanner from "../../components/global/ProBanner";
import ReviewBanner from "../../components/global/ReviewBanner";
import TrimUI from "../editor/TrimUI";
import { canEdit } from "./tools";
// Cropper drags in react-advanced-cropper (~218KB) and is only rendered
// when the user opens the crop tool. Lazy-load so it doesn't eat the
// editor's initial parse budget on every recording-stop.
const CropperWrap = lazy(() => import("../../components/editor/CropperWrap"));

import { ContentStateContext } from "../../context/ContentState";

// The main column: status alerts, the video, its title, and the timeline. `alertsRef` is the slot the Share menu draws its alerts into.
const Content = ({ alertsRef }) => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const editable = canEdit(contentState);
  const cropping = contentState.mode === "crop";

  // The timeline's Undo starts from the recording as it was when it first
  // became editable. Only then: `editable` goes true again after every edit.
  useEffect(() => {
    if (editable && contentState.history.length <= 1) contentState.addToHistory();
  }, [editable]);

  const seek = (time, updateTime) =>
    setContentState((prev) => ({ ...prev, updatePlayerTime: updateTime, time }));

  return (
    <div className={styles.content}>
      <div ref={alertsRef} className={styles.alerts} />
      <div className={styles.stage}>
        {cropping && (
          <Suspense fallback={null}>
            <CropperWrap />
          </Suspense>
        )}
        {editable ? (
          // Stays mounted while cropping: remounting reloads the recording
          // and decodes its audio again. Follows the timeline otherwise.
          <EditVideoPlayer onSeek={seek} />
        ) : (
          !cropping && <VideoPlayer />
        )}
      </div>
      {!cropping && <Title />}
      {editable && (
        <div hidden={cropping}>
          <TrimUI blob={contentState.blob} onSeek={seek} />
        </div>
      )}
      {cropping && <HelpButton />}
      {contentState.reviewPrompt ? (
        <ReviewBanner />
      ) : (
        // While eligible for the review prompt (waiting on the interaction
        // gate), reserve the slot so the Pro banner doesn't flash.
        !contentState.reviewEligible &&
        contentState.bannerSupport && <ProBanner />
      )}
    </div>
  );
};

export default Content;
