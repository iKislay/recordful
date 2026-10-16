// Dev-only bridge that lets a local MCP server (recordful-agent-bridge) drive
// the recorder. Loaded only when the build sets RECORDFUL_AGENT_BRIDGE=1, which
// webpack.config.js refuses outside development builds.
import { createBridgeClient } from "./client";
import { commands } from "./commands";

const DEFAULT_PORT = 47823;

// Must run synchronously during worker startup: Chrome only delivers the
// event that woke the worker (an icon click, a shortcut) to listeners that
// were registered by then.
export const initAgentBridge = () => {
  const port = Number(process.env.RECORDFUL_AGENT_BRIDGE_PORT) || DEFAULT_PORT;
  const client = createBridgeClient({
    port,
    buildToken: process.env.RECORDFUL_AGENT_BRIDGE_TOKEN || "",
    commands,
  });

  // Handing Recordful a tab is the moment the user wants an agent; it's also
  // the gesture Chrome requires before tab capture can start.
  chrome.action.onClicked.addListener(() => client.wake("toolbar-icon"));
  chrome.commands.onCommand.addListener(() => client.wake("shortcut"));

  client.resumeIfWanted();
};
