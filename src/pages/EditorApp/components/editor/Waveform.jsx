import React, { useContext, useRef, useEffect, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import styles from "../../styles/edit/_Waveform.module.scss";
import { ContentStateContext } from "../../context/ContentState";

const WaveformGenerator = (props) => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const wavesurferRef = useRef(null);
  const waveformContainerRef = useRef(null);
  const customCursorRef = useRef(null);
  const ghostCursorRef = useRef(null);
  const [showGhost, setShowGhost] = useState(false);
  const mouseDown = useRef(false);

  const loadWaveform = async (blob) => {
    try {
      wavesurferRef.current = WaveSurfer.create({
        container: waveformContainerRef.current,
        waveColor: "#C4C5CE",
        progressColor: "#9596A2",
        interpolation: "cubic",
        height: "auto",
        cursorWidth: 0,
      });
      wavesurferRef.current.loadBlob(blob);

      wavesurferRef.current.on("seeking", (currentTime) => {
        const containerRect =
          waveformContainerRef.current.getBoundingClientRect();
        const cursorX =
          containerRect.width *
          (currentTime / wavesurferRef.current.getDuration());
        customCursorRef.current.style.left = `${cursorX}px`;
        setContentState((prevContentState) => ({
          ...prevContentState,
          time: currentTime,
          updatePlayerTime: true,
        }));
      });
    } catch (error) {
      console.error("Error loading waveform:", error);
    }
  };

  const handleMouseEnter = () => {
    if (mouseDown.current) return;
    setShowGhost(true);
  };

  const handleMouseMove = (e) => {
    const containerRect = waveformContainerRef.current.getBoundingClientRect();
    const cursorX = e.clientX - containerRect.left;
    const minX = 0;
    const maxX = containerRect.width;
    const cursorStyle = ghostCursorRef.current.style;
    cursorStyle.left = `${cursorX}px`;
  };

  const handleMouseLeave = () => {
    setShowGhost(false);
  };

  const handleMouseDown = (e) => {
    if (waveformContainerRef.current.contains(e.target)) return;
    mouseDown.current = true;
    setShowGhost(false);
  };

  const handleMouseUp = () => {
    mouseDown.current = false;
  };

  useEffect(() => {
    if (!contentState.blob) return;
    loadWaveform(contentState.blob);
    const container = waveformContainerRef.current;
    container.addEventListener("mouseover", handleMouseEnter);
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);

    if (wavesurferRef.current) {
      wavesurferRef.current.on("seek", (position) => {
        const containerRect =
          waveformContainerRef.current.getBoundingClientRect();
        const cursorX = containerRect.width * position;
        customCursorRef.current.style.left = `${
          cursorX + containerRect.left
        }px`;
      });
    }

    return () => {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
      }
      // WaveSurfer 7 leaves old canvas behind on destroy.
      if (container) {
        container.innerHTML = "";
      }
      container.removeEventListener("mouseenter", handleMouseEnter);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [contentState.blob]);

  // Follows playback. A percentage, so it needs no layout read per tick.
  useEffect(() => {
    if (contentState.updatePlayerTime || !contentState.duration) return;
    customCursorRef.current.style.left = `${
      (contentState.time / contentState.duration) * 100
    }%`;
  }, [contentState.time, contentState.duration]);

  return (
    <div style={{ height: "100%" }}>
      <div className={styles.cursor} ref={customCursorRef}></div>
      <div
        className={styles.ghostCursor}
        style={showGhost ? { opacity: 1 } : { opacity: 0 }}
        ref={ghostCursorRef}
      ></div>
      <div className={styles.waveform} ref={waveformContainerRef}></div>
    </div>
  );
};

export default WaveformGenerator;
