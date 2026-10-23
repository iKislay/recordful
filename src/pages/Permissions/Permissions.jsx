import React, { useEffect, useState, useRef, useCallback } from "react";

// Opened by the background as an offscreen document, not inside a page: it
// then asks for the extension itself, which no website's policy can block.
const IS_OFFSCREEN = new URLSearchParams(location.search).has("offscreen");

/**
 * The cameras and microphones the extension itself may use, as the extension
 * set them in Chrome's settings. Read in the offscreen document, where the
 * answer is the extension's own: nothing is opened, so no light comes on.
 */
const extensionDevices = async () => {
  const state = async (name) => {
    try {
      return (await navigator.permissions.query({ name })).state;
    } catch {
      return "prompt";
    }
  };
  const [camera, microphone] = await Promise.all([
    state("camera"),
    state("microphone"),
  ]);
  const camOk = camera === "granted";
  const micOk = microphone === "granted";
  if (!camOk && !micOk) return { success: false, error: "NotAllowedError" };
  const devices = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind) =>
    devices
      .filter((device) => device.kind === kind)
      .map(({ deviceId, label }) => ({ deviceId, label }));
  return {
    success: true,
    audioinput: micOk ? pick("audioinput") : [],
    audiooutput: micOk ? pick("audiooutput") : [],
    videoinput: camOk ? pick("videoinput") : [],
    cameraPermission: camOk,
    microphonePermission: micOk,
  };
};

const Recorder = () => {
  useEffect(() => {
    if (IS_OFFSCREEN) return;
    chrome.runtime.sendMessage({
      type: "recordful-permissions-loaded",
    });

    // Cross-origin iframe, so allowsFeature reflects what the page actually
    // delegated to us. Pages with feature=(self) (e.g. facebook.com) don't
    // delegate, so this reads false. Report up so the UI can warn.
    try {
      const pp = document.permissionsPolicy || document.featurePolicy;
      if (pp && typeof pp.allowsFeature === "function") {
        chrome.runtime.sendMessage({
          type: "recordful-site-policy",
          cameraAllowed: pp.allowsFeature("camera"),
          microphoneAllowed: pp.allowsFeature("microphone"),
          displayCaptureAllowed: pp.allowsFeature("display-capture"),
        });
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (IS_OFFSCREEN) return;
    const handleDeviceChange = () => {
      // Recheck permissions and enumerate devices
      checkPermissions();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange
      );
    };
  }, []);

  const checkPermissions = async () => {
    // Individually check the camera and microphone permissions using the Permissions API. Then enumerate devices respectively.
    try {
      const cameraPermission = await navigator.permissions.query({
        name: "camera",
      });
      const microphonePermission = await navigator.permissions.query({
        name: "microphone",
      });

      cameraPermission.onchange = () => {
        checkPermissions();
      };

      microphonePermission.onchange = () => {
        checkPermissions();
      };

      // If `Permissions.query()` reports either granted, take the fast
      // path and enumerate.
      if (
        cameraPermission.state === "granted" ||
        microphonePermission.state === "granted"
      ) {
        enumerateDevices(
          cameraPermission.state === "granted",
          microphonePermission.state === "granted"
        );
        return;
      }

      // permissions.query() asks the iframe's own origin and reports
      // "prompt"/"denied" even when getUserMedia would succeed via
      // the parent's `allow="camera *; microphone *"`. Probing is left
      // to enumerateDevices, which tries each kind on its own.
      await enumerateDevices(true, true);
    } catch (err) {
      enumerateDevices();
    }
  };

  // Bluetooth/USB devices report NotReadableError for a second or two after
  // wake, and the camera preview can hold the device while we probe.
  const TRANSIENT = new Set(["NotReadableError", "AbortError"]);
  const openStream = async (constraints) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return {
          stream: await navigator.mediaDevices.getUserMedia(constraints),
        };
      } catch (err) {
        if (attempt === 0 && TRANSIENT.has(err?.name)) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        return { error: err };
      }
    }
    return { error: new Error("unreachable") };
  };

  const enumerateDevices = async (camGranted = true, micGranted = true) => {
    const streams = [];
    let camOk = false;
    let micOk = false;
    let lastError = null;

    if (camGranted && micGranted) {
      const { stream, error } = await openStream({ audio: true, video: true });
      if (stream) {
        streams.push(stream);
        camOk = true;
        micOk = true;
      } else {
        lastError = error;
      }
    }

    // A combined request fails outright when either device is missing or busy,
    // so retry each kind alone. A denial covers both, so skip re-asking.
    const denied = lastError?.name === "NotAllowedError";

    if (camGranted && !camOk && !denied) {
      const { stream, error } = await openStream({ video: true });
      if (stream) {
        streams.push(stream);
        camOk = true;
      } else {
        lastError = error || lastError;
      }
    }
    if (micGranted && !micOk && !denied) {
      const { stream, error } = await openStream({ audio: true });
      if (stream) {
        streams.push(stream);
        micOk = true;
      } else {
        lastError = error || lastError;
      }
    }

    let devicesInfo = [];
    try {
      devicesInfo = await navigator.mediaDevices.enumerateDevices();
      // Chrome's device list lags the grant, so an empty answer for a kind we
      // hold a live stream for is worth one more look.
      const missingGranted = () =>
        (camOk && !devicesInfo.some((d) => d.kind === "videoinput")) ||
        (micOk && !devicesInfo.some((d) => d.kind === "audioinput"));
      if (missingGranted()) {
        await new Promise((r) => setTimeout(r, 300));
        devicesInfo = await navigator.mediaDevices.enumerateDevices();
      }
    } catch (err) {
      lastError = err;
    }

    const pick = (kind) =>
      devicesInfo
        .filter((device) => device.kind === kind)
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label,
        }));

    // Labels only appear once the permission is granted, so a labelled list
    // proves the grant even when the stream just failed as busy.
    const hasLabels = (kind) =>
      devicesInfo.some((device) => device.kind === kind && device.label);
    camOk = camOk || (camGranted && hasLabels("videoinput"));
    micOk = micOk || (micGranted && hasLabels("audioinput"));

    streams.forEach((stream) => stream.getTracks().forEach((t) => t.stop()));

    let result =
      camOk || micOk
        ? {
            success: true,
            audioinput: micOk ? pick("audioinput") : [],
            audiooutput: micOk ? pick("audiooutput") : [],
            videoinput: camOk ? pick("videoinput") : [],
            cameraPermission: camOk,
            microphonePermission: micOk,
          }
        : { success: false, error: lastError?.name || "unknown" };

    // This frame sits in the page, so the page's policy can block it (and
    // Chrome then reports a denial) even though the extension was allowed in
    // its own settings, which is what recording uses. The extension's own
    // answer fills in what the page would not let this frame see.
    if (!camOk || !micOk) {
      const own = await chrome.runtime
        .sendMessage({ type: "extension-media-devices" })
        .catch(() => null);
      if (own?.success) {
        const cam = camOk || own.cameraPermission;
        const mic = micOk || own.microphonePermission;
        result = {
          success: true,
          audioinput: micOk ? result.audioinput : own.audioinput || [],
          audiooutput: micOk ? result.audiooutput : own.audiooutput || [],
          videoinput: camOk ? result.videoinput : own.videoinput || [],
          cameraPermission: Boolean(cam),
          microphonePermission: Boolean(mic),
        };
      }
    }

    if (!result.success) {
      chrome.runtime.sendMessage({ type: "recordful-permissions", ...result });
      return;
    }

    const { success, ...found } = result;
    chrome.storage.local.set(found);
    chrome.runtime.sendMessage({ type: "recordful-permissions", ...result });
  };

  const onMessage = (message, sender, sendResponse) => {
    // The background asking the offscreen copy for the extension's devices.
    if (message.type === "extension-media-devices-probe") {
      if (!IS_OFFSCREEN) return;
      extensionDevices()
        .catch((err) => ({ success: false, error: err?.name || "unknown" }))
        .then(sendResponse);
      return true;
    }
    if (IS_OFFSCREEN) return;
    // sender.tab is only unset when the background relayed this (see
    // relayToSenderTab); a direct broadcast may be another tab's request.
    if (sender?.tab) return;
    if (message.type === "recordful-get-permissions") {
      checkPermissions();
    }
  };

  // chrome.runtime, not window.postMessage: only extension contexts (content
  // scripts, extension pages) can reach this, not any embedding page.
  useEffect(() => {
    chrome.runtime.onMessage.addListener(onMessage);
  }, []);

  return <div></div>;
};

export default Recorder;
