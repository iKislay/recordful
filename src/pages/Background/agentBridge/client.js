// Service-worker side of recordful-agent-bridge (see that repo's
// docs/protocol.md). The worker dials out to a loopback WebSocket because an
// MV3 worker can't listen; it only accepts requests after the server proves
// it holds the pairing token, so a stray process on the port can't start a
// recording.
//
// Chrome logs every refused WebSocket on chrome://extensions, so the worker
// never polls for a bridge. It dials when the user hands Recordful a tab
// (toolbar icon or shortcut, the same gesture tab capture needs anyway), and
// after an established session drops it retries for about a minute in case
// the MCP server is restarting. Then it goes quiet until the next gesture.
import { computeProof, newNonce, proofsEqual } from "./auth";
import { AgentBridgeError, AgentErrorCode } from "./errors";

export const PROTOCOL_VERSION = 1;
const PATH = "/recordful-agent-bridge/v1";
// Chrome keeps a worker alive while a WebSocket exchanges messages at least
// every 30s (Chrome 116+); 20s leaves margin. The server drops us after 65s.
const PING_INTERVAL_MS = 20000;
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000, 30000];
const TOKEN_STORAGE_KEY = "agentBridgeToken";
// Overrides the build-time port, e.g. to test against a second bridge while
// an MCP client's bridge holds the default one.
const PORT_STORAGE_KEY = "agentBridgePort";
// storage.session outlives worker restarts but not the browser: a worker
// that Chrome recycled mid-session picks the connection back up on boot.
const WANTED_KEY = "agentBridgeWanted";
const CloseCode = { AuthFailed: 4401, BadMessage: 4400, ProtocolVersion: 4426 };

const log = (...args) => console.info("[Recordful][AgentBridge]", ...args);
const warn = (...args) => console.warn("[Recordful][AgentBridge]", ...args);

export const createBridgeClient = ({ port: buildPort, buildToken, commands }) => {
  let ws = null;
  let attempt = 0;
  let attemptsLeft = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  // Commands on the same queue run one at a time: two overlapping starts
  // would race the recorder's own in-flight guards, and two page actions
  // would fight over the cursor. Commands with no queue run at once.
  const queues = new Map();

  const getToken = async () => {
    const { [TOKEN_STORAGE_KEY]: stored } = await chrome.storage.local.get([
      TOKEN_STORAGE_KEY,
    ]);
    return stored || buildToken || "";
  };

  const getPort = async () => {
    const { [PORT_STORAGE_KEY]: stored } = await chrome.storage.local.get([PORT_STORAGE_KEY]);
    return Number.isInteger(stored) && stored > 0 && stored < 65536 ? stored : buildPort;
  };

  const send = (msg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const setWanted = (wanted) =>
    chrome.storage.session.set({ [WANTED_KEY]: wanted }).catch(() => {});

  const scheduleReconnect = () => {
    if (reconnectTimer) return;
    if (attemptsLeft <= 0) {
      setWanted(false);
      log("bridge not reachable; click the Recordful icon to try again");
      return;
    }
    attemptsLeft--;
    const delay =
      RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
    attempt++;
    // Jitter so a fleet of reloaded dev profiles doesn't reconnect in lockstep.
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay + Math.floor(Math.random() * 250));
  };

  // A user gesture: one attempt, no retries, so a click with no bridge
  // running costs exactly one logged error.
  const wake = (reason) => {
    if (ws) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    attempt = 0;
    attemptsLeft = 0;
    log("connecting", { reason });
    connect();
  };

  const resumeIfWanted = async () => {
    const { [WANTED_KEY]: wanted } = await chrome.storage.session
      .get([WANTED_KEY])
      .catch(() => ({}));
    if (!wanted || ws) return;
    attempt = 0;
    attemptsLeft = RECONNECT_BACKOFF_MS.length;
    connect();
  };

  const stopPing = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  };

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

  const connect = async () => {
    if (ws) return;
    const token = await getToken();
    if (!token) {
      // Nothing to pair with; the storage listener below retries once one is set.
      log(`no pairing token; set chrome.storage.local.${TOKEN_STORAGE_KEY} or build with RECORDFUL_AGENT_BRIDGE_TOKEN`);
      return;
    }

    const port = await getPort();
    if (ws) return;
    const socket = new WebSocket(`ws://127.0.0.1:${port}${PATH}`);
    ws = socket;
    const clientNonce = newNonce();
    let serverNonce = null;
    let authenticated = false;
    // Messages are handled in order: the handshake awaits WebCrypto, and a
    // request must not overtake the welcome that authenticates it.
    let inbox = Promise.resolve();

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
            warn(`bridge speaks protocol ${msg.protocolVersion}, extension speaks ${PROTOCOL_VERSION}`);
            socket.close(CloseCode.ProtocolVersion, "protocol mismatch");
            return;
          }
          if (!/^[0-9a-f]{64}$/.test(String(msg.serverNonce))) {
            socket.close(CloseCode.BadMessage, "bad nonce");
            return;
          }
          serverNonce = msg.serverNonce;
          send({
            type: "hello",
            protocolVersion: PROTOCOL_VERSION,
            clientNonce,
            proof: await computeProof(token, "client", serverNonce, clientNonce),
            client: {
              extensionId: chrome.runtime.id,
              extensionVersion: chrome.runtime.getManifest().version,
              browser: navigator.userAgent,
            },
          });
          return;
        }
        if (msg.type === "welcome" && serverNonce !== null) {
          const expected = await computeProof(token, "server", serverNonce, clientNonce);
          if (!proofsEqual(expected, msg.proof)) {
            warn("server could not prove it holds the pairing token; refusing it");
            socket.close(CloseCode.AuthFailed, "server proof invalid");
            return;
          }
          authenticated = true;
          attempt = 0;
          setWanted(true);
          log("connected", { sessionId: msg.sessionId, port });
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
    socket.onclose = (event) => {
      if (ws === socket) ws = null;
      stopPing();
      if (authenticated) {
        log("disconnected", { code: event.code, reason: event.reason });
        // The MCP server may just be restarting; give it about a minute.
        attempt = 0;
        attemptsLeft = RECONNECT_BACKOFF_MS.length;
      }
      // Retrying can't fix a version or token mismatch.
      if (
        event.code === CloseCode.ProtocolVersion ||
        event.code === CloseCode.AuthFailed
      ) {
        attemptsLeft = 0;
      }
      scheduleReconnect();
    };
    // The close event follows with the details; Chrome already logs the failure.
    socket.onerror = () => {};
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(changes[TOKEN_STORAGE_KEY] || changes[PORT_STORAGE_KEY])) return;
    log("pairing token or port changed, reconnecting");
    // Closing an authenticated socket schedules the reconnect itself.
    if (ws) ws.close(1000, "token changed");
    else wake("token-changed");
  });

  return { wake, resumeIfWanted };
};
