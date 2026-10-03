export const focusTab = async (tabId, context = {}) => {
  if (!Number.isInteger(tabId)) {
    console.warn("[Recordful][BG] focusTab skipped: invalid tabId", {
      tabId,
      context,
    });
    return false;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.id || typeof tab.windowId !== "number") {
      console.warn("[Recordful][BG] focusTab skipped: tab unavailable", {
        tabId,
        context,
      });
      return false;
    }

    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    return true;
  } catch (error) {
    console.warn("[Recordful][BG] focusTab failed", {
      tabId,
      context,
      error: error?.message || String(error),
    });
    return false;
  }
};
