// recordful.app's API, called as the signed-in Recordful user, for AI agents:
// uploads, video status and transcripts. Agents never hold a credential: the
// extension uses its own session token, exactly as the cloud recorder does.
import { loginWithWebsite } from "../auth/loginWithWebsite";
import { AgentBridgeError, AgentErrorCode } from "./errors";

const CLOUD_FEATURES_ENABLED = process.env.RECORDFUL_ENABLE_CLOUD_FEATURES === "true";
const API_BASE = process.env.RECORDFUL_API_BASE_URL;
const APP_BASE = process.env.RECORDFUL_APP_BASE;
const REQUEST_TIMEOUT_MS = 30000;

export const cloudAvailable = () => Boolean(CLOUD_FEATURES_ENABLED && API_BASE && APP_BASE);

// What a free or signed-out user still gets, so an agent never leaves them
// thinking recording itself is broken.
const STILL_WORKS =
  "Recording still works on every plan: the video is saved on this computer and opens in Recordful's editor.";

export const notSignedInError = () =>
  new AgentBridgeError(
    AgentErrorCode.NotSignedIn,
    `Recordful isn't signed in, and uploads and transcripts need a Recordful Pro account. ${STILL_WORKS} To upload or transcribe, the user signs in from Recordful's popup.`,
    { plan: "signed-out", signInUrl: `${APP_BASE}/login`, upgradeUrl: `${APP_BASE}/upgrade` },
  );

export const proRequiredError = () =>
  new AgentBridgeError(
    AgentErrorCode.ProRequired,
    `Uploads, cloud videos and transcripts are Recordful Pro features, and this account is on the free plan. ${STILL_WORKS} The user can upgrade at ${APP_BASE}/upgrade.`,
    { plan: "free", upgradeUrl: `${APP_BASE}/upgrade` },
  );

// "pro", "free", "signed-out", or "unavailable" (a build without cloud features).
export const planOf = (account) =>
  !account?.cloud ? "unavailable" : !account.signedIn ? "signed-out" : account.pro ? "pro" : "free";

export const videoLinks = (videoId) => ({
  viewUrl: `${APP_BASE}/view/${videoId}`,
  editUrl: `${APP_BASE}/editor/${videoId}/edit`,
});

const requireCloud = () => {
  if (!cloudAvailable()) {
    throw new AgentBridgeError(
      AgentErrorCode.CloudUnavailable,
      "This build of Recordful has no cloud features, so it can't upload or transcribe. Install Recordful from the Chrome Web Store.",
    );
  }
};

// Server answers → what the agent should tell the user.
const errorFor = (status, body) => {
  const code = body?.error;
  if (status === 401) return notSignedInError();
  if (code === "out_of_credits") {
    return new AgentBridgeError(
      AgentErrorCode.OutOfCredits,
      "The user's workspace has no AI credits left this month; they renew on the date given.",
      { renewsAt: body?.renewsAt ?? null },
    );
  }
  if (status === 402 || code === "pro_required") return proRequiredError();
  if (status === 403) {
    return new AgentBridgeError(
      AgentErrorCode.Forbidden,
      "Only the person who recorded it, or the workspace owner, can do that.",
    );
  }
  if (status === 404) {
    return new AgentBridgeError(AgentErrorCode.VideoNotFound, "Not found in this Recordful account (a video, folder or comment that doesn't exist, or isn't visible to this user).");
  }
  if (status === 413 || code === "storage_full") {
    return new AgentBridgeError(
      AgentErrorCode.StorageFull,
      "The user's Recordful storage is full. They can free space at recordful.app.",
    );
  }
  if (status === 409 && code === "not_uploaded") {
    return new AgentBridgeError(
      AgentErrorCode.NotUploaded,
      "The video hasn't finished uploading yet. Wait for it (get_video with wait), then retry.",
    );
  }
  if (status === 429) {
    return new AgentBridgeError(AgentErrorCode.RateLimited, "Too many requests to recordful.app; try again in a few minutes.");
  }
  if (status === 503 && code === "transcription_unavailable") {
    return new AgentBridgeError(
      AgentErrorCode.TranscriptionUnavailable,
      "Transcription is unavailable on recordful.app right now; try again later.",
    );
  }
  return new AgentBridgeError(
    AgentErrorCode.CloudError,
    `recordful.app answered ${status}${code ? ` (${code})` : ""}.`,
    { status, error: code ?? null },
  );
};

const getToken = async () => {
  const { recordfulToken } = await chrome.storage.local.get(["recordfulToken"]);
  return recordfulToken || null;
};

// One request to recordful.app with the user's session. A 401 gets one silent
// retry after the extension refreshes its session (the same refresh the
// recorder uses).
const send = async (url, { method = "GET", headers, body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) => {
  const sendWith = async (token) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method,
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      throw new AgentBridgeError(
        AgentErrorCode.CloudUnreachable,
        `Couldn't reach recordful.app (${err?.name === "AbortError" ? "timed out" : err?.message || err}).`,
      );
    } finally {
      clearTimeout(timer);
    }
  };

  const token = await getToken();
  if (!token) throw notSignedInError();
  const res = await sendWith(token);
  if (res.status !== 401) return res;
  await loginWithWebsite({ force: true }).catch(() => null);
  const fresh = await getToken();
  return fresh && fresh !== token ? sendWith(fresh) : res;
};

// One call to recordful.app's JSON API.
export const api = async (path, { method = "GET", body, query } = {}) => {
  requireCloud();
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const res = await send(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {}
  if (!res.ok) throw errorFor(res.status, parsed);
  return parsed ?? {};
};

// Hosted edits (silences, captions) can take a while; recordful-mcp waits 100 s.
const MCP_TIMEOUT_MS = 100000;

// cloud.mcp: one JSON-RPC message to the hosted MCP server (recordful.app/mcp)
// as the signed-in user, for recordful-mcp's proxy, so the session token
// never leaves the extension. Tool errors come back inside a 200, untouched.
export const mcp = async ({ message } = {}) => {
  if (!message || typeof message !== "object") {
    throw new AgentBridgeError(AgentErrorCode.InvalidParams, "message must be a JSON-RPC message");
  }
  requireCloud();
  const res = await send(`${APP_BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(message),
    timeoutMs: MCP_TIMEOUT_MS,
  });
  if (res.status === 401) throw notSignedInError();
  // A notification is accepted with no answer.
  if (res.status === 202) return null;
  const text = await res.text();
  if (!res.ok) {
    let reason = null;
    try {
      reason = JSON.parse(text)?.error?.message ?? null;
    } catch {}
    throw new AgentBridgeError(AgentErrorCode.CloudError, `recordful.app answered ${res.status}${reason ? `: ${reason}` : ""}.`, { status: res.status });
  }
  // A streamed answer carries the response as its last data line.
  const data = res.headers.get("content-type")?.includes("text/event-stream")
    ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).pop()?.slice(5)
    : text;
  return JSON.parse(data);
};

// Who the agent is acting for: signed in at all, and on Pro.
export const accountStatus = async () => {
  if (!cloudAvailable()) return { cloud: false, signedIn: false, pro: false, plan: "unavailable" };
  const auth = await loginWithWebsite({ force: false }).catch(() => null);
  const account = {
    cloud: true,
    signedIn: Boolean(auth?.authenticated),
    pro: Boolean(auth?.authenticated && auth?.subscribed),
    email: auth?.user?.email ?? null,
    site: APP_BASE,
  };
  return {
    ...account,
    plan: planOf(account),
    // Spelled out so an agent tells the user what they get, not just "no".
    features: account.pro
      ? "Recording, page tools, uploads, cloud videos and transcripts."
      : "Recording, page tools and Recordful's editor. Uploads, cloud videos and transcripts need Recordful Pro.",
  };
};

// One file of a recording, sent to storage in parts through signed URLs, the
// way the website's editor does it (recordful-ee lib/upload-recording.ts).
const PART_SIZE = 5 * 1024 * 1024;
const SIGN_BATCH = 10;
const PART_TIMEOUT_MS = 120000;

export const uploadMedia = async (videoId, blob, type, onBytes) => {
  const { mediaId } = await api("/uploads", {
    method: "POST",
    body: { projectId: videoId, type, contentType: blob.type.split(";")[0] || "video/webm" },
  });
  const partCount = Math.max(Math.ceil(blob.size / PART_SIZE), 1);
  let urls = {};
  for (let part = 1; part <= partCount; part += 1) {
    if (!urls[part]) {
      const partNumbers = Array.from(
        { length: Math.min(SIGN_BATCH, partCount - part + 1) },
        (_, i) => part + i,
      );
      ({ urls } = await api(`/uploads/${mediaId}/parts`, { method: "POST", body: { partNumbers } }));
    }
    const chunk = blob.slice((part - 1) * PART_SIZE, part * PART_SIZE);
    let lastError = null;
    // A part is retried twice: a flaky connection shouldn't fail a long upload.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PART_TIMEOUT_MS);
      try {
        const res = await fetch(urls[part], { method: "PUT", body: chunk, signal: controller.signal });
        if (res.ok) {
          lastError = null;
          break;
        }
        lastError = new Error(`storage answered ${res.status}`);
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    if (lastError) {
      throw new AgentBridgeError(
        AgentErrorCode.UploadFailed,
        `Upload failed on part ${part} of ${partCount}: ${lastError.message || lastError}`,
      );
    }
    onBytes?.(chunk.size);
  }
  await api(`/uploads/${mediaId}/complete`, { method: "POST", body: { size: blob.size } });
  return mediaId;
};
