// Storage the bridge client and the AI agents page (agents.html) share. The
// page and the worker talk only through these keys, so neither needs the
// other to be awake.

// local: the user's AI agents switch. Off until they turn it on.
export const ENABLED_KEY = "agentBridgeEnabled";
// local: { [serverId]: { secret, app, pairedAt } }, one per paired computer bridge.
export const PAIRINGS_KEY = "agentBridgePairings";
// session: { state: "off" | "idle" | "connecting" | "pairing" | "connected", app, at }
export const STATUS_KEY = "agentBridgeStatus";
// session: the pairing the window is asking about: { app, code, serverId, at }.
export const PAIR_PENDING_KEY = "agentBridgePairPending";
// session: written by the window: { code, allow }.
export const PAIR_DECISION_KEY = "agentBridgePairDecision";
