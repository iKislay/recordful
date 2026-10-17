// Service-worker side of recordful-mcp (protocol v2; see that repo's
// docs/protocol.md). The worker dials out to a loopback WebSocket because an
// MV3 worker can't listen, and only takes requests after the server proves it
// holds this extension's pairing secret, so a stray process on the port can't
// start a recording.
//
// Nothing happens until the user turns on AI agents (Recordful popup →
// More → AI agents). After that the worker dials when the user hands
// Recordful a tab (toolbar icon or shortcut, the same gesture tab capture
// needs anyway). It never polls: Chrome logs every refused WebSocket on
// chrome://extensions. After an established session drops it retries for
// about a minute in case the MCP server is restarting, then goes quiet.
//
// The first time it meets a machine's bridge it asks to pair: Recordful opens
// a small window naming the app and showing a code the agent also shows in
// chat, and on Allow hands the bridge a fresh secret both sides keep.
import { computeProof, newNonce, newSecret, proofsEqual } from "./auth";
import { AgentBridgeError, AgentErrorCode } from "./errors";
import {
  ENABLED_KEY,
  PAIR_DECISION_KEY,
  PAIR_PENDING_KEY,
  PAIRINGS_KEY,
  STATUS_KEY,
} from "./storageKeys";

export const PROTOCOL_VERSION = 2;
const PATH = "/recordful-agent-bridge/v2";
// Chrome keeps a worker alive while a WebSocket exchanges messages at least
// every 30s (Chrome 116+); 20s leaves margin. The server drops us after 65s.
const PING_INTERVAL_MS = 20000;
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000, 30000];
// Development only: overrides the port, e.g. to test against a second bridge
// while an MCP client's bridge holds the default one.
const PORT_STORAGE_KEY = "agentBridgePort";
// storage.session outlives worker restarts but not the browser: a worker
// that Chrome recycled mid-session picks the connection back up on boot.
const WANTED_KEY = "agentBridgeWanted";
const CloseCode = {
  AuthFailed: 4401,
  BadMessage: 4400,
  PairingRejected: 4403,
  ProtocolVersion: 4426,
};

const log = (...args) => console.info("[Recordful][AgentBridge]", ...args);
const warn = (...args) => console.warn("[Recordful][AgentBridge]", ...args);

const getLocal = async (key) => (await chrome.storage.local.get([key]))[key];
const setSession = (items) => chrome.storage.session.set(items).catch(() => {});

export const createBridgeClient = ({ port: buildPort, buildToken, commands }) => {
  let ws = null;
  let attempt = 0;
  let attemptsLeft = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let pairWindowId = null;
  // Commands on the same queue run one at a time: two overlapping starts
  // would race the recorder's own in-flight guards, and two page actions
  // would fight over the cursor. Commands with no queue run at once.
  const queues = new Map();

  // Development builds may bake a shared secret in, so scripted test runs
  // need neither the setting nor the pairing window.
  const isEnabled = async () => Boolean(buildToken) || (await getLocal(ENABLED_KEY)) === true;

  const getPort = async () => {
    const stored = buildToken ? await getLocal(PORT_STORAGE_KEY) : null;
    return Number.isInteger(stored) && stored > 0 && stored < 65536 ? stored : buildPort;
  };

  const setStatus = (state, extra = {}) => {
    setSession({ [STATUS_KEY]: { state, at: Date.now(), ...extra } });
    // The toolbar badge is the always-visible sign that an agent can act.
    const connected = state === "connected";
    chrome.action.setBadgeText({ text: connected ? "AI" : "" }).catch(() => {});
    if (connected) {
      chrome.action.setBadgeBackgroundColor({ color: "#4F46E5" }).catch(() => {});
    }
    chrome.action
      .setTitle({
        title: connected
          ? chrome.i18n.getMessage("agentBadgeTitle", [extra.app || ""]) || "Recordful"
          : chrome.i18n.getMessage("extName") || "Recordful",
      })
      .catch(() => {});
  };

  const send = (msg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const setWanted = (wanted) => setSession({ [WANTED_KEY]: wanted });

  const scheduleReconnect = () => {
    if (reconnectTimer) return;
    if (attemptsLeft <= 0) {
      setWanted(false);
      return;
    }
    attemptsLeft--;
    const delay =
      RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
    attempt++;
    // Jitter so a fleet of reloaded dev profiles doesn't reconnect in lockstep.
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect({ mayPair: false });
    }, delay + Math.floor(Math.random() * 250));
  };

  // A user gesture: one attempt, no retries, so a click with no bridge
  // running costs exactly one logged error. Only a gesture may start pairing.
  const wake = async (reason) => {
    if (ws || !(await isEnabled())) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    attempt = 0;
    attemptsLeft = 0;
    log("connecting", { reason });
    connect({ mayPair: true });
  };

  const resumeIfWanted = async () => {
    const { [WANTED_KEY]: wanted } = await chrome.storage.session
      .get([WANTED_KEY])
      .catch(() => ({}));
    if (!wanted || ws || !(await isEnabled())) {
      if (!ws) setStatus((await isEnabled()) ? "idle" : "off");
      return;
    }
    attempt = 0;
    attemptsLeft = RECONNECT_BACKOFF_MS.length;
    connect({ mayPair: false });
  };

  const disconnect = (reason) => {
    attemptsLeft = 0;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    setWanted(false);
    if (ws) ws.close(1000, reason);
  };

  const stopPing = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  };

  // ---- pairing -------------------------------------------------------------

  const closePairWindow = () => {
    if (pairWindowId !== null) chrome.windows.remove(pairWindowId).catch(() => {});
    pairWindowId = null;
  };

  // Shows the approval window and resolves with the user's answer: true for
  // Allow, false for Deny or closing the window.
  const askUserToPair = async ({ app, code, serverId }) => {
    await chrome.storage.session.remove([PAIR_DECISION_KEY]).catch(() => {});
    await setSession({ [PAIR_PENDING_KEY]: { app, code, serverId, at: Date.now() } });
    return new Promise((resolve) => {
      const finish = (allow) => {
        chrome.storage.onChanged.removeListener(onChanged);
        chrome.windows.onRemoved.removeListener(onRemoved);
        chrome.storage.session.remove([PAIR_PENDING_KEY, PAIR_DECISION_KEY]).catch(() => {});
        closePairWindow();
        resolve(allow);
      };
      const onChanged = (changes, area) => {
        const decision = changes[PAIR_DECISION_KEY]?.newValue;
        if (area !== "session" || !decision || decision.code !== code) return;
        finish(decision.allow === true);
      };
      const onRemoved = (windowId) => {
        if (windowId === pairWindowId) {
          pairWindowId = null;
          finish(false);
        }
      };
      chrome.storage.onChanged.addListener(onChanged);
      chrome.windows.onRemoved.addListener(onRemoved);
      chrome.windows
        .create({
          url: chrome.runtime.getURL("agents.html?pair=1"),
          type: "popup",
          width: 440,
          height: 560,
          focused: true,
        })
        .then((win) => {
          pairWindowId = win?.id ?? null;
        })
        .catch((err) => {
          warn("could not open the pairing window", err);
          finish(false);
        });
    });
  };

  const getPairing = async (serverId) => {
    const pairings = (await getLocal(PAIRINGS_KEY)) || {};
    return pairings[serverId] || null;
  };

  const savePairing = async (serverId, record) => {
    const pairings = (await getLocal(PAIRINGS_KEY)) || {};
    pairings[serverId] = record;
    await chrome.storage.local.set({ [PAIRINGS_KEY]: pairings });
  };

  const forgetPairing = async (serverId) => {
    const pairings = (await getLocal(PAIRINGS_KEY)) || {};
    if (!pairings[serverId]) return;
    delete pairings[serverId];
    await chrome.storage.local.set({ [PAIRINGS_KEY]: pairings });
  };

  // ---- requests ------------------------------------------------------------

  const runCommand = async (msg) => {
    const command = Object.prototype.hasOwnProperty.call(commands, msg.method)
      ? commands[msg.method]
      : null;
    if (!command) {
      throw new AgentBridgeError(
        AgentErrorCode.UnknownMethod,
        `Unknown method ${msg.method}`,
      );
    }
    const params = msg.params && typeof msg.params === "object" ? msg.params : {};
    if (!command.queue) return command.run(params);
    const run = (queues.get(command.queue) || Promise.resolve()).then(() => command.run(params));
    queues.set(command.queue, run.catch(() => {}));
    return run;
  };

  const handleRequest = async (msg) => {
    if (typeof msg.id !== "string" || typeof msg.method !== "string") return;
    log("request", msg.method);
    try {
      const result = await runCommand(msg);
      send({ type: "response", id: msg.id, ok: true, result: result ?? null });
    } catch (err) {
      const known = err instanceof AgentBridgeError;
      if (!known) warn(`${msg.method} failed`, err);
      send({
        type: "response",
        id: msg.id,
        ok: false,
        error: {
          code: known ? err.code : AgentErrorCode.Internal,
          message: String(err?.message || err).slice(0, 4000),
          ...(known && err.data !== undefined ? { data: err.data } : {}),
        },
      });
    }
  };

  // ---- connection ----------------------------------------------------------

  const connect = async ({ mayPair }) => {
    if (ws || !(await isEnabled())) return;
    const port = await getPort();
    if (ws) return;
    const socket = new WebSocket(`ws://127.0.0.1:${port}${PATH}`);
    ws = socket;
    setStatus("connecting");
    const clientNonce = newNonce();
    const client = {
      extensionId: chrome.runtime.id,
      extensionVersion: chrome.runtime.getManifest().version,
      browser: navigator.userAgent,
    };
    let serverNonce = null;
    let serverId = null;
    let app = "";
    let secret = null;
    let usedStoredPairing = false;
    let pairing = false;
    let authenticated = false;
    // Messages are handled in order: the handshake awaits WebCrypto and the
    // user, and a request must not overtake the welcome that authenticates it.
    let inbox = Promise.resolve();

    const sendHello = async () =>
      send({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        clientNonce,
        proof: await computeProof(secret, "client", serverNonce, clientNonce),
        client,
      });

    const onMessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        socket.close(CloseCode.BadMessage, "bad json");
        return;
      }

      if (!authenticated) {
        if (msg.type === "challenge" && serverNonce === null) {
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            warn(`bridge speaks protocol ${msg.protocolVersion}, Recordful speaks ${PROTOCOL_VERSION}; update the older one`);
            socket.close(CloseCode.ProtocolVersion, "protocol mismatch");
            return;
          }
          if (
            !/^[0-9a-f]{64}$/.test(String(msg.serverNonce)) ||
            typeof msg.serverId !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(msg.serverId)
          ) {
            socket.close(CloseCode.BadMessage, "bad challenge");
            return;
          }
          serverNonce = msg.serverNonce;
          serverId = msg.serverId;
          app = String(msg.app || "").slice(0, 80);
          const stored = await getPairing(serverId);
          if (stored?.secret) {
            secret = stored.secret;
            usedStoredPairing = true;
            await sendHello();
            return;
          }
          if (buildToken) {
            secret = buildToken;
            await sendHello();
            return;
          }
          if (!mayPair) {
            // Pairing needs the user; an automatic reconnect never prompts.
            socket.close(1000, "not paired");
            return;
          }
          pairing = true;
          setStatus("pairing", { app });
          send({ type: "pair_request", protocolVersion: PROTOCOL_VERSION, client });
          return;
        }
        if (msg.type === "pair_code" && pairing && /^\d{4}$/.test(String(msg.code))) {
          const allow = await askUserToPair({ app, code: msg.code, serverId });
          if (socket.readyState !== WebSocket.OPEN) return;
          if (!allow) {
            log("pairing declined");
            send({ type: "pair_reject" });
            return;
          }
          secret = newSecret();
          await savePairing(serverId, { secret, app, pairedAt: Date.now() });
          pairing = false;
          send({ type: "pair_accept", secret });
          await sendHello();
          return;
        }
        if (msg.type === "welcome" && serverNonce !== null && secret) {
          const expected = await computeProof(secret, "server", serverNonce, clientNonce);
          if (!proofsEqual(expected, msg.proof)) {
            warn("server could not prove it holds the pairing secret; refusing it");
            socket.close(CloseCode.AuthFailed, "server proof invalid");
            return;
          }
          authenticated = true;
          attempt = 0;
          setWanted(true);
          setStatus("connected", { app });
          log("connected", { sessionId: msg.sessionId, port, app });
          stopPing();
          pingTimer = setInterval(() => send({ type: "ping", ts: Date.now() }), PING_INTERVAL_MS);
          return;
        }
        socket.close(CloseCode.BadMessage, "unexpected handshake message");
        return;
      }

      if (msg.type === "request") {
        // Not awaited: a long start must not block status calls behind it.
        handleRequest(msg);
      }
    };

    socket.onmessage = (event) => {
      inbox = inbox.then(() => onMessage(event)).catch((err) => warn("message handler threw", err));
    };
    socket.onclose = async (event) => {
      if (ws === socket) ws = null;
      stopPing();
      if (pairing) {
        // The bridge gave up (timeout, or a newer request): drop our window.
        chrome.storage.session.remove([PAIR_PENDING_KEY]).catch(() => {});
        closePairWindow();
      }
      if (authenticated) {
        log("disconnected", { code: event.code, reason: event.reason });
        // The MCP server may just be restarting; give it about a minute.
        attempt = 0;
        attemptsLeft = RECONNECT_BACKOFF_MS.length;
      }
      // The bridge no longer knows our secret (its pairings were reset):
      // forget it too, and if the user is here (a gesture started this),
      // ask to pair again right away rather than making them click twice.
      if (event.code === CloseCode.AuthFailed && usedStoredPairing && serverId) {
        await forgetPairing(serverId);
        if (mayPair) {
          log("bridge no longer knows this pairing; asking again");
          connect({ mayPair: true });
          return;
        }
      }
      // Retrying can't fix a version or secret mismatch, or a refusal.
      if (
        event.code === CloseCode.ProtocolVersion ||
        event.code === CloseCode.AuthFailed ||
        event.code === CloseCode.PairingRejected
      ) {
        attemptsLeft = 0;
      }
      setStatus((await isEnabled()) ? "idle" : "off", {
        lastClose: authenticated ? "disconnected" : event.code === 1006 ? "unreachable" : String(event.code),
      });
      scheduleReconnect();
    };
    // The close event follows with the details; Chrome already logs the failure.
    socket.onerror = () => {};
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[ENABLED_KEY]) {
      if (changes[ENABLED_KEY].newValue === true) {
        // Turning it on is itself a gesture: try right away.
        wake("enabled");
      } else {
        disconnect("AI agents turned off");
        setStatus("off");
      }
    }
    if (changes[PAIRINGS_KEY] && ws && !changes[PAIRINGS_KEY].newValue) {
      // "Forget all" while connected: end the session too.
      disconnect("pairings forgotten");
    }
    if (buildToken && changes[PORT_STORAGE_KEY]) {
      if (ws) ws.close(1000, "port changed");
      else wake("port-changed");
    }
  });

  return { wake, resumeIfWanted };
};
