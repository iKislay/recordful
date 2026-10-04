import React, { useContext, useEffect, useState, useRef, useMemo } from "react";
import { default as Plyr } from "plyr-react";
import "plyr-react/plyr.css";
import { ContentStateContext } from "../../context/ContentState"; // Import the ContentState context

const VideoPlayer = (props) => {
  const [contentState, setContentState] = useContext(ContentStateContext); // Access the ContentState context
  const playerRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [source, setSource] = useState(null);
  // Probed from the blob's intrinsic dimensions; a fixed "16:9" would
  // pillarbox recordings of square-ish tabs.
  const [videoRatio, setVideoRatio] = useState("16:9");

  useEffect(() => {
    if (
      playerRef.current &&
      playerRef.current.plyr &&
      contentState.updatePlayerTime
    ) {
      playerRef.current.plyr.currentTime = contentState.time;
    }
  }, [contentState.time]);

  const options = useMemo(
    () => ({
      controls: ["play", "mute", "captions", "settings", "pip", "fullscreen"],
      ratio: videoRatio,
      blankVideo:
        "chrome-extension://" +
        chrome.i18n.getMessage("@@extension_id") +
        "/assets/blank.mp4",
      keyboard: {
        global: true,
      },
    }),
    [videoRatio]
  );

  useEffect(() => {
    if (!contentState.blob) return;
    const probeUrl = URL.createObjectURL(contentState.blob);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.src = probeUrl;
    const onMeta = () => {
      const w = probe.videoWidth;
      const h = probe.videoHeight;
      if (w > 0 && h > 0) setVideoRatio(`${w}:${h}`);
      cleanup();
    };
    const onErr = () => cleanup();
    const cleanup = () => {
      probe.removeEventListener("loadedmetadata", onMeta);
      probe.removeEventListener("error", onErr);
      URL.revokeObjectURL(probeUrl);
    };
    probe.addEventListener("loadedmetadata", onMeta);
    probe.addEventListener("error", onErr);
    return cleanup;
  }, [contentState.blob]);

  useEffect(() => {
    if (contentState.blob) {
      const objectURL = URL.createObjectURL(contentState.blob);
      setSource({
        type: "video",
        sources: [
          {
            src: objectURL,
            type: "video/mp4",
          },
        ],
      });
      setUrl(objectURL);

      return () => {
        URL.revokeObjectURL(objectURL);
      };
    }
  }, [contentState.blob, playerRef]);

  // Media events don't bubble but they are captured, so one listener on the
  // wrapper outlives Plyr swapping its <video> when the source changes.
  const wrapRef = useRef(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    const onTimeUpdate = (event) => {
      // Plyr re-sends each one from its own container; take the video's.
      if (!(event.target instanceof HTMLMediaElement)) return;
      setContentState((prevContentState) => ({
        ...prevContentState,
        time: event.target.currentTime,
        updatePlayerTime: false,
      }));
    };
    wrap.addEventListener("timeupdate", onTimeUpdate, true);
    return () => wrap.removeEventListener("timeupdate", onTimeUpdate, true);
  }, []);

  // Stays mounted, hidden, while cropping.
  const cropping = contentState.mode === "crop";
  useEffect(() => {
    if (cropping) playerRef.current?.plyr?.pause();
  }, [cropping]);

  return (
    <div className="videoPlayer" hidden={cropping}>
      <div className="playerWrap" ref={wrapRef}>
        {url && (
          <Plyr
            ref={playerRef}
            id="plyr-player"
            source={source}
            options={options}
          />
        )}
      </div>
    </div>
  );
};

export default VideoPlayer;
