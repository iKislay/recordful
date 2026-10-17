// Must be the first import; sets __webpack_public_path__ so dynamic
// chunks resolve against the extension origin. See publicPath.js.
import "./publicPath";

import React from "react";
import { createRoot } from "react-dom/client";
import Content from "./Content";
import { initAgentPage } from "./agentPage";

// AI agents page tools: a listener that answers only Recordful's own worker,
// which only asks while the user has AI agents on and has handed over this
// tab. Outside the guard below on purpose: a re-injected copy takes over from
// the earlier one (see agentPage/index.js).
initAgentPage();

// Idempotency: content script is injected via manifest AND by
// executeScripts() on session start; both mounts would double-fire.
if (window.__recordfulContentBootstrapped) {
} else {
  window.__recordfulContentBootstrapped = true;

  const existingRoot = document.getElementById("recordful-ui");
  if (existingRoot) {
    document.body.removeChild(existingRoot);
  }

  const root = document.createElement("div");
  root.id = "recordful-ui";
  document.body.appendChild(root);

  const appRoot = createRoot(root);
  appRoot.render(<Content />);
}
