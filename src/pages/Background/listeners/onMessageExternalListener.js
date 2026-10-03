import {
  getCurrentTab,
  sendMessageTab,
  parseEditorTargetUrl,
  setEditorTabReference,
  clearEditorTabReference,
} from "../tabManagement";
import { loginWithWebsite } from "../auth/loginWithWebsite";
import { handleFinishMultiRecording } from "../messaging/handlers";

const CLOUD_FEATURES_ENABLED =
  process.env.RECORDFUL_ENABLE_CLOUD_FEATURES === "true";

export const onMessageExternalListener = () => {
  if (!CLOUD_FEATURES_ENABLED) return;

  chrome.runtime.onMessageExternal.addListener(
    async (message, sender, sendResponse) => {
      if (message.type === "AUTH_SUCCESS" && message.token) {
        const { stayLoggedOut } = await chrome.storage.local.get([
          "stayLoggedOut",
        ]);
        if (stayLoggedOut) return true;

        await chrome.storage.local.set({
          recordfulToken: message.token,
          recordfulUser: null,
          proSubscription: null,
          lastAuthCheck: 0,
          wasLoggedIn: true,
          isLoggedIn: false,
          pushToTalk: false,
          onboarding: false,
          showProSplash: false,
        });
        // otherwise the drain listener clobbers this fresh token on next recording-end
        await chrome.storage.local.remove([
          "logoutPendingTokenClear",
          "loginPendingAt",
          "loginTabId",
        ]);

        // loginWithWebsite() consumes and clears originalTabId, so read it first
        // or the close below is unreachable and every login leaks its tab.
        const { originalTabId: loginOpenedFromTabId } =
          await chrome.storage.local.get("originalTabId");

        const auth = await loginWithWebsite();

        if (!auth?.authenticated) {
          console.warn(
            "[Recordful][Auth] AUTH_SUCCESS token did not verify, staying logged out",
          );
          await chrome.storage.local.set({
            isLoggedIn: false,
          });
          return true;
        }

        await chrome.storage.local.set({
          isLoggedIn: true,
          wasLoggedIn: false,
          stayLoggedOut: false,
          recordfulUser: auth.user,
          isSubscribed: auth.subscribed,
          proSubscription: auth.proSubscription,
          hasSubscribedBefore: auth.hasSubscribedBefore,
          lastAuthCheck: Date.now(),
        });

        // loginWithWebsite does the refocus, but only this scope knows the
        // sender, so the close lives here. Gated so a hand-opened /login stays put.
        if (loginOpenedFromTabId && sender.tab?.id) {
          try {
            await chrome.tabs.remove(sender.tab.id);
          } catch {}
        }

        return true;
      } else if (message.type === "SIGN_OUT") {
        await chrome.storage.local.remove([
          "recordfulToken",
          "recordfulUser",
          "lastAuthCheck",
          "isSubscribed",
          "isLoggedIn",
          "proSubscription",
          "hasSubscribedBefore",
        ]);

        return true;
      } else if (message.type === "OPEN_POPUP_PROJECT") {
        try {
          const tab = await getCurrentTab();
          if (!tab?.id) {
            console.warn("No active tab found for popup reopen");
            return;
          }

          await chrome.storage.local.set({
            recordingProjectTitle: message.recordingProjectTitle,
            recordingToScene: true,
            instantMode: false,
            projectId: message.projectId,
            activeSceneId: message.activeSceneId,
          });

          const parsedTarget = parseEditorTargetUrl(tab.url);
          if (parsedTarget?.projectId === message.projectId) {
            await setEditorTabReference({
              tabId: tab.id,
              tabUrl: tab.url,
              source: "webapp-open-popup-project",
              expectedProjectId: message.projectId,
            });
          } else {
            await clearEditorTabReference("webapp-open-popup-project-not-editor", {
              tabId: tab.id,
              tabUrl: tab.url,
              expectedProjectId: message.projectId,
            });
          }

          const result = await loginWithWebsite({ force: true });

          if (!result?.authenticated) {
            const currentTab = await getCurrentTab();
            if (currentTab?.id) {
              await chrome.storage.local.set({ originalTabId: currentTab.id });
            }

            chrome.tabs.create({
              url: `${process.env.RECORDFUL_APP_BASE}/login?extension=true`,
              active: true,
            });
            return;
          }

          await sendMessageTab(tab.id, {
            type: "open-popup-project",
            projectTitle: message.recordingProjectTitle,
            projectId: message.projectId,
            activeSceneId: message.activeSceneId,
            recordingToScene: true,
          });
        } catch (err) {
          console.warn("Failed to send popup project message:", err);
        }
      } else if (message.type === "GET_PROJECT_INFO") {
        const tab = await getCurrentTab();
        if (!tab?.id) {
          console.warn("No active tab found for popup reopen");
          return;
        }

        await chrome.storage.local.set({
          recordingProjectTitle: message.recordingProjectTitle,
          recordingToScene: true,
          instantMode: false,
          projectId: message.projectId,
          activeSceneId: message.activeSceneId,
        });

        await sendMessageTab(tab.id, {
          type: "open-popup-project",
          projectTitle: message.recordingProjectTitle,
          projectId: message.projectId,
          activeSceneId: message.activeSceneId,
          recordingToScene: true,
        });
      } else if (message.type === "PING_FROM_WEBAPP") {
        sendResponse({ success: true, message: "pong" });

        return true;
      } else if (message.type === "FINISH_MULTI_RECORDING") {
        // Same logic as clicking the popup's Finish button. Used by
        // web-app "I'm done adding scenes" flows and by e2e tests where
        // we can't drive the popup UI directly.
        await handleFinishMultiRecording();
        sendResponse({ success: true });
        return true;
      }
    }
  );
};
