// The tab the user handed to the agent by clicking the Recordful icon (or
// pressing a Recordful shortcut) on it. Page tools only ever act on this tab,
// or on the tab being recorded, so a connected agent can't reach into
// anything else the user has open.
//
// storage.session: survives the worker being recycled, not a browser restart.
const ARMED_KEY = "agentBridgeArmedTab";

export const armTab = async (tab, via) => {
  if (!Number.isInteger(tab?.id) || tab.id < 0) return;
  await chrome.storage.session
    .set({ [ARMED_KEY]: { tabId: tab.id, windowId: tab.windowId, via, at: Date.now() } })
    .catch(() => {});
};

export const getArmedTab = async () => {
  const { [ARMED_KEY]: armed } = await chrome.storage.session
    .get([ARMED_KEY])
    .catch(() => ({}));
  return armed && Number.isInteger(armed.tabId) ? armed : null;
};

export const watchArmedTab = () => {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const armed = await getArmedTab();
    if (armed?.tabId === tabId) {
      await chrome.storage.session.remove([ARMED_KEY]).catch(() => {});
    }
  });
};
