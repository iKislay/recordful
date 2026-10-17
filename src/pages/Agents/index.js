// The AI agents page: the on/off switch, connection status, setup command and
// paired apps. Opened with ?pair=1 it is the small window that asks the user
// to approve an AI app, showing the code the app also shows in chat.
// Talks to the worker only through storage (see agentBridge/storageKeys.js).
import {
  ENABLED_KEY,
  PAIR_DECISION_KEY,
  PAIR_PENDING_KEY,
  PAIRINGS_KEY,
  STATUS_KEY,
} from "../Background/agentBridge/storageKeys";

const t = (key, subs) => chrome.i18n.getMessage(key, subs) || "";
const $ = (id) => document.getElementById(id);

const translate = (root) => {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
};

// ---- pairing window --------------------------------------------------------

const showPair = async () => {
  document.body.classList.add("pair");
  const view = $("pair");
  translate(view);
  view.hidden = false;
  document.title = t("agentsPageTitle");

  let pending = null;
  const expire = () => {
    pending = null;
    $("allow").hidden = true;
    $("deny").hidden = true;
    $("pair-code").hidden = true;
    $("pair-expired").hidden = false;
  };
  const show = (p) => {
    pending = p;
    $("pair-title").textContent = t("agentsPairTitle", [p.app]);
    $("pair-body").textContent = t("agentsPairBody", [p.app]);
    $("pair-code").textContent = p.code;
    document.title = t("agentsPairTitle", [p.app]);
    $("allow").focus();
  };
  const decide = async (allow) => {
    if (!pending) return;
    await chrome.storage.session.set({ [PAIR_DECISION_KEY]: { code: pending.code, allow } });
    window.close();
  };

  $("allow").addEventListener("click", () => decide(true));
  $("deny").addEventListener("click", () => decide(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") decide(false);
  });

  const { [PAIR_PENDING_KEY]: initial } = await chrome.storage.session.get([PAIR_PENDING_KEY]);
  if (initial?.code) show(initial);
  else expire();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session" || !changes[PAIR_PENDING_KEY]) return;
    const next = changes[PAIR_PENDING_KEY].newValue;
    if (next?.code) show(next);
    else expire();
  });
};

// ---- settings page ---------------------------------------------------------

const statusText = (status, enabled) => {
  if (!enabled) return t("offLabel");
  switch (status?.state) {
    case "connected":
      return t("agentsStatusConnected", [status.app || ""]);
    case "pairing":
      return t("agentsStatusPairing");
    case "connecting":
      return t("agentsStatusConnecting");
    default:
      return t("agentsStatusIdle");
  }
};

const formatDate = (ms) => {
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
};

const showManage = async () => {
  const view = $("manage");
  translate(view);
  document.title = `${t("agentsPageTitle")} · Recordful`;
  view.hidden = false;

  const toggle = $("enabled");
  let enabled = false;
  let status = null;

  const renderStatus = () => {
    toggle.checked = enabled;
    const state = enabled ? status?.state || "idle" : "off";
    $("status-dot").dataset.state = state;
    $("status-text").textContent = statusText(status, enabled);
  };

  const renderPairings = (pairings) => {
    const list = $("pairings");
    list.replaceChildren();
    const entries = Object.entries(pairings || {});
    $("pairings-empty").hidden = entries.length > 0;
    for (const [serverId, p] of entries) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = p.app || serverId;
      const date = document.createElement("span");
      date.className = "muted";
      date.textContent = ` · ${formatDate(p.pairedAt)}`;
      label.append(date);
      const forget = document.createElement("button");
      forget.type = "button";
      forget.className = "small";
      forget.textContent = t("agentsForget");
      forget.addEventListener("click", async () => {
        const { [PAIRINGS_KEY]: current = {} } = await chrome.storage.local.get([PAIRINGS_KEY]);
        delete current[serverId];
        await chrome.storage.local.set({ [PAIRINGS_KEY]: current });
      });
      li.append(label, forget);
      list.append(li);
    }
  };

  const local = await chrome.storage.local.get([ENABLED_KEY, PAIRINGS_KEY]);
  const session = await chrome.storage.session.get([STATUS_KEY]).catch(() => ({}));
  enabled = local[ENABLED_KEY] === true;
  status = session[STATUS_KEY] || null;
  renderStatus();
  renderPairings(local[PAIRINGS_KEY]);

  toggle.addEventListener("change", () => {
    chrome.storage.local.set({ [ENABLED_KEY]: toggle.checked });
  });

  const copy = $("copy");
  copy.textContent = t("agentsCopy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("setup-command").textContent);
      copy.textContent = t("agentsCopied");
      setTimeout(() => (copy.textContent = t("agentsCopy")), 1500);
    } catch {
      // Clipboard can be refused; the command is selectable anyway.
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[ENABLED_KEY]) {
      enabled = changes[ENABLED_KEY].newValue === true;
      renderStatus();
    }
    if (area === "local" && changes[PAIRINGS_KEY]) renderPairings(changes[PAIRINGS_KEY].newValue);
    if (area === "session" && changes[STATUS_KEY]) {
      status = changes[STATUS_KEY].newValue || null;
      renderStatus();
    }
  });
};

if (new URLSearchParams(window.location.search).get("pair") === "1") showPair();
else showManage();
