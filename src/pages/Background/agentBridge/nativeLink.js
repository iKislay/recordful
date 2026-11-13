// A quiet way to reach recordful-mcp: Chrome starts the relay that the MCP
// server registered (`recordful-mcp native-host`), and the relay watches the
// bridge port for us. When the bridge comes up it says "up" and we connect
// with no click and no polling; a refused WebSocket from the worker would be
// logged on chrome://extensions every time, a refused one in the relay is not.
//
// openNativeSocket() returns an object shaped like the WebSocket the client
// already uses, so the handshake, pairing and requests are unchanged and
// still end to end with the bridge. The relay only carries the frames.
//
// Needs the optional nativeMessaging permission (asked for when AI agents is
// turned on). Without it, or without the relay installed, nothing changes:
// the toolbar icon still connects.
const HOST = "app.recordful.bridge";
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

let port = null;
let current = null;

export const nativeLinkUp = () => port !== null;

export const stopNativeLink = () => {
  if (!port) return;
  const old = port;
  port = null;
  old.disconnect();
  current?.receive({ t: "close", code: 1006, reason: "relay stopped" });
};

export const startNativeLink = async ({ bridgePort, path, onUp }) => {
  if (port || typeof chrome.runtime.connectNative !== "function") return;
  if (!(await chrome.permissions.contains({ permissions: ["nativeMessaging"] }).catch(() => false))) return;
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch {
    port = null;
    return;
  }
  const mine = port;
  mine.onMessage.addListener((msg) => {
    if (msg?.t === "up") onUp();
    else current?.receive(msg);
  });
  mine.onDisconnect.addListener(() => {
    // Read so Chrome doesn't report it: "host not found" just means the MCP
    // server hasn't registered the relay on this machine.
    void chrome.runtime.lastError;
    if (port !== mine) return;
    port = null;
    current?.receive({ t: "close", code: 1006, reason: "relay gone" });
  });
  mine.postMessage({ t: "hello", port: bridgePort, path });
};

export const openNativeSocket = () => {
  const link = port;
  if (current) current.receive({ t: "close", code: 1006, reason: "replaced" });
  const socket = {
    readyState: CONNECTING,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) {
      if (socket.readyState === OPEN) link.postMessage({ t: "msg", data });
    },
    close(code = 1000, reason = "") {
      if (socket.readyState >= CLOSING) return;
      socket.readyState = CLOSING;
      try {
        link.postMessage({ t: "close", code, reason });
      } catch {
        socket.receive({ t: "close", code: 1006, reason: "relay gone" });
      }
    },
    receive(msg) {
      if (socket.readyState === CLOSED) return;
      if (msg?.t === "open") {
        socket.readyState = OPEN;
      } else if (msg?.t === "msg" && typeof msg.data === "string") {
        socket.onmessage?.({ data: msg.data });
      } else if (msg?.t === "close") {
        socket.readyState = CLOSED;
        if (current === socket) current = null;
        socket.onclose?.({ code: Number(msg.code) || 1006, reason: String(msg.reason || "") });
      }
    },
  };
  current = socket;
  link.postMessage({ t: "open" });
  return socket;
};
