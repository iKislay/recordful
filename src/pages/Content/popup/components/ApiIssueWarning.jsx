import React, { useContext, useEffect, useRef, useState } from "react";

import { contentStateContext } from "../../context/ContentState";
import { apiIssueCopy } from "../../utils/apiIssueCopy";
import { NoInternet } from "../../toolbar/components/SVG";

const CLOUD_FEATURES_ENABLED =
  process.env.RECORDFUL_ENABLE_CLOUD_FEATURES === "true";

// Backs off so a long outage doesn't hammer the API, still recovers within
// seconds of the server coming back.
const RECHECK_DELAYS_MS = [5000, 10000, 20000, 30000];

// A verdict older than this proves nothing about right now, so the banner waits
// for a fresh check instead of reporting last night's outage.
const VERDICT_FRESH_MS = 60000;

const ApiIssueWarning = () => {
  const [contentState] = useContext(contentStateContext);
  const [checking, setChecking] = useState(false);
  const attemptsRef = useRef(0);

  const state = contentState.apiReachability;
  const at = contentState.apiReachabilityAt;
  const failing =
    // Free recording never touches the API, so this is only ever a Pro problem.
    CLOUD_FEATURES_ENABLED &&
    contentState.isLoggedIn &&
    contentState.isSubscribed &&
    state &&
    state !== "ok";
  // The browser's own offline flag needs no confirming. An API verdict does.
  const stale =
    failing &&
    state !== "offline" &&
    (!at || Date.now() - at > VERDICT_FRESH_MS);
  const blocking = failing && !stale;

  const runCheck = () =>
    new Promise((resolve) => {
      // The browser already knows it's offline, no point asking the network.
      if (navigator.onLine === false) {
        resolve();
        return;
      }
      setChecking(true);
      chrome.runtime.sendMessage({ type: "recheck-api-reachability" }, () => {
        // The verdict arrives as a storage change, this only clears the flag.
        if (chrome.runtime.lastError) {
          // The service worker was restarting. The next tick tries again.
        }
        setChecking(false);
        resolve();
      });
    });

  // Stale verdict: confirm it now rather than showing it. Nothing renders until
  // the answer lands, so a recovered API never gets accused on popup open.
  useEffect(() => {
    if (!stale) return;
    if (checking) return;
    runCheck();
  }, [stale]);

  useEffect(() => {
    if (!blocking) {
      attemptsRef.current = 0;
      return;
    }
    let cancelled = false;
    let timer = null;

    const schedule = () => {
      const delay =
        RECHECK_DELAYS_MS[
          Math.min(attemptsRef.current, RECHECK_DELAYS_MS.length - 1)
        ];
      timer = setTimeout(() => {
        attemptsRef.current += 1;
        runCheck().then(() => {
          if (!cancelled) schedule();
        });
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [blocking, state]);

  if (!blocking) return null;

  const copy = apiIssueCopy(state);
  if (!copy) return null;

  return (
    <div className="popup-warning">
      <div className="popup-warning-left">
        <NoInternet />
      </div>
      <div className="popup-warning-middle">
        <div className="popup-warning-title">{copy.title}</div>
        <div className="popup-warning-description">{copy.description}</div>
      </div>
      <div className="popup-warning-right">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (checking) return;
            attemptsRef.current = 0;
            runCheck();
          }}
        >
          {chrome.i18n.getMessage("offlineLabelTryAgain")}
        </a>
      </div>
    </div>
  );
};

export default ApiIssueWarning;
