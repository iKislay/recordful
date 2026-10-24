// Floating Document Picture-in-Picture window for the script; window and tab
// captures leave it out of the recording. Chrome only opens one from a user
// gesture, so openPrompterWindow() must run synchronously inside the click.

export const PROMPTER_WINDOW_SIZE = { width: 420, height: 380 };

let pipWindow = null;
let opening = null;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn());

export const isPrompterWindowSupported = () => {
  try {
    return typeof window.documentPictureInPicture?.requestWindow === "function";
  } catch {
    return false;
  }
};

export const subscribePrompterWindow = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getPrompterWindow = () =>
  pipWindow && !pipWindow.closed ? pipWindow : null;

export const openPrompterWindow = async () => {
  const existing = getPrompterWindow();
  if (existing) {
    try {
      existing.focus();
    } catch {}
    return true;
  }
  if (!isPrompterWindowSupported()) return false;
  if (opening) {
    await opening.catch(() => {});
    return openPrompterWindow();
  }

  let win;
  try {
    opening = window.documentPictureInPicture.requestWindow({
      ...PROMPTER_WINDOW_SIZE,
      disallowReturnToOpener: true,
    });
    win = await opening;
  } catch {
    return false;
  } finally {
    opening = null;
  }

  try {
    const doc = win.document;
    doc.title = "Recordful";
    doc.documentElement.lang = chrome.i18n.getUILanguage();
    doc.documentElement.style.height = "100%";
    Object.assign(doc.body.style, {
      margin: "0",
      height: "100%",
      overflow: "hidden",
      background: "#1b1b1f",
    });
  } catch {}

  // A window closed by hand or by the browser (navigation, another PiP
  // opening) never passes through closePrompterWindow().
  win.addEventListener("pagehide", () => {
    if (pipWindow === win) {
      pipWindow = null;
      emit();
    }
  });
  pipWindow = win;
  emit();
  return true;
};

export const closePrompterWindow = () => {
  const win = pipWindow;
  pipWindow = null;
  try {
    if (win && !win.closed) win.close();
  } catch {}
  emit();
};
