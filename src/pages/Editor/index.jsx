import React from "react";
import { createRoot } from "react-dom/client";

// editor renders directly in editor.html (no sandbox.html iframe); heavy mediabunny ops run in-process via editorOps
import ContentState from "../EditorApp/context/ContentState";
import EditorApp from "../EditorApp/EditorApp";
import EditorPageBridge from "../EditorApp/EditorPageBridge";

const APP_BASE = process.env.RECORDFUL_APP_BASE;

// A build with RECORDFUL_EDITOR=web edits on the app's site: this page hands
// the tab over to it, and the site fetches the recording through
// editorbridge.html. The built-in editor below stays as the fallback, used
// when the site cannot be reached and for recovering an interrupted
// recording, which only this page knows how to do.
const siteEditorReachable = async () => {
  if (process.env.RECORDFUL_EDITOR !== "web" || !APP_BASE) return false;
  if (new URLSearchParams(window.location.search).get("mode") === "recover") {
    return false;
  }
  try {
    const res = await fetch(`${APP_BASE}/api/health`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
};

siteEditorReachable().then((reachable) => {
  if (reachable) {
    window.location.replace(`${APP_BASE}/editor`);
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
