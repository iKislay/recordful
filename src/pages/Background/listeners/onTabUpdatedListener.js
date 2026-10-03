import { sendMessageTab } from "../tabManagement";
import { diagEvent } from "../../utils/diagnosticLog";
import { loginWithWebsite } from "../auth/loginWithWebsite";

const CLOUD_FEATURES_ENABLED =
  process.env.RECORDFUL_ENABLE_CLOUD_FEATURES === "true";
const APP_BASE = process.env.RECORDFUL_APP_BASE;
// debounce in-tab triggers so navigation chatter doesn't hammer /auth/refresh
const APP_AUTH_REFRESH_DEBOUNCE_MS = 10_000;
// A login the user just started is worth polling harder, but /auth/refresh
// allows 5 per user per minute, so stay under that or the retries 429 us out.
const LOGIN_PENDING_DEBOUNCE_MS = 15_000;
const LOGIN_PENDING_TTL_MS = 15 * 60_000;
let lastAppAuthRefreshAt = 0;
const tryAppAuthRefresh = async (url) => {
  if (!CLOUD_FEATURES_ENABLED || !APP_BASE || !url) return;
  if (!url.startsWith(APP_BASE)) return;
  const now = Date.now();
  const {
    isLoggedIn,
    wasLoggedIn,
    hasSubscribedBefore,
    recordfulUser,
    stayLoggedOut,
    loginPendingAt,
    loginTabId,
  } = await chrome.storage.local.get([
    "isLoggedIn",
    "wasLoggedIn",
    "hasSubscribedBefore",
    "recordfulUser",
    "stayLoggedOut",
    "loginPendingAt",
    "loginTabId",
  ]);
  if (isLoggedIn) return;
  if (stayLoggedOut) return;
  const loginPending =
    Boolean(loginPendingAt) && now - loginPendingAt < LOGIN_PENDING_TTL_MS;
  if (loginPendingAt && !loginPending) {
    await chrome.storage.local.remove(["loginPendingAt", "loginTabId"]);
  }
  // Only refresh if there's prior evidence of an account, otherwise every
  // logged-out visitor hits /auth/refresh and 401s. Mirrors the priorSignals
  // gate in loginWithWebsite (force:true would bypass it).
  const hasPriorSignals =
    loginPending ||
    Boolean(wasLoggedIn) ||
    Boolean(hasSubscribedBefore) ||
    Boolean(recordfulUser);
  if (!hasPriorSignals) return;
  const debounceMs = loginPending
    ? LOGIN_PENDING_DEBOUNCE_MS
    : APP_AUTH_REFRESH_DEBOUNCE_MS;
  if (now - lastAppAuthRefreshAt < debounceMs) return;
  lastAppAuthRefreshAt = now;
  const result = await loginWithWebsite({ force: true }).catch(() => null);
  if (!result?.authenticated || !loginPending) return;
  // Cookie refresh got there without AUTH_SUCCESS. loginWithWebsite already
  // refocused the original tab, so all that's left is the login tab we opened.
  await chrome.storage.local.remove(["loginPendingAt", "loginTabId"]);
  if (loginTabId) {
    try {
      await chrome.tabs.remove(loginTabId);
    } catch {}
  }
};

export const handleTabUpdate = async (tabId, changeInfo, tab) => {
  try {
    // The app routes client-side, so a post-login redirect fires url without
    // ever reaching status complete.
    if (changeInfo.url) {
      tryAppAuthRefresh(changeInfo.url).catch(() => {});
    }
    if (changeInfo.status === "complete") {
      const {
        recording,
        paused,
        pausedAt,
        totalPausedMs,
        restarting,
        tabRecordedID,
        pendingRecording,
        recordingStartTime,
        recorderSession,
        customRegion,
        recordingType,
      } = await chrome.storage.local.get([
        "recording",
        "paused",
        "pausedAt",
        "totalPausedMs",
        "restarting",
        "tabRecordedID",
        "pendingRecording",
        "recordingStartTime",
        "recorderSession",
        "customRegion",
        "recordingType",
      ]);

      // Check both recording flag AND recorderSession to avoid race conditions
      // recorderSession persists even if the SW restarts
      const isActivelyRecording =
        recording ||
        (recorderSession && recorderSession.status === "recording");
      const isPendingOrRestarting = restarting || pendingRecording;

      if (!isActivelyRecording && !isPendingOrRestarting) {
        sendMessageTab(tabId, { type: "recording-ended" });
      } else if (isActivelyRecording) {
        if (tabRecordedID && tabRecordedID === tabId) {
          diagEvent("recorded-tab-navigated");
          sendMessageTab(tabId, {
            type: "recording-check",
            force: true,
            recordingStartTime,
          });
        } else if (tabRecordedID && tabRecordedID !== tabId) {
          sendMessageTab(tabId, { type: "hide-popup-recording" });
        }
      }

      if (recordingStartTime) {
        const now = Date.now();
        const basePaused = totalPausedMs || 0;
        const extraPaused =
          paused && pausedAt ? Math.max(0, now - pausedAt) : 0;

        const elapsed = Math.max(
          0,
          Math.floor(
            (now - recordingStartTime - basePaused - extraPaused) / 1000
          )
        );

        const { alarm } = await chrome.storage.local.get(["alarm"]);
        if (alarm) {
          const { alarmTime } = await chrome.storage.local.get(["alarmTime"]);
          const remaining = Math.max(0, Math.floor(alarmTime - elapsed));
          sendMessageTab(tabId, { type: "time", time: remaining });
        } else {
          sendMessageTab(tabId, { type: "time", time: elapsed });
        }
      }

      const commands = await chrome.commands.getAll();

      sendMessageTab(tabId, {
        type: "commands",
        commands: commands,
      });

      // Check if tab is playground.html
      if (
        tab.url.includes(chrome.runtime.getURL("playground.html")) &&
        changeInfo.status === "complete"
      ) {
        sendMessageTab(tab.id, { type: "toggle-popup" });
      }
      // if we look logged out, try a force refresh in case AUTH_SUCCESS was missed.
      tryAppAuthRefresh(tab.url).catch(() => {});
    }
  } catch (error) {
    console.error("Error in handleTabUpdate:", error.message);
  }
};

export const onTabUpdatedListener = () => {
  chrome.tabs.onUpdated.addListener(handleTabUpdate);
};
