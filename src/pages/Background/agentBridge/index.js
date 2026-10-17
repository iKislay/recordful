// Lets AI apps drive Recordful through a local MCP server (recordful-mcp).
// Inert until the user turns on AI agents in Recordful's settings: no socket,
// no network, nothing logged.
import { registerMessage } from "../../../messaging/messageRouter";
import { armTab, watchArmedTab } from "./armedTab";
import { createBridgeClient } from "./client";
import { commands } from "./commands";

const DEFAULT_PORT = 47823;

const openAgentsPage = async () => {
  const url = chrome.runtime.getURL("agents.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    return;
  }
  await chrome.tabs.create({ url, active: true });
};

// Must run synchronously during worker startup: Chrome only delivers the
// event that woke the worker (an icon click, a shortcut) to listeners that
// were registered by then.
export const initAgentBridge = () => {
  // The port and a shared secret are build-time knobs for development builds
  // only, so scripted test runs can skip the switch and the pairing window.
  const isDev = process.env.NODE_ENV === "development";
  const port = (isDev && Number(process.env.RECORDFUL_AGENT_BRIDGE_PORT)) || DEFAULT_PORT;
  const client = createBridgeClient({
    port,
    buildToken: (isDev && process.env.RECORDFUL_AGENT_BRIDGE_TOKEN) || "",
    commands,
  });

  // Handing Recordful a tab is the moment the user wants an agent; it's also
  // the gesture Chrome requires before tab capture can start. It also arms
  // that tab: the only one page tools may act on (besides the recorded tab).
  chrome.action.onClicked.addListener((tab) => {
    armTab(tab, "toolbar-icon");
    client.wake("toolbar-icon");
  });
  chrome.commands.onCommand.addListener((_command, tab) => {
    armTab(tab, "shortcut");
    client.wake("shortcut");
  });
  watchArmedTab();

  registerMessage("open-agent-settings", () => {
    openAgentsPage().catch(() => {});
  });

  client.resumeIfWanted();
};
