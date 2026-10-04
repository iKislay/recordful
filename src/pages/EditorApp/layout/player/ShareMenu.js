import React, { useContext, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import styles from "../../styles/player/_Panel.module.scss";

import { buildDiagnosticZip } from "../../../utils/buildDiagnosticZip";
import { downloadResolvedRecording } from "../../recorderStorage/resolveRecordingFile";
import { stageBlobToOpfs } from "../../recorderStorage/stageBlobToOpfs";
import { diagForward } from "../../../utils/diagForward";
import { showEditorToast } from "../../utils/editorToast";

import {
  ArrowRight,
  DownloadSimple,
  Flag,
  Gif,
  GoogleDriveLogo,
  WarningCircle,
  WifiSlash,
} from "@phosphor-icons/react";

import { ContentStateContext } from "../../context/ContentState";
import { notAvailableLabel, preparingLabel } from "./tools";

// The Share button in the nav, with saving and exporting behind it. It also
// owns the status alerts (offline, still processing, an edit that failed),
// because they come from the same state; those are drawn into `alertsNode`,
// a slot above the video, rather than inside the menu where nobody would
// see them.
const ShareMenu = ({ alertsNode }) => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const contentStateRef = useRef(contentState);
  // `disabled` on a <div role="button"> is inert, so the click still fires
  // while a save is in flight. contentStateRef lags a render, so hold the
  // in-flight lock in its own ref and clear it when saveDrive goes false
  // (failWith, or the "saved-to-drive" message on success).
  const saveDriveInFlight = useRef(false);
  // The menu closes as soon as an option is chosen; the download or dialog it
  // started carries on behind it. A popover does not do that by itself.
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    contentStateRef.current = contentState;
  }, [contentState]);

  useEffect(() => {
    if (!contentState.saveDrive) saveDriveInFlight.current = false;
  }, [contentState.saveDrive]);

  // sendMessage rejects past ~64 MB, and base64 inflates ~1.33x, so a base64
  // Drive upload is unsafe above ~48 MB. The OPFS path has no such limit; this
  // only gates the fallback when OPFS staging is unavailable.
  const DRIVE_BASE64_MAX_BYTES = 48 * 1024 * 1024;

  const saveToDrive = async () => {
    if (saveDriveInFlight.current) return;
    saveDriveInFlight.current = true;
    setContentState((prevContentState) => ({
      ...prevContentState,
      saveDrive: true,
    }));

    // Modal rather than a toast: the editor is an extension page, and the
    // background's show-toast relay only reaches the content script of the
    // active tab, so a toast raised here is never seen by someone sitting in
    // the editor. A modal also carries the recovery action for each cause.
    const failWith = (errorCode) => {
      const code = errorCode || "drive-generic";
      diagForward("editor-drive-save-fail", { errorCode: code });
      const base =
        {
          "drive-quota": "driveQuota",
          "drive-too-large": "driveTooLarge",
          "drive-auth": "driveAuth",
        }[code] || "driveGeneric";

      const openModal = contentStateRef.current?.openModal;
      if (typeof openModal === "function") {
        // Quota is the one cause retrying can't clear, so it links out to
        // Drive storage instead. Too-large has no recovery from here.
        let buttonLabel = chrome.i18n.getMessage("offlineLabelTryAgain");
        let action = () => runSaveToDrive();
        if (code === "drive-quota") {
          buttonLabel = chrome.i18n.getMessage("manageStorageButtonLabel");
          action = () =>
            window.open("https://drive.google.com/settings/storage", "_blank");
        } else if (code === "drive-too-large") {
          buttonLabel = null;
          action = () => {};
        }
        openModal(
          chrome.i18n.getMessage(`${base}ModalTitle`),
          chrome.i18n.getMessage(`${base}ModalDescription`),
          buttonLabel,
          chrome.i18n.getMessage("closeModalLabel"),
          action,
          () => {},
        );
      }

      setContentState((prevContentState) => ({
        ...prevContentState,
        saveDrive: false,
        driveError: code,
      }));
    };

    const handleDriveResponse = (response) => {
      if (!response || response.status === "ew" || response.error) {
        console.error(
          "[Drive] drive_save_failed:",
          response?.error || "unknown error",
        );
        failWith(response?.errorCode);
      }
      // On success, saveDrive is reset by the "saved-to-drive" message.
    };
    const handleDriveError = (err) => {
      console.error("[Drive] drive_save_error:", err);
      failWith("drive-generic");
    };

    // Pick the source: the MP4 export when ready, else the duration-fixed webm.
    // With neither, the background rebuilds from IndexedDB chunks itself (no
    // base64 transfer), so route straight to the fallback.
    const useMp4 =
      !contentState.noffmpeg && contentState.mp4ready && contentState.blob;
    const source = useMp4 ? contentState.blob : contentState.webm;
    const isWebm = !useMp4;

    if (!(source instanceof Blob) || source.size === 0) {
      chrome.runtime
        .sendMessage({ type: "save-to-drive-fallback", title: contentState.title })
        .then(handleDriveResponse)
        .catch(handleDriveError);
      return;
    }

    diagForward("editor-drive-save-start", {
      bytes: source.size,
      isWebm,
      transport: "opfs",
    });

    // Preferred: stage into OPFS and send only the filename. Streams to disk,
    // so it's memory-safe at any size — this is the large-file fix.
    const opfsFileName = await stageBlobToOpfs(source, isWebm ? "webm" : "mp4");
    if (opfsFileName) {
      chrome.runtime
        .sendMessage({
          type: "save-to-drive",
          opfsFileName,
          isWebm,
          title: contentState.title,
        })
        .then(handleDriveResponse)
        .catch(handleDriveError);
      return;
    }

    // OPFS unavailable: fall back to base64, but only when small enough to
    // survive the message-size cap. Above it, tell the user instead of failing
    // silently the way this used to.
    if (source.size > DRIVE_BASE64_MAX_BYTES) {
      // Not a Drive limit: OPFS staging failed and the base64 fallback can't
      // carry this much over sendMessage. Drive would accept the file, so
      // don't tell the user it's too large for Drive; retrying can restage it.
      failWith("drive-generic");
      return;
    }
    diagForward("editor-drive-save-start", {
      bytes: source.size,
      isWebm,
      transport: "base64",
    });
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1];
      chrome.runtime
        .sendMessage({
          type: "save-to-drive",
          base64,
          title: contentState.title,
          isWebm,
        })
        .then(handleDriveResponse)
        .catch(handleDriveError);
    };
    reader.onerror = () => failWith("drive-generic");
    reader.readAsDataURL(source);
  };

  // Safety net: every failure path inside saveToDrive calls failWith, but an
  // unexpected throw would leave saveDrive stuck true and, now that the button
  // is genuinely gated, permanently dead.
  const runSaveToDrive = () => {
    saveToDrive().catch((err) => {
      console.error("[Drive] drive_save_unhandled:", err);
      saveDriveInFlight.current = false;
      setContentState((prevContentState) => ({
        ...prevContentState,
        saveDrive: false,
      }));
    });
  };

  const signOutDrive = () => {
    chrome.runtime.sendMessage({ type: "sign-out-drive" });
    setContentState((prevContentState) => ({
      ...prevContentState,
      driveEnabled: false,
    }));
  };

  // Best available blob: edited MP4 → fixed WebM → raw WebM.
  const handleDownloadOriginal = () => {
    const s = contentStateRef.current;
    const source = s.blob || s.webm || s.rawBlob;
    if (!source) return;
    const blob =
      source instanceof Blob
        ? source
        : new Blob([source], { type: "video/webm" });
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const rawTitle = s.title || "recordful-recording";
    const safe = rawTitle
      .replace(/[\\:*?"<>|]/g, " ")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "recordful-recording";
    const url = window.URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: `${safe}.${ext}` }, () => {
      window.URL.revokeObjectURL(url);
    });
  };

  const handleRawRecording = () => {
    if (typeof contentStateRef.current.openModal === "function") {
      contentStateRef.current.openModal(
        chrome.i18n.getMessage("rawRecordingModalTitle"),
        chrome.i18n.getMessage("rawRecordingModalDescription"),
        chrome.i18n.getMessage("rawRecordingModalButton"),
        chrome.i18n.getMessage("sandboxEditorCancelButton"),
        async () => {
          const s = contentStateRef.current;
          const blob = s.rawBlob || s.blob;
          if (!blob) {
            // In-memory blob never loaded (e.g. an orphaned OPFS pointer left
            // the editor unable to load). Recover straight from the OPFS file.
            await downloadResolvedRecording(s.title, (status) => {
              if (status === "started") return;
              showEditorToast(
                contentStateRef.current,
                chrome.i18n.getMessage("rawRecordingModalTitle") +
                  (status === "active" ? "" : ": no data"),
              );
            });
            return;
          }

          const ext = blob.type.includes("mp4") ? "mp4" : "webm";
          const filename = `raw-recording.${ext}`;

          // base64-via-BG fallback: works in Brave and when blob-URL downloads
          // are restricted, doesn't depend on chrome.downloads from here.
          const fallbackViaBackground = async () => {
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            chrome.runtime.sendMessage({
              type: "request-download",
              base64,
              title: filename,
            });
          };

          try {
            const url = window.URL.createObjectURL(blob);
            const downloadId = await new Promise((resolve, reject) => {
              try {
                chrome.downloads.download({ url, filename }, (id) => {
                  if (chrome.runtime.lastError || !id) {
                    reject(
                      chrome.runtime.lastError ||
                        new Error("download returned no id"),
                    );
                  } else {
                    resolve(id);
                  }
                });
              } catch (err) {
                reject(err);
              }
            });
            // Detect interrupted (non-user-cancel) downloads; matches the
            // main download flow in ContentState.jsx.
            const interruptHandler = async (delta) => {
              if (delta.id !== downloadId || !delta.state) return;
              if (
                delta.state.current === "interrupted" &&
                delta.error?.current !== "USER_CANCELED"
              ) {
                chrome.downloads.onChanged.removeListener(interruptHandler);
                try {
                  await fallbackViaBackground();
                } catch (err) {
                  console.error("[Recordful] raw download fallback failed:", err);
                }
              } else if (
                delta.state.current === "complete" ||
                delta.state.current === "interrupted"
              ) {
                chrome.downloads.onChanged.removeListener(interruptHandler);
                window.URL.revokeObjectURL(url);
              }
            };
            chrome.downloads.onChanged.addListener(interruptHandler);
          } catch (err) {
            console.warn(
              "[Recordful] raw download direct path failed, using fallback:",
              err,
            );
            try {
              await fallbackViaBackground();
            } catch (fallbackErr) {
              console.error(
                "[Recordful] raw download fallback failed:",
                fallbackErr,
              );
              showEditorToast(
                contentStateRef.current,
                chrome.i18n.getMessage("rawRecordingModalTitle") + ": failed",
              );
            }
          }
        },
        () => {}
      );
    }
  };

  const handleTroubleshooting = () => {
    if (typeof contentStateRef.current.openModal === "function") {
      contentStateRef.current.openModal(
        chrome.i18n.getMessage("troubleshootModalTitle"),
        chrome.i18n.getMessage("troubleshootModalDescription"),
        chrome.i18n.getMessage("troubleshootModalButton"),
        chrome.i18n.getMessage("sandboxEditorCancelButton"),
        async () => {
          try {
            const cs = contentStateRef.current;
            const { blob, filename } = await buildDiagnosticZip({
              source: "sandbox-editor",
              extraConfig: {
                editorMode: cs.mode || null,
                duration: cs.duration || null,
                width: cs.width || null,
                height: cs.height || null,
                hasBlobReady: Boolean(cs.blob || cs.rawBlob),
                mp4ready: Boolean(cs.mp4ready),
                ffmpegLoaded: Boolean(cs.ffmpegLoaded),
                fallback: Boolean(cs.fallback),
                offline: Boolean(cs.offline),
                noffmpeg: Boolean(cs.noffmpeg),
                updateChrome: Boolean(cs.updateChrome),
                hasBeenEdited: Boolean(cs.hasBeenEdited),
                editLimit: cs.editLimit || null,
              },
            });
            const url = window.URL.createObjectURL(blob);
            chrome.downloads.download(
              { url, filename },
              () => {
                window.URL.revokeObjectURL(url);
              },
            );
          } catch (err) {
            console.error("[Recordful] Troubleshooting export failed:", err);
          }
        },
        () => {},
      );
    }
  };

  return (
    <>
      {alertsNode &&
        contentState.mode === "player" &&
        createPortal(
          <>
          {!contentState.fallback && contentState.offline && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <WifiSlash size={16} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("offlineLabelTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("offlineLabelDescription")}
                </div>
              </div>
              <div className={styles.buttonRight}>
                {chrome.i18n.getMessage("offlineLabelTryAgain")}
              </div>
            </div>
          )}
          {contentState.fallback && contentState.noffmpeg && contentState.editLimit === 0 && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <WarningCircle size={16} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("longRecordingTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("longRecordingDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={handleDownloadOriginal}
              >
                {chrome.i18n.getMessage("rawRecordingModalButton")}
              </div>
            </div>
          )}
          {contentState.fallback && contentState.noffmpeg && contentState.editLimit !== 0 && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <WarningCircle size={16} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("recoveryModeTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("recoveryModeDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={handleDownloadOriginal}
              >
                {chrome.i18n.getMessage("rawRecordingModalButton")}
              </div>
            </div>
          )}
          {!contentState.fallback &&
            contentState.updateChrome &&
            !contentState.offline &&
            contentState.duration <= contentState.editLimit && (
              <div className={styles.alert}>
                <div className={styles.buttonLeft}>
                  <WarningCircle size={16} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("updateChromeLabelTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {chrome.i18n.getMessage("updateChromeLabelDescription")}
                  </div>
                </div>
                <div
                  className={styles.buttonRight}
                  onClick={() => {
                    chrome.runtime.sendMessage({ type: "chrome-update-info" });
                  }}
                >
                  {chrome.i18n.getMessage("learnMoreLabel")}
                </div>
              </div>
            )}
          {!contentState.fallback &&
            contentState.duration > contentState.editLimit &&
            !contentState.override &&
            !contentState.offline &&
            !contentState.updateChrome && (
              <div className={styles.alert}>
                <div className={styles.buttonLeft}>
                  <WarningCircle size={16} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("overLimitLabelTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.blob?.type === "video/mp4"
                      ? chrome.i18n.getMessage(
                          "overLimitLabelDescriptionFastPath"
                        )
                      : chrome.i18n.getMessage("overLimitLabelDescription")}
                  </div>
                </div>
                <div
                  className={styles.buttonRight}
                  onClick={() => {
                    if (typeof contentState.openModal === "function") {
                      contentState.openModal(
                        chrome.i18n.getMessage("overLimitModalTitle"),
                        chrome.i18n.getMessage(
                          contentState.blob?.type === "video/mp4"
                            ? "overLimitModalDescriptionFastPath"
                            : "overLimitModalDescription"
                        ),
                        chrome.i18n.getMessage("overLimitModalButton"),
                        chrome.i18n.getMessage("sandboxEditorCancelButton"),
                        () => {
                          setContentState((prevContentState) => ({
                            ...prevContentState,
                            saved: true,
                          }));
                          chrome.runtime.sendMessage({
                            type: "force-processing",
                          });
                        },
                        () => {},
                        null,
                        chrome.i18n.getMessage("overLimitModalLearnMore"),
                        () => {
                          chrome.runtime.sendMessage({ type: "upgrade-info" });
                        }
                      );
                    }
                  }}
                >
                  {chrome.i18n.getMessage("learnMoreLabel")}
                </div>
              </div>
            )}
          {(contentState.downloadingWEBM || contentState.downloading) && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <WarningCircle size={16} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("downloadProcessingTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {contentState.processingProgress > 0
                    ? `${chrome.i18n.getMessage(
                        "downloadProcessingDescription",
                      )} (${contentState.processingProgress}%)`
                    : chrome.i18n.getMessage("downloadProcessingDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={() => contentState.cancelDownload?.()}
              >
                {chrome.i18n.getMessage("cancelLabel")}
              </div>
            </div>
          )}
          {(!contentState.mp4ready || contentState.isFfmpegRunning) &&
            !contentState.downloadingWEBM &&
            !contentState.downloading &&
            (contentState.duration <= contentState.editLimit ||
              contentState.override) &&
            !contentState.offline &&
            !contentState.updateChrome &&
            !contentState.noffmpeg && (
              <div className={styles.alert}>
                <div className={styles.buttonLeft}>
                  <WarningCircle size={16} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("videoProcessingLabelTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.isFfmpegRunning
                      ? chrome.i18n.getMessage("editProcessingSafeDescription")
                      : chrome.i18n.getMessage("videoProcessingLabelDescription")}
                  </div>
                </div>
                {!contentState.isFfmpegRunning && (
                <div
                  className={styles.buttonRight}
                  onClick={() => {
                    chrome.runtime.sendMessage({
                      type: "pricing",
                    });
                  }}
                >
                  {chrome.i18n.getMessage("learnMoreLabel")}
                </div>
                )}
              </div>
            )}

          {!contentState.fallback &&
            contentState.editErrorType === "too-long" &&
            !(
              contentState.duration > contentState.editLimit &&
              !contentState.override
            ) && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <WarningCircle size={16} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("editTooLongTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("editTooLongDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={() =>
                  setContentState((prev) => ({ ...prev, editErrorType: null }))
                }
              >
                {chrome.i18n.getMessage("permissionsModalDismiss")}
              </div>
            </div>
          )}
          {!contentState.fallback && contentState.editErrorType === "timeout" && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <WarningCircle size={16} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("editTimeoutTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("editTimeoutDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={() =>
                  setContentState((prev) => ({ ...prev, editErrorType: null }))
                }
              >
                {chrome.i18n.getMessage("permissionsModalDismiss")}
              </div>
            </div>
          )}
          {!contentState.fallback && contentState.editErrorType === "failed" && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <WarningCircle size={16} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("editFailedTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("editFailedDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={() =>
                  setContentState((prev) => ({ ...prev, editErrorType: null }))
                }
              >
                {chrome.i18n.getMessage("permissionsModalDismiss")}
              </div>
            </div>
          )}
          </>,
          alertsNode,
        )}
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger asChild>
          <button className="button primaryButton">
            {chrome.i18n.getMessage("shareLabel")}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className={styles.panel}
            align="end"
            sideOffset={8}
            collisionPadding={8}
            onClick={(event) => {
              if (event.target.closest('[role="button"]:not([disabled])')) {
                setMenuOpen(false);
              }
            }}
          >
          <div className={styles.section}>
            {contentState.driveEnabled && (
              <div
                role="button"
                className={styles.buttonLogout}
                onClick={() => {
                  signOutDrive();
                }}
              >
                {chrome.i18n.getMessage("signOutDriveLabel")}
              </div>
            )}
            <div className={styles.buttonWrap}>
              <div
                role="button"
                className={styles.button}
                onClick={runSaveToDrive}
                aria-disabled={contentState.saveDrive}
                disabled={contentState.saveDrive}
              >
                <div className={styles.buttonLeft}>
                  <GoogleDriveLogo size={16} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {contentState.saveDrive
                      ? chrome.i18n.getMessage("savingDriveLabel")
                      : contentState.driveEnabled
                      ? chrome.i18n.getMessage("saveDriveButtonTitle")
                      : chrome.i18n.getMessage("signInDriveLabel")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.offline
                      ? chrome.i18n.getMessage("noConnectionLabel")
                      : contentState.updateChrome
                      ? chrome.i18n.getMessage("notAvailableLabel")
                      : chrome.i18n.getMessage("saveDriveButtonDescription")}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ArrowRight size={16} />
                </div>
              </div>
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.buttonWrap}>
              {contentState.fallback && (
                <div
                  role="button"
                  className={styles.button}
                  onClick={() => {
                    if (contentState.isFfmpegRunning) return;
                    contentState.downloadWEBM();
                  }}
                  disabled={contentState.isFfmpegRunning}
                >
                  <div className={styles.buttonLeft}>
                    <DownloadSimple size={16} />
                  </div>
                  <div className={styles.buttonMiddle}>
                    <div className={styles.buttonTitle}>
                      {contentState.downloadingWEBM
                        ? chrome.i18n.getMessage("downloadingLabel")
                        : chrome.i18n.getMessage("downloadWEBMButtonTitle")}
                    </div>
                    <div className={styles.buttonDescription}>
                      {chrome.i18n.getMessage("downloadWEBMButtonDescription")}
                    </div>
                  </div>
                  <div className={styles.buttonRight}>
                    <ArrowRight size={16} />
                  </div>
                </div>
              )}
              {(() => {
                // WebCodecs path produces a native MP4 blob; download is a
                // blob-URL anchor click, no ffmpeg/re-encode, so editLimit
                // and noffmpeg gates don't apply.
                const isNativeMp4 =
                  contentState.blob?.type === "video/mp4";
                const mp4Disabled = isNativeMp4
                  ? contentState.isFfmpegRunning || !contentState.mp4ready
                  : contentState.isFfmpegRunning ||
                    contentState.noffmpeg ||
                    !contentState.mp4ready;
                const mp4ShowNotAvailable = isNativeMp4
                  ? false
                  : contentState.updateChrome ||
                    contentState.noffmpeg ||
                    (contentState.duration > contentState.editLimit &&
                      !contentState.override);
                return (
              <div
                role="button"
                className={styles.button}
                onClick={() => {
                  if (!contentState.mp4ready) return;
                  contentState.download();
                }}
                disabled={mp4Disabled}
              >
                <div className={styles.buttonLeft}>
                  <DownloadSimple size={16} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {contentState.downloading
                      ? chrome.i18n.getMessage("downloadingLabel")
                      : chrome.i18n.getMessage("downloadMP4ButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.offline &&
                    !contentState.ffmpegLoaded &&
                    !isNativeMp4
                      ? chrome.i18n.getMessage("noConnectionLabel")
                      : mp4ShowNotAvailable
                      ? notAvailableLabel(contentState)
                      : contentState.mp4ready && !contentState.isFfmpegRunning
                      ? chrome.i18n.getMessage("downloadMP4ButtonDescription")
                      : preparingLabel(contentState)}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ArrowRight size={16} />
                </div>
              </div>
                );
              })()}
              {!contentState.fallback && (
                <div
                  role="button"
                  className={styles.button}
                  onClick={() => {
                    if (contentState.isFfmpegRunning) return;
                    contentState.downloadWEBM();
                  }}
                  disabled={contentState.isFfmpegRunning}
                >
                  <div className={styles.buttonLeft}>
                    <DownloadSimple size={16} />
                  </div>
                  <div className={styles.buttonMiddle}>
                    <div className={styles.buttonTitle}>
                      {contentState.downloadingWEBM
                        ? chrome.i18n.getMessage("downloadingLabel")
                        : chrome.i18n.getMessage("downloadWEBMButtonTitle")}
                    </div>
                    <div className={styles.buttonDescription}>
                      {!contentState.isFfmpegRunning
                        ? chrome.i18n.getMessage(
                            "downloadWEBMButtonDescription"
                          )
                        : preparingLabel(contentState)}
                    </div>
                  </div>
                  <div className={styles.buttonRight}>
                    <ArrowRight size={16} />
                  </div>
                </div>
              )}
              <div
                role="button"
                className={styles.button}
                onClick={() => {
                  // disabled on a div is meaningless; gate click manually.
                  // Not gated on isFfmpegRunning: it leaks from background
                  // poll handlers and would intermittently swallow the
                  // click. downloadGIF self-locks via downloadingGIF.
                  if (
                    contentState.downloadingGIF ||
                    contentState.duration > 30 ||
                    !contentState.mp4ready ||
                    contentState.noffmpeg
                  ) {
                    return;
                  }
                  contentState.downloadGIF();
                }}
                disabled={
                  contentState.downloadingGIF ||
                  contentState.duration > 30 ||
                  !contentState.mp4ready ||
                  contentState.noffmpeg
                }
              >
                <div className={styles.buttonLeft}>
                  <Gif size={16} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {contentState.downloadingGIF
                      ? chrome.i18n.getMessage("downloadingLabel")
                      : chrome.i18n.getMessage("downloadGIFButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.offline && !contentState.ffmpegLoaded
                      ? chrome.i18n.getMessage("noConnectionLabel")
                      : contentState.updateChrome ||
                        contentState.noffmpeg ||
                        (contentState.duration > contentState.editLimit &&
                          !contentState.override)
                      ? notAvailableLabel(contentState)
                      : contentState.mp4ready
                      ? chrome.i18n.getMessage("downloadGIFButtonDescription")
                      : preparingLabel(contentState)}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ArrowRight size={16} />
                </div>
              </div>
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.buttonWrap}>
              <div
                role="button"
                className={styles.button}
                onClick={() => {
                  handleRawRecording();
                }}
              >
                <div className={styles.buttonLeft}>
                  <DownloadSimple size={16} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("rawRecordingButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {chrome.i18n.getMessage("rawRecordingButtonDescription")}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ArrowRight size={16} />
                </div>
              </div>
              <div
                role="button"
                className={styles.button}
                onClick={() => {
                  handleTroubleshooting();
                }}
              >
                <div className={styles.buttonLeft}>
                  <Flag size={16} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("troubleshootButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {chrome.i18n.getMessage("troubleshootButtonDescription")}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ArrowRight size={16} />
                </div>
              </div>
            </div>
          </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
};

export default ShareMenu;
