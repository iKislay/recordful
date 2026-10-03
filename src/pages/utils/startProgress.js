// Stage heartbeat for the BG start-fail re-check. Startup outlasts one window
// on a slow encoder probe, and the background reads that silence as a dead
// recorder and tears the start down.
export function markStartProgress(stage) {
  try {
    chrome.storage.local.set({
      recorderStartProgress: { ts: Date.now(), stage },
    });
  } catch {}
}
