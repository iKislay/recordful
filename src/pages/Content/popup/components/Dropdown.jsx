import React, { useContext } from "react";

import {
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
} from "@phosphor-icons/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../Components/Select";

// Context
import { contentStateContext } from "../../context/ContentState";

const Dropdown = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const isCamera = props.type === "camera";
  const devices = isCamera
    ? contentState.videoInput
    : contentState.audioInput;
  const currentId = isCamera
    ? contentState.defaultVideoInput
    : contentState.defaultAudioInput;
  const active = isCamera
    ? contentState.cameraActive
    : contentState.micActive || contentState.pushToTalk;
  const off = currentId === "none" || !active;
  const value = active ? currentId : "none";
  const noneLabel = isCamera
    ? chrome.i18n.getMessage("noCameraDropdownLabel")
    : chrome.i18n.getMessage("noMicrophoneDropdownLabel");

  const toggleActive = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCamera) {
      if (contentState.cameraActive) {
        setContentState((prevContentState) => ({
          ...prevContentState,
          cameraActive: false,
        }));
        chrome.storage.local.set({
          cameraActive: false,
        });
      } else {
        // Toggling on left the device at "none" and the label unset. Adopt the
        // first camera here, same as the permission grant does.
        const list = contentState.videoInput || [];
        const selected =
          list.find(
            (device) => device.deviceId === contentState.defaultVideoInput
          ) ||
          list[0] ||
          null;
        const patch = selected
          ? {
              cameraActive: true,
              defaultVideoInput: selected.deviceId,
              defaultVideoInputLabel: selected.label || "",
            }
          : { cameraActive: true };
        setContentState((prevContentState) => ({
          ...prevContentState,
          ...patch,
        }));
        chrome.storage.local.set(patch);
      }
    } else {
      if (contentState.micActive) {
        setContentState((prevContentState) => ({
          ...prevContentState,
          micActive: false,
        }));
        chrome.storage.local.set({
          micActive: false,
        });
      } else {
        const list = contentState.audioInput || [];
        const selected =
          list.find(
            (device) => device.deviceId === contentState.defaultAudioInput
          ) ||
          list[0] ||
          null;
        const patch = selected
          ? {
              micActive: true,
              defaultAudioInput: selected.deviceId,
              defaultAudioInputLabel: selected.label || "",
            }
          : { micActive: true };
        setContentState((prevContentState) => ({
          ...prevContentState,
          ...patch,
        }));
        chrome.storage.local.set(patch);
      }
    }
  };

  const onValueChange = (newValue) => {
    if (isCamera) {
      if (newValue === "none") {
        setContentState((prevContentState) => ({
          ...prevContentState,
          cameraActive: false,
        }));
        chrome.storage.local.set({
          cameraActive: false,
        });
      } else {
        const selectedLabel =
          contentState.videoInput.find(
            (device) => device.deviceId === newValue
          )?.label || "";
        setContentState((prevContentState) => ({
          ...prevContentState,
          defaultVideoInput: newValue,
          defaultVideoInputLabel: selectedLabel,
          cameraActive: true,
        }));
        chrome.storage.local.set({
          defaultVideoInput: newValue,
          defaultVideoInputLabel: selectedLabel,
          cameraActive: true,
        });
        chrome.runtime.sendMessage({
          type: "switch-camera",
          id: newValue,
        });
      }
    } else {
      if (newValue === "none") {
        setContentState((prevContentState) => ({
          ...prevContentState,
          micActive: false,
        }));
        chrome.storage.local.set({
          micActive: false,
        });
      } else {
        const selectedLabel =
          contentState.audioInput.find(
            (device) => device.deviceId === newValue
          )?.label || "";
        setContentState((prevContentState) => ({
          ...prevContentState,
          defaultAudioInput: newValue,
          defaultAudioInputLabel: selectedLabel,
          micActive: true,
        }));
        chrome.storage.local.set({
          defaultAudioInput: newValue,
          defaultAudioInputLabel: selectedLabel,
          micActive: true,
        });
      }
    }
  };

  return (
    <div className="device-select-row">
      <button
        type="button"
        className="device-toggle"
        onClick={toggleActive}
        aria-pressed={active}
        aria-label={isCamera ? "Camera" : "Microphone"}
        id={
          isCamera ? "pro-onboarding-camera-toggle" : undefined
        }
      >
        {isCamera ? (
          off ? (
            <VideoCameraSlash size={16} />
          ) : (
            <VideoCamera size={16} />
          )
        ) : off ? (
          <MicrophoneSlash size={16} />
        ) : (
          <Microphone size={16} />
        )}
      </button>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue
            placeholder={chrome.i18n.getMessage(
              "selectSourceDropdownPlaceholder"
            )}
          />
          {off && (
            <span className="device-off">
              {chrome.i18n.getMessage("offLabel")}
            </span>
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{noneLabel}</SelectItem>
          {(devices || []).map((device) => (
            <SelectItem value={device.deviceId} key={device.deviceId}>
              {device.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default Dropdown;
