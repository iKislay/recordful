// The on-page "Stop" chip: while an agent is connected, the tab the user
// handed over shows who is driving it and a button that ends the session
// (Content/agentPage/stopChip.js draws it). Hidden while a recording is
// running so it stays out of the video; it shows again on pause.
import { registerMessage } from "../../../messaging/messageRouter";
import { ARMED_KEY, clearArmedTab, getArmedTab } from "./armedTab";
import { STATUS_KEY } from "./storageKeys";

// Must match Content/agentPage/stopChip.js.
const CHIP_MESSAGE = "recordful-agent-chip";

const chipState = async () => {
  const { [STATUS_KEY]: status } = await chrome.storage.session
    .get([STATUS_KEY])
    .catch(() => ({}));
  const armed = await getArmedTab();
  const snap = await chrome.storage.local.get(["recording", "paused"]);
  const tabId = status?.state === "connected" ? armed?.tabId ?? null : null;
  return { tabId, show: tabId !== null && !(snap.recording && !snap.paused), app: status?.app || "" };
};

export const watchStopChip = ({ stop }) => {
  // In memory: a worker restart forgets it, which at worst leaves a chip
  // whose button just hides it (the stop below checks the tab).
  let shownOn = null;
  const tell = (tabId, state) =>
    chrome.tabs.sendMessage(tabId, { type: CHIP_MESSAGE, ...state }).catch(() => {});

  const sync = async () => {
    const { tabId, show, app } = await chipState();
    if (shownOn !== null && shownOn !== tabId) tell(shownOn, { show: false });
    if (tabId !== null) tell(tabId, { show, app });
    shownOn = tabId;
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && (changes[STATUS_KEY] || changes[ARMED_KEY])) sync();
    if (area === "local" && (changes.recording || changes.paused)) sync();
  });

  // A page that loaded after the last change asks for itself.
  registerMessage("agent-chip-state", async (_message, sender) => {
    const state = await chipState();
    return sender.tab?.id === state.tabId ? state : { show: false };
  });

  registerMessage("agent-stop", async (_message, sender) => {
    const armed = await getArmedTab();
    if (armed && sender.tab?.id === armed.tabId) {
      stop("stopped from the page");
      await clearArmedTab();
    }
    if (sender.tab?.id) tell(sender.tab.id, { show: false });
    return { ok: true };
  });
};
