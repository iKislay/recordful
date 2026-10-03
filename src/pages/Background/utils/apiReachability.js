// Lets the popup say what's actually wrong instead of blaming the connection.
// ok = reachable, offline = browser says no network, server = 5xx (our end),
// unreachable = nothing came back, cause unknown from here.

export const API_REACHABILITY_KEY = "apiReachability";

export const setApiReachability = async (state) => {
  try {
    // Written even when unchanged: `at` is the popup's freshness clock, so
    // skipping the repeat let the banner go stale and hide mid-outage.
    await chrome.storage.local.set({
      [API_REACHABILITY_KEY]: { state, at: Date.now() },
    });
  } catch (err) {
    console.warn("Failed to record API reachability:", err);
  }
  return state;
};

// 4xx means the server is up and talking to us. Only 5xx is our end down.
export const noteApiResponse = (res) =>
  setApiReachability(res && res.status >= 500 ? "server" : "ok");

export const noteApiError = (err) => {
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) return setApiReachability("offline");
  // fetch TypeError, abort and timeout are indistinguishable from here:
  // nothing came back and we can't tell whose end broke.
  const networkish =
    err instanceof TypeError ||
    err?.name === "AbortError" ||
    err?.name === "TimeoutError";
  return setApiReachability(networkish ? "unreachable" : "server");
};
