import React from "react";
import { createRoot } from "react-dom/client";

// editor renders directly in editor.html (no sandbox.html iframe); heavy mediabunny ops run in-process via editorOps
import ContentState from "../EditorApp/context/ContentState";
import EditorApp from "../EditorApp/EditorApp";
import EditorPageBridge from "../EditorApp/EditorPageBridge";
import { latestTakeName, webEditorUrl } from "../utils/webEditorUrl";

// Every build edits on the site (see webpack.config.js) unless it opts out
// with RECORDFUL_EDITOR=builtin, for people who host their own editor.
//
// There is no fallback to the built-in editor. The site fetches the take
// through editorbridge.html and keeps asking until it has it, and the take
// stays protected here until the site has kept a whole copy
// (recordingRetention.js). Recovery goes the same way: the background has
// already pointed lastRecordingBackendRef at the recovered file.
const handOffToSite = async () => {
  const url = webEditorUrl(await latestTakeName());
  const go = () => window.location.replace(url);
  if (navigator.onLine) {
    go();
    return;
  }
  // Offline, the site cannot load. Wait here, where the take is safe, and
  // go the moment the connection is back.
  window.addEventListener("online", go, { once: true });
  const container = window.document.querySelector("#app-container");
  if (!container) return;
  const card = document.createElement("div");
  card.style.cssText =
    "max-width:420px;margin:20vh auto;padding:24px;font-family:Satoshi-Medium,system-ui,sans-serif;text-align:center;color:#29292f";
  const title = document.createElement("h1");
  title.style.cssText = "font-size:18px;margin:0 0 8px";
  title.textContent = chrome.i18n.getMessage("editorHandoffOfflineTitle");
  const text = document.createElement("p");
  text.style.cssText = "font-size:14px;line-height:1.5;color:#6e7684;margin:0 0 16px";
  text.textContent = chrome.i18n.getMessage("editorHandoffOfflineDescription");
  const button = document.createElement("button");
  button.style.cssText =
    "font:inherit;font-size:14px;padding:8px 16px;border:none;border-radius:30px;background:#29292f;color:#fff;cursor:pointer";
  button.textContent = chrome.i18n.getMessage("openWebEditorLabel");
  button.addEventListener("click", go);
  card.append(title, text, button);
  container.append(card);
};

if (
  process.env.RECORDFUL_EDITOR === "web" &&
  process.env.RECORDFUL_EDITOR_BASE
) {
  handOffToSite();
} else {
  const container = window.document.querySelector("#app-container");
  if (container) {
    createRoot(container).render(
      <ContentState>
        <EditorApp />
        <EditorPageBridge />
      </ContentState>
    );
  }
}

// Hot Module Replacement
if (module.hot) {
  module.hot.accept();
}
