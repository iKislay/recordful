// The cameras and microphones the extension itself may use. The popup asks
// from a frame inside the page, and a page whose Permissions-Policy blocks
// camera or microphone makes Chrome deny that frame, even though the
// extension is allowed in its own settings and records with them. So this
// asks from an offscreen copy of permissions.html, where no page has a say.
const DEVICES_URL = "permissions.html?offscreen=1";
// Long enough for the document to load and answer; a recorder that wants
// the one offscreen slot waits at most this long for it.
const PROBE_MS = 3000;
// The last answer, for when no document can be opened: before the optional
// offscreen permission is granted, or while a recording holds the slot.
const CACHE_KEY = "extensionMediaDevices";

let inFlight = null;

const isOurs = (context) =>
  typeof context?.documentUrl === "string" &&
  context.documentUrl.includes("permissions.html");

const offscreenNow = async () =>
  (
    await chrome.runtime
      .getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
      .catch(() => [])
  )[0] ?? null;

const answered = (answer) =>
  answer && typeof answer === "object" && typeof answer.success === "boolean";

async function probe() {
  if (typeof chrome.offscreen?.createDocument !== "function") {
    return { success: false, error: "offscreen-api-unavailable" };
  }
  const existing = await offscreenNow();
  // Chrome allows one offscreen document, and another (a recording, a
  // download) is never closed for this.
  if (existing && !isOurs(existing)) {
    return { success: false, error: "offscreen-busy" };
  }
  if (!existing) {
    try {
      await chrome.offscreen.createDocument({
        url: DEVICES_URL,
        reasons: ["USER_MEDIA"],
        justification:
          "List the cameras and microphones the extension may record from, which a website's policy hides from its in-page frame.",
      });
    } catch {
      return { success: false, error: "offscreen-busy" };
    }
  }
  try {
    const deadline = Date.now() + PROBE_MS;
    // The document listens only once its script has run.
    while (Date.now() < deadline) {
      const answer = await chrome.runtime
        .sendMessage({ type: "extension-media-devices-probe" })
        .catch(() => null);
      if (answered(answer)) return answer;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { success: false, error: "no-answer" };
  } finally {
    if (isOurs(await offscreenNow())) {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
  }
}

async function probeOrLast() {
  const answer = await probe().catch(() => ({
    success: false,
    error: "unknown",
  }));
  if (answer.success) {
    await chrome.storage.local.set({ [CACHE_KEY]: answer }).catch(() => {});
    return answer;
  }
  // Asked and refused is an answer; only a probe that could not run falls
  // back to the last one.
  if (answer.error === "NotAllowedError") {
    await chrome.storage.local.remove(CACHE_KEY).catch(() => {});
    return answer;
  }
  const { [CACHE_KEY]: last } = await chrome.storage.local
    .get(CACHE_KEY)
    .catch(() => ({}));
  return last?.success ? last : answer;
}

/** The extension's own devices: `{ success, videoinput, audioinput, ... }`. */
export const extensionMediaDevices = () => {
  inFlight ??= probeOrLast().finally(() => {
    inFlight = null;
  });
  return inFlight;
};

/**
 * Waits for a probe to finish and close its document. Whatever creates an
 * offscreen document awaits this first, or the probe's closing could close
 * the newcomer instead.
 */
export const settleMediaDevicesProbe = () =>
  inFlight ? inFlight.then(() => undefined) : Promise.resolve();
