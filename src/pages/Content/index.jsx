// Must be the first import; sets __webpack_public_path__ so dynamic
// chunks resolve against the extension origin. See publicPath.js.
import "./publicPath";

import React from "react";
import { createRoot } from "react-dom/client";
import Content from "./Content";

// Dev-only agent page tools. DefinePlugin folds the test to false in every
// other build, so webpack never parses the require and it ships nowhere.
// Outside the guard below on purpose: a re-injected copy takes over from the
// earlier one (see agentPage/index.js).
if (process.env.RECORDFUL_AGENT_BRIDGE === "1") {
  require("./agentPage").initAgentPage();
}

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
