import React, {
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import Toggle from "../../Components/Toggle";
import { contentStateContext } from "../context/ContentState";
import {
  closePrompterWindow,
  getPrompterWindow,
  isPrompterWindowSupported,
  openPrompterWindow,
  subscribePrompterWindow,
} from "./prompterWindow";

const INTRO_KEY = "teleprompterIntroSeen";

// Opens the window inside the click (Chrome requires it), so the row only
// mirrors whether the script shows. The first time, an intro modal comes first
// and its button opens the window, as a click of its own.
const TeleprompterRow = () => {
  const [contentState] = useContext(contentStateContext);
  // Read on mount to keep the click synchronous; assume seen until loaded.
  const [introSeen, setIntroSeen] = useState(true);
  useEffect(() => {
    chrome.storage.local
      .get(INTRO_KEY)
      .then((stored) => setIntroSeen(stored?.[INTRO_KEY] === true))
      .catch(() => {});
  }, []);

  const open = Boolean(
    useSyncExternalStore(subscribePrompterWindow, getPrompterWindow),
  );
  const supported = isPrompterWindowSupported();

  const label = supported
    ? chrome.i18n.getMessage("teleprompterLabel") || "Teleprompter"
    : chrome.i18n.getMessage("teleprompterUnavailableLabel") ||
      "Teleprompter (not available on this page)";

  const onCheckedChange = (checked) => {
    if (!checked) {
      closePrompterWindow();
      return;
    }
    if (introSeen || typeof contentState.openModal !== "function") {
      openPrompterWindow();
      return;
    }
    const gotIt = () => {
      setIntroSeen(true);
      chrome.storage.local.set({ [INTRO_KEY]: true }).catch(() => {});
      openPrompterWindow();
    };
    contentState.openModal(
      chrome.i18n.getMessage("teleprompterIntroTitle") ||
        "How the teleprompter works",
      chrome.i18n.getMessage("teleprompterIntroDescription") ||
        "Your script opens in a floating window that stays out of the recording when you share a window or tab, record an area, or record just your camera. If you share your entire screen, the window would show in the video, so it closes when you start. Your script is always saved.",
      chrome.i18n.getMessage("instantRecordingModeAction") || "Got it",
      null,
      gotIt,
      null,
      null,
      null,
      null,
      true,
    );
  };

  return (
    <form>
      <div
        className="SwitchRow"
        style={supported ? undefined : { opacity: 0.5 }}
      >
        <label
          className="Label"
          htmlFor="teleprompter-switch"
          style={{ paddingRight: 15 }}
        >
          {label}
        </label>
        <Toggle
          id="teleprompter-switch"
          label={label}
          checked={open}
          disabled={!supported}
          onCheckedChange={onCheckedChange}
        />
      </div>
    </form>
  );
};

export default TeleprompterRow;
