import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { contentStateContext, timerContext } from "../context/ContentState";
import Teleprompter from "./Teleprompter";
import {
  DEFAULT_SETTINGS,
  formatClock,
  normalizeSettings,
  shouldClosePrompter,
} from "./prompterRules";
import { loadPrompterSettings, savePrompterSettings } from "./prompterSettings";
import {
  closePrompterWindow,
  getPrompterWindow,
  subscribePrompterWindow,
} from "./prompterWindow";

const SAVE_DELAY_MS = 400;

// Always mounted. Owns the floating window once the popup opens it and ties it
// to the recording: scrolls with the take, stops on pause, closes if the capture includes it.
const TeleprompterController = () => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [seconds] = useContext(timerContext);
  const win = useSyncExternalStore(subscribePrompterWindow, getPrompterWindow);

  const [settings, setSettings] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [rewindToken, setRewindToken] = useState(0);
  const [host, setHost] = useState(null);

  const settingsRef = useRef(null);
  const saveTimerRef = useRef(null);
  const contentStateRef = useRef(contentState);
  contentStateRef.current = contentState;

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (settingsRef.current) savePrompterSettings(settingsRef.current);
    }
  }, []);

  const onSettings = useCallback((patch) => {
    const next = normalizeSettings({ ...settingsRef.current, ...patch });
    settingsRef.current = next;
    setSettings(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      savePrompterSettings(next);
    }, SAVE_DELAY_MS);
  }, []);

  // Close with the page, and on extension reload, disable or update: the
  // orphaned script's window would be a zombie the popup can no longer close.
  useEffect(() => {
    if (!win) return undefined;
    const close = () => closePrompterWindow();
    window.addEventListener("pagehide", close);
    const alive = () => {
      try {
        return Boolean(chrome.runtime?.id);
      } catch {
        return false;
      }
    };
    const watchdog = setInterval(() => {
      if (!alive()) close();
    }, 2000);
    return () => {
      window.removeEventListener("pagehide", close);
      clearInterval(watchdog);
    };
  }, [win]);

  // Navigating away can tear the page down before the debounced write runs.
  useEffect(() => {
    window.addEventListener("pagehide", flushSave);
    return () => window.removeEventListener("pagehide", flushSave);
  }, [flushSave]);

  // Read settings on each open and write on close, so a script typed just
  // before closing is not lost.
  const windowOpen = Boolean(win);
  useEffect(() => {
    if (!windowOpen) return undefined;
    let cancelled = false;
    loadPrompterSettings().then((loaded) => {
      if (cancelled) return;
      settingsRef.current = loaded;
      setSettings(loaded);
    });
    return () => {
      cancelled = true;
      flushSave();
      settingsRef.current = null;
      setSettings(null);
      setPlaying(false);
    };
  }, [windowOpen, flushSave]);

  useEffect(() => {
    if (!win || settings === null) {
      setHost(null);
      return undefined;
    }
    const el = win.document.createElement("div");
    Object.assign(el.style, { position: "absolute", inset: "0", zIndex: "1" });
    win.document.body.appendChild(el);
    setHost(el);
    return () => {
      el.remove();
      setHost(null);
    };
  }, [win, settings === null]);

  // Scrolling follows the take; a window opened mid-recording does not start itself.
  const prevRecordingRef = useRef({
    recording: contentState.recording,
    paused: contentState.paused,
  });
  useEffect(() => {
    const prev = prevRecordingRef.current;
    const now = {
      recording: Boolean(contentState.recording),
      paused: Boolean(contentState.paused),
    };
    prevRecordingRef.current = now;
    if (!win) return;

    const wantsAutoScroll =
      settingsRef.current?.autoScroll !== false &&
      Boolean(settingsRef.current?.script?.trim());

    if (now.recording && !prev.recording) {
      if (
        shouldClosePrompter({
          recordingType: contentState.recordingType,
          surface: contentState.surface,
          recording: true,
        })
      ) {
        closePrompterWindow();
        contentStateRef.current.openToast?.(
          chrome.i18n.getMessage("teleprompterClosedToast") ||
            "Teleprompter closed to keep it out of your recording",
          () => {},
          6000,
        );
        return;
      }
      setRewindToken((n) => n + 1);
      setPlaying(wantsAutoScroll && !now.paused);
    } else if (!now.recording && prev.recording) {
      setPlaying(false);
      // A finished, cancelled or discarded take ends the session. A restart
      // also passes through "not recording" and carries on.
      if (!contentStateRef.current.restartingRecording) {
        closePrompterWindow();
      }
    } else if (now.recording && now.paused && !prev.paused) {
      setPlaying(false);
    } else if (now.recording && !now.paused && prev.paused) {
      setPlaying(wantsAutoScroll);
    }
  }, [
    contentState.recording,
    contentState.paused,
    contentState.recordingType,
    contentState.surface,
    win,
  ]);

  // Switching to the whole screen mid-take would put the window in the video.
  useEffect(() => {
    if (!win || !contentState.recording) return;
    if (
      shouldClosePrompter({
        recordingType: contentState.recordingType,
        surface: contentState.surface,
        recording: true,
      })
    ) {
      closePrompterWindow();
    }
  }, [win, contentState.recording, contentState.recordingType, contentState.surface]);

  if (!host) return null;
  const takeActive = Boolean(contentState.recording);
  return createPortal(
    <Teleprompter
      settings={settings || DEFAULT_SETTINGS}
      onSettings={onSettings}
      takeActive={takeActive}
      paused={takeActive && Boolean(contentState.paused)}
      countdown={
        contentState.countdownValue > 0 ? contentState.countdownValue : null
      }
      playing={playing}
      canPlay={takeActive}
      onPlayingChange={setPlaying}
      rewindToken={rewindToken}
      onRewind={() => {
        setPlaying(false);
        setRewindToken((n) => n + 1);
      }}
      onHide={() => closePrompterWindow()}
      timerLabel={takeActive ? formatClock(seconds) : null}
    />,
    host,
  );
};

export default TeleprompterController;
