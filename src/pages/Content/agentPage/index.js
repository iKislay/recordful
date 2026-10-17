// Dev-only: carries out page actions for the agent bridge (see
// Background/agentBridge/pageCommands.js). Compiled in only when the build
// sets RECORDFUL_AGENT_BRIDGE=1; every other build folds the guard in
// Content/index.jsx to false and never includes this module.
import { performAction } from "./actions";
import * as cursor from "./cursor";

// Must match Background/agentBridge/pageCommands.js.
const PAGE_MESSAGE = "recordful-agent-page";

export const initAgentPage = () => {
  if (window !== window.top) return;

  // The worker injects this bundle again when it can't tell it is already
  // there. The newest copy takes over and earlier ones stand down, so one
  // request never runs twice; its refs are its own, hence a new docId.
  const owner = {};
  window.__recordfulAgentPageOwner = owner;
  const docId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const handle = async (message) => {
    try {
      if (message.expectDocId && message.expectDocId !== docId) {
        throw Object.assign(
          new Error("The page changed (it navigated or reloaded) since your last snapshot. Take a new snapshot."),
          { code: "STALE_REF" },
        );
      }
      cursor.restore(message.cursor);
      const result = await performAction(message.action, message.params || {}, cursor.position());
      return { ok: true, result, docId, cursor: cursor.position() };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: err?.code || "INTERNAL",
          message: String(err?.message || err).slice(0, 2000),
          ...(err?.data !== undefined ? { data: err.data } : {}),
        },
        docId,
        cursor: cursor.position(),
      };
    }
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== PAGE_MESSAGE) return undefined;
    if (window.__recordfulAgentPageOwner !== owner) return undefined;
    // Only the extension's own worker may drive the page, never another
    // tab's content script relaying through it.
    if (sender.id !== chrome.runtime.id || sender.tab) return undefined;
    handle(message).then(sendResponse);
    return true;
  });
};
