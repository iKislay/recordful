// The chip at the top of the tab an agent is driving: who is driving, and a
// Stop button that ends the agent's session. The worker decides when it shows
// (Background/agentBridge/stopChip.js); this only draws it.
import { STOP_CHIP_HOST_ID } from "./elements";

// Must match Background/agentBridge/stopChip.js.
const CHIP_MESSAGE = "recordful-agent-chip";

const STYLE = `
:host { all: initial; }
.chip {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 14px;
  border-radius: 999px; background: #1f1f2e; color: #fff;
  font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 4px 16px rgba(0,0,0,.25); pointer-events: auto; max-width: calc(100vw - 32px);
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: #4F46E5; flex: none; }
.label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button {
  all: unset; cursor: pointer; padding: 6px 12px; border-radius: 999px;
  background: #fff; color: #1f1f2e; font-weight: 600;
}
button:hover { background: #e8e8f0; }
button:focus-visible { outline: 2px solid #4F46E5; outline-offset: 2px; }
`;

let host = null;

const hide = () => {
  host?.remove();
  host = null;
};

const show = (app) => {
  hide();
  host = document.createElement("div");
  host.id = STOP_CHIP_HOST_ID;
  host.style.cssText = "position:fixed!important;z-index:2147483647!important;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>${STYLE}</style><div class="chip" role="status"><span class="dot"></span><span class="label"></span><button type="button"></button></div>`;
  const label = app
    ? chrome.i18n.getMessage("agentChipLabel", [app])
    : chrome.i18n.getMessage("agentChipLabelNoApp");
  shadow.querySelector(".label").textContent = label || "An AI agent is using this tab";
  const button = shadow.querySelector("button");
  button.textContent = chrome.i18n.getMessage("agentChipStop") || "Stop";
  button.addEventListener("click", () => {
    hide();
    chrome.runtime.sendMessage({ type: "agent-stop" }).catch(() => {});
  });
  document.documentElement.appendChild(host);
};

export const initStopChip = () => {
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== CHIP_MESSAGE || sender.id !== chrome.runtime.id || sender.tab) return;
    if (message.show) show(message.app);
    else hide();
  });
  chrome.runtime
    .sendMessage({ type: "agent-chip-state" })
    .then((state) => state?.show && show(state.app))
    .catch(() => {});
};
