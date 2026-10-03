import React, {
  useState,
  useEffect,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";
import * as Tabs from "@radix-ui/react-tabs";

import { Camera, House, VideoCamera } from "@phosphor-icons/react";

import { Rnd } from "react-rnd";

import { CloseIconPopup, HelpIconPopup } from "../toolbar/components/SVG";

import RecordingTab from "./layout/RecordingTab";
import VideosTab from "./layout/VideosTab";
import TooltipWrap from "./components/TooltipWrap";
import InactiveSubscription from "./layout/InactiveSubscription";
import LoggedOut from "./layout/LoggedOut";
import Welcome from "./layout/Welcome";
import {
  runProPopupOnboardingIfNeeded,
  runProCameraOnboardingIfNeeded,
} from "./onboarding/proOnboarding";

import { contentStateContext } from "../context/ContentState";
import { supportContextQuery } from "../../utils/buildSupportContext";

const PopupContainer = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const contentStateRef = useRef(contentState);
  const [tab, setTab] = useState("record");
  const DragRef = useRef(null);
  const PopupRef = useRef(null);
  const [elastic, setElastic] = React.useState("");
  const [shake, setShake] = React.useState("");
  const [dragging, setDragging] = React.useState("");
  const [onboarding, setOnboarding] = useState(false);
  const [showProSplash, setShowProSplash] = useState(false);
  const homeTabRef = useRef(null);
  const recordTabRef = useRef(null);
  const pillRef = useRef(null);
  const [URL, setURL] = useState("https://help.recordful.app/");
  const isCloudBuild = process.env.RECORDFUL_ENABLE_CLOUD_FEATURES === "true";
  const wasCameraActiveRef = useRef(null);

  useEffect(() => {
    chrome.storage.local.get(["onboarding", "showProSplash"], (result) => {
      const nextOnboarding = Boolean(result.onboarding);
      const nextShowProSplash = Boolean(result.showProSplash);
      setOnboarding(nextOnboarding);
      setShowProSplash(nextShowProSplash);
      setContentState((prevContentState) => ({
        ...prevContentState,
        onboarding: nextOnboarding,
        showProSplash: nextShowProSplash,
      }));
    });
  }, []);

  useEffect(() => {
    if (contentState.isLoggedIn) {
      setOnboarding(false);
      setShowProSplash(false);
      return;
    }
    setOnboarding(Boolean(contentState.onboarding));
    setShowProSplash(Boolean(contentState.showProSplash));
  }, [
    contentState.isLoggedIn,
    contentState.onboarding,
    contentState.showProSplash,
  ]);

  useEffect(() => {
    const buildURL = async () => {
      let baseURL = "https://help.recordful.app/";

      if (contentState?.isLoggedIn && contentState?.recordfulUser) {
        const { name, email } = contentState.recordfulUser;
        const qs = await supportContextQuery({
          includeRecordingState: true,
          source: "popup",
          user: { name, email },
        });
        baseURL = `https://tally.so/r/q406A9?extension=true&${qs}`;
      }

      setURL(baseURL);
    };
    buildURL();
  }, [contentState]);

  const onValueChange = (tab) => {
    setTab(tab);

    setContentState((prevContentState) => ({
      ...prevContentState,
      bigTab: tab,
    }));
  };
  useEffect(() => {
    setTab(contentState.bigTab);
  }, []);

  const previewWelcome = (() => {
    try {
      return (
        new URLSearchParams(window.location.search).get("previewWelcome") ===
        "1"
      );
    } catch {
      return false;
    }
  })();

  const showWelcomeSplash = Boolean(
    (isCloudBuild &&
      // Strict === false (not just falsy) so the splash stays hidden while the
      // auth check is still in flight. Otherwise a reinstalled user who gets
      // silently re-logged-in via their website cookie would briefly flash the
      // paid welcome screen before isLoggedIn resolves to true.
      contentState.isLoggedIn === false &&
      !contentState.wasLoggedIn &&
      (
        onboarding ||
        showProSplash ||
        contentState.onboarding ||
        contentState.showProSplash
      )) ||
    (isCloudBuild && previewWelcome),
  );

  useLayoutEffect(() => {
    if (!homeTabRef.current || !recordTabRef.current || !pillRef.current)
      return;

    const tabRef =
      tab === "record" ? recordTabRef.current : homeTabRef.current;

    pillRef.current.style.left = `${tabRef.offsetLeft}px`;
    pillRef.current.style.width = `${tabRef.getBoundingClientRect().width}px`;
  }, [tab]);

  useEffect(() => {
    contentStateRef.current = contentState;
  }, [contentState]);

  useLayoutEffect(() => {
    function setPopupPosition(e) {
      let xpos = DragRef.current.getDraggablePosition().x;
      let ypos = DragRef.current.getDraggablePosition().y;

      const rect = PopupRef.current.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      // Keep popup positioned proportionally to bottom-right.
      if (xpos > window.innerWidth + 10) {
        xpos = window.innerWidth + 10;
      }
      if (ypos + height + 40 > window.innerHeight) {
        ypos = window.innerHeight - height - 40;
      }

      if (contentStateRef.current.popupPosition.fixed) {
        if (xpos < window.innerWidth) {
          xpos = window.innerWidth + 10;
        }
      }

      DragRef.current.updatePosition({ x: xpos, y: ypos });
    }
    window.addEventListener("resize", setPopupPosition);
    setPopupPosition();
    return () => window.removeEventListener("resize", setPopupPosition);
  }, []);

  const handleDragStart = (e, d) => {
    setDragging("ToolbarDragging");
  };

  const handleDrag = (e, d) => {
    // Drag fires ~60Hz; cache rect to avoid 120 reflows/sec.
    const rect = PopupRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (
      d.x - 40 < width ||
      d.x > window.innerWidth + 10 ||
      d.y < 0 ||
      d.y + height + 40 > window.innerHeight
    ) {
      setShake("ToolbarShake");
    } else {
      setShake("");
    }
  };

  const handleDrop = (e, d) => {
    let anim = "ToolbarElastic";
    if (e === null) {
      anim = "";
    }
    setShake("");
    setDragging("");
    let xpos = d.x;
    let ypos = d.y;

    const rect = PopupRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (d.x - 40 < width) {
      setElastic(anim);
      xpos = width + 40;
    } else if (d.x + 10 > window.innerWidth) {
      setElastic(anim);
      xpos = window.innerWidth + 10;
    }

    if (d.y < 0) {
      setElastic(anim);
      ypos = 0;
    } else if (d.y + height + 40 > window.innerHeight) {
      setElastic(anim);
      ypos = window.innerHeight - height - 40;
    }
    DragRef.current.updatePosition({ x: xpos, y: ypos });

    setTimeout(() => {
      setElastic("");
    }, 250);

    setContentState((prevContentState) => ({
      ...prevContentState,
      popupPosition: {
        ...prevContentState.popupPosition,
        offsetX: xpos,
        offsetY: ypos,
        left: xpos < window.innerWidth / 2 ? true : false,
        right: xpos < window.innerWidth / 2 ? false : true,
        top: ypos < window.innerHeight / 2 ? true : false,
        bottom: ypos < window.innerHeight / 2 ? false : true,
      },
    }));

    let left = xpos < window.innerWidth / 2 ? true : false;
    let right = xpos < window.innerWidth / 2 ? false : true;
    let top = ypos < window.innerHeight / 2 ? true : false;
    let bottom = ypos < window.innerHeight / 2 ? false : true;
    let offsetX = xpos;
    let offsetY = ypos;
    let fixed = d.x + 9 > window.innerWidth ? true : false;

    if (right) {
      offsetX = window.innerWidth - xpos;
    }
    if (bottom) {
      offsetY = window.innerHeight - ypos;
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      popupPosition: {
        ...prevContentState.popupPosition,
        offsetX: offsetX,
        offsetY: offsetY,
        left: left,
        right: right,
        top: top,
        bottom: bottom,
        fixed: fixed,
      },
    }));

    chrome.storage.local.set({
      popupPosition: {
        offsetX: offsetX,
        offsetY: offsetY,
        left: left,
        right: right,
        top: top,
        bottom: bottom,
        fixed: fixed,
      },
    });
  };

  useEffect(() => {
    let x = contentState.popupPosition.offsetX;
    let y = contentState.popupPosition.offsetY;

    if (contentState.popupPosition.bottom) {
      y = window.innerHeight - contentState.popupPosition.offsetY;
    }

    if (contentState.popupPosition.right) {
      x = window.innerWidth - contentState.popupPosition.offsetX;
    }

    DragRef.current.updatePosition({ x: x, y: y });

    handleDrop(null, { x: x, y: y });
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      const tabRef =
        contentState.bigTab === "record"
          ? recordTabRef.current
          : homeTabRef.current;

      if (tabRef && pillRef.current) {
        pillRef.current.style.left = `${tabRef.offsetLeft}px`;
        pillRef.current.style.width = `${tabRef.getBoundingClientRect().width
          }px`;
      }
    });
  }, [
    contentState.isLoggedIn,
    contentState.bigTab,
    contentState.wasLoggedIn,
    pillRef.current,
  ]);

  useEffect(() => {
    const isPro = Boolean(contentState.isLoggedIn && contentState.isSubscribed);
    if (!isCloudBuild || !isPro) return;
    runProPopupOnboardingIfNeeded({
      rootContext: props.shadowRef?.current?.shadowRoot || document,
      isPro,
      isLoggedIn: Boolean(contentState.isLoggedIn),
      popupOpen: Boolean(contentState.showPopup && contentState.showExtension),
      cameraEnabled: Boolean(contentState.cameraActive),
      pendingRecording: Boolean(contentState.pendingRecording),
      preparingRecording: Boolean(contentState.preparingRecording),
      recording: Boolean(contentState.recording),
      countdownActive: Boolean(contentState.countdownActive),
      isCountdownVisible: Boolean(contentState.isCountdownVisible),
    });
  }, [
    isCloudBuild,
    contentState.isLoggedIn,
    contentState.isSubscribed,
    contentState.showPopup,
    contentState.showExtension,
    contentState.recordingToScene,
    contentState.cameraActive,
    contentState.pendingRecording,
    contentState.preparingRecording,
    contentState.recording,
    contentState.countdownActive,
    contentState.isCountdownVisible,
    props.shadowRef,
  ]);

  useEffect(() => {
    const isPro = Boolean(contentState.isLoggedIn && contentState.isSubscribed);
    const cameraEnabled = Boolean(contentState.cameraActive);
    if (wasCameraActiveRef.current === null) {
      wasCameraActiveRef.current = cameraEnabled;
      return;
    }
    const becameEnabled = cameraEnabled && !wasCameraActiveRef.current;
    wasCameraActiveRef.current = cameraEnabled;
    if (!becameEnabled || !isCloudBuild || !isPro) return;
    runProCameraOnboardingIfNeeded({
      rootContext: props.shadowRef?.current?.shadowRoot || document,
      isPro,
      isLoggedIn: Boolean(contentState.isLoggedIn),
      popupOpen: Boolean(contentState.showPopup && contentState.showExtension),
      cameraEnabled,
      pendingRecording: Boolean(contentState.pendingRecording),
      preparingRecording: Boolean(contentState.preparingRecording),
      recording: Boolean(contentState.recording),
      countdownActive: Boolean(contentState.countdownActive),
      isCountdownVisible: Boolean(contentState.isCountdownVisible),
    });
  }, [
    isCloudBuild,
    contentState.cameraActive,
    contentState.isLoggedIn,
    contentState.isSubscribed,
    contentState.showPopup,
    contentState.showExtension,
    contentState.pendingRecording,
    contentState.preparingRecording,
    contentState.recording,
    contentState.countdownActive,
    contentState.isCountdownVisible,
    props.shadowRef,
  ]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100vh",
      }}
    >
      <div className={"ToolbarBounds" + " " + shake}></div>
      <Rnd
        default={{
          x: contentState.popupPosition.offsetX,
          y: contentState.popupPosition.offsetY,
        }}
        className={
          "react-draggable" + " " + elastic + " " + shake + " " + dragging
        }
        enableResizing={false}
        dragHandleClassName="drag-area"
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDrop}
        ref={DragRef}
      >
        <div
          className="popup-container"
          id="pro-onboarding-popup-container"
          ref={PopupRef}
        >
          <div className="popup-drag-head drag-area"></div>
          <div className="popup-controls drag-area">
            <div
              className="popup-control popup-close"
              onClick={() => {
                setContentState((prevContentState) => ({
                  ...prevContentState,
                  showExtension: false,
                }));
              }}
            >
              <CloseIconPopup />
            </div>
          </div>
          <div className="popup-nav"></div>
          <div className="popup-content">
            {showWelcomeSplash ? (
              <Welcome
                setOnboarding={() => {
                  setOnboarding(false);
                  setShowProSplash(false);
                  chrome.storage.local.set({
                    onboarding: false,
                    showProSplash: false,
                    firstTimePro: false,
                  });
                  setContentState((prev) => ({
                    ...prev,
                    onboarding: false,
                    showProSplash: false,
                  }));
                }}
                isBack={showProSplash}
                clearBack={() => {
                  setShowProSplash(false);
                  setContentState((prev) => ({
                    ...prev,
                    showProSplash: false,
                  }));
                  chrome.storage.local.set({ showProSplash: false });
                }}
                setContentState={setContentState}
              />
            ) : isCloudBuild &&
              contentState.isSubscribed === false &&
              contentState.isLoggedIn === true ? (
              <InactiveSubscription
                subscription={contentState.proSubscription}
                hasSubscribedBefore={contentState.hasSubscribedBefore}
                onManageClick={() => {
                  const type = contentState.hasSubscribedBefore
                    ? "handle-reactivate"
                    : "handle-upgrade";
                  chrome.runtime.sendMessage({ type });
                }}
                onDowngradeClick={async () => {
                  chrome.runtime.sendMessage({ type: "handle-logout" });
                  setContentState((prev) => ({
                    ...prev,
                    isLoggedIn: false,
                    isSubscribed: false,
                    recordfulUser: null,
                    proSubscription: null,
                    wasLoggedIn: false,
                    bigTab: "record",
                  }));
                  contentState.openToast(
                    chrome.i18n.getMessage("loggedOutToastTitle"),
                    () => { },
                    2000
                  );
                }}
              />
            ) : isCloudBuild &&
              !contentState.isLoggedIn &&
              contentState.wasLoggedIn ? (
              <LoggedOut
                onManageClick={() => {
                  chrome.runtime.sendMessage({ type: "handle-login" });
                }}
                onDowngradeClick={() => {
                  chrome.storage.local.set({
                    wasLoggedIn: false,
                    stayLoggedOut: true,
                  });
                  setContentState((prev) => ({
                    ...prev,
                    isLoggedIn: false,
                    wasLoggedIn: false,
                    bigTab: "record",
                  }));
                  setTab("record");

                  requestAnimationFrame(() => {
                    if (recordTabRef.current && pillRef.current) {
                      const tabRef = recordTabRef.current;
                      pillRef.current.style.left = `${tabRef.offsetLeft}px`;
                      pillRef.current.style.width = `${tabRef.getBoundingClientRect().width
                        }px`;
                    }
                  });
                }}
              />
            ) : (
              <Tabs.Root
                className="TabsRoot tl"
                value={tab}
                onValueChange={onValueChange}
              >
                <Tabs.List
                  className="TabsList tl icon-tabs"
                  data-value={tab}
                  aria-label="Manage your account"
                  tabIndex={0}
                >
                  <div className="pill-anim" ref={pillRef}></div>
                  <TooltipWrap
                    name="icon-tab-wrap"
                    content={chrome.i18n.getMessage("videosTab")}
                    side="bottom"
                  >
                    <Tabs.Trigger
                      className="TabsTrigger tl icon-tab"
                      value="dashboard"
                      ref={homeTabRef}
                      tabIndex={0}
                      aria-label={chrome.i18n.getMessage("videosTab")}
                    >
                      <House size={18} />
                    </Tabs.Trigger>
                  </TooltipWrap>
                  <TooltipWrap
                    name="icon-tab-wrap"
                    content={chrome.i18n.getMessage("recordTab")}
                    side="bottom"
                  >
                    <Tabs.Trigger
                      className="TabsTrigger tl icon-tab"
                      value="record"
                      ref={recordTabRef}
                      tabIndex={0}
                      aria-label={chrome.i18n.getMessage("recordTab")}
                    >
                      <VideoCamera size={18} />
                    </Tabs.Trigger>
                  </TooltipWrap>
                  <TooltipWrap
                    name="icon-tab-wrap"
                    content={
                      chrome.i18n.getMessage("screenshotComingSoon") ||
                      "Screenshot (coming soon)"
                    }
                    side="bottom"
                  >
                    <span className="icon-tab-disabled">
                      <Tabs.Trigger
                        className="TabsTrigger tl icon-tab"
                        value="screenshot"
                        tabIndex={0}
                        disabled
                        aria-label={
                          chrome.i18n.getMessage("screenshotComingSoon") ||
                          "Screenshot (coming soon)"
                        }
                      >
                        <Camera size={18} />
                      </Tabs.Trigger>
                    </span>
                  </TooltipWrap>
                </Tabs.List>
                <Tabs.Content className="TabsContent tl" value="record">
                  <RecordingTab shadowRef={props.shadowRef} />
                </Tabs.Content>
                <Tabs.Content className="TabsContent tl" value="dashboard">
                  <VideosTab shadowRef={props.shadowRef} />
                </Tabs.Content>
              </Tabs.Root>
            )}
          </div>
          {contentState.settingsOpen && (
            <div
              className="HelpSection"
              onClick={() => {
                window.open(URL, "_blank");
              }}
            >
              <span className="HelpIcon">
                <HelpIconPopup />
              </span>
              {chrome.i18n.getMessage("helpPopup")}
            </div>
          )}
        </div>
      </Rnd>
    </div>
  );
};

export default PopupContainer;
