import React from "react";
import { createRoot } from "react-dom/client";

// editor renders directly in editor.html (no sandbox.html iframe); heavy mediabunny ops run in-process via editorOps
import ContentState from "../EditorApp/context/ContentState";
import EditorApp from "../EditorApp/EditorApp";
import EditorPageBridge from "../EditorApp/EditorPageBridge";

// The hosted editor (RECORDFUL_APP_BASE, else https://recordful.app; see
// webpack.config.js), so every build edits there unless RECORDFUL_EDITOR=builtin.
const EDITOR_BASE = process.env.RECORDFUL_EDITOR_BASE;

// A build with RECORDFUL_EDITOR=web edits on the app's site: this page hands
// the tab over to it, and the site fetches the recording through
// editorbridge.html. The built-in editor below stays as the fallback, used
// when the site cannot be reached and for recovering an interrupted
// recording, which only this page knows how to do.
const siteEditorReachable = async () => {
  if (process.env.RECORDFUL_EDITOR !== "web" || !EDITOR_BASE) return false;
  if (new URLSearchParams(window.location.search).get("mode") === "recover") {
    return false;
  }
  try {
    const res = await fetch(`${EDITOR_BASE}/api/health`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
};

siteEditorReachable().then((reachable) => {
  if (reachable) {
    // The site only knows the store build's ID; unpacked and self-hosted
    // builds have their own, so name ours or it can't reach editorbridge.html.
    const url = new URL("/editor", EDITOR_BASE);
    url.searchParams.set("ext", chrome.runtime.id);
    window.location.replace(url.href);
    return;
  }
  const container = window.document.querySelector("#app-container");
  if (container) {
    createRoot(container).render(
      <ContentState>
        <EditorApp />
        <EditorPageBridge />
      </ContentState>
    );
  }
});

// Hot Module Replacement
if (module.hot) {
  module.hot.accept();
}
