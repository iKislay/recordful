import React, { useEffect, useState, useContext, useRef } from "react";

import * as Select from "@radix-ui/react-select";
import {
  CaretDown,
  Check,
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
} from "@phosphor-icons/react";

// Context
import { contentStateContext } from "../../context/ContentState";

const Dropdown = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [label, setLabel] = useState(chrome.i18n.getMessage("None"));
  const [open, setOpen] = useState(false);
  const cameraAnchorId =
    props.type === "camera" ? "pro-onboarding-camera-toggle" : undefined;

  const updateItems = () => {
    if (props.type === "camera") {
      if (
        contentState.defaultVideoInput === "none" ||
        !contentState.cameraActive
      ) {
        setLabel(chrome.i18n.getMessage("noCameraDropdownLabel"));
      } else {
        // Check if defaultVideoInput is in camdevices, if not set to none
        if (
          contentState.videoInput.find(
            (device) => device.deviceId === contentState.defaultVideoInput
          )
        ) {
          setLabel(
            contentState.videoInput.find(
              (device) => device.deviceId === contentState.defaultVideoInput
            ).label
          );
        } else {
          setLabel(chrome.i18n.getMessage("noCameraDropdownLabel"));
        }
      }
    } else {
      if (
        contentState.defaultAudioInput === "none" ||
        (!contentState.micActive && !contentState.pushToTalk)
      ) {
        setLabel(chrome.i18n.getMessage("noMicrophoneDropdownLabel"));
      } else {
        // Check if defaultAudioInput is in micdevices, if not set to none
        if (
          contentState.audioInput.find(
            (device) => device.deviceId === contentState.defaultAudioInput
          )
        ) {
          setLabel(
            contentState.audioInput.find(
              (device) => device.deviceId === contentState.defaultAudioInput
            ).label
          );
        } else {
          setLabel(chrome.i18n.getMessage("noMicrophoneDropdownLabel"));
        }
      }
    }
  };

  useEffect(() => {
    updateItems();
  }, [
    contentState.defaultAudioInput,
    contentState.defaultVideoInput,
    contentState.audioInput,
    contentState.videoInput,
    contentState.cameraActive,
    contentState.micActive,
  ]);

  useEffect(() => {
    updateItems();
  }, []);

  const toggleActive = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    if (props.type === "camera") {
      if (contentState.cameraActive) {
        setContentState((prevContentState) => ({
          ...prevContentState,
          cameraActive: false,
        }));
        chrome.storage.local.set({
          cameraActive: false,
        });
        setLabel(chrome.i18n.getMessage("noCameraDropdownLabel"));
      } else {
        // Toggling on left the device at "none" and the label unset. Adopt the
        // first camera here, same as the permission grant does.
        const devices = contentState.videoInput || [];
        const selected =
          devices.find(
            (device) => device.deviceId === contentState.defaultVideoInput
          ) ||
          devices[0] ||
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
        setLabel(
          selected
            ? selected.label
            : chrome.i18n.getMessage("noCameraDropdownLabel")
        );
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
        setLabel(chrome.i18n.getMessage("noMicrophoneDropdownLabel"));
      } else {
        const devices = contentState.audioInput || [];
        const selected =
          devices.find(
            (device) => device.deviceId === contentState.defaultAudioInput
          ) ||
          devices[0] ||
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
        setLabel(
          selected
            ? selected.label
            : chrome.i18n.getMessage("noMicrophoneDropdownLabel")
        );
      }
    }
  };

  const clickedIcon = useRef(false);
  // Guards onOpenChange while the icon handles its own click. Cleared next tick
  // because onClick runs after onMouseUp, which left the flag stuck true.
  const guardIconClick = () => {
    clickedIcon.current = true;
    setTimeout(() => {
      clickedIcon.current = false;
    }, 0);
  };

  return (
    <Select.Root
      open={open}
      onOpenChange={(open) => {
        if (clickedIcon.current) return;
        setOpen(open);
      }}
      value={
        props.type === "camera" && contentState.cameraActive
          ? contentState.defaultVideoInput
          : props.type === "camera" && !contentState.cameraActive
          ? "none"
          : props.type === "mic" &&
            (contentState.micActive || contentState.pushToTalk)
          ? contentState.defaultAudioInput
          : props.type === "mic" && !contentState.micActive
          ? "none"
          : "none"
      }
      onValueChange={(newValue) => {
        if (props.type === "camera") {
          if (newValue === "none") {
            setContentState((prevContentState) => ({
              ...prevContentState,
              cameraActive: false,
            }));
            chrome.storage.local.set({
              cameraActive: false,
            });
            setLabel(chrome.i18n.getMessage("noCameraDropdownLabel"));
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
            setLabel(selectedLabel);
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
            setLabel(chrome.i18n.getMessage("noMicrophoneDropdownLabel"));
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
            setLabel(selectedLabel);
          }
        }
      }}
    >
      <Select.Trigger
        className="SelectTrigger"
        aria-label="Food"
        id={cameraAnchorId}
      >
        <Select.Icon
          className="SelectIconType"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setOpen(false);
            guardIconClick();
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setOpen(false);
            clickedIcon.current = true;
          }}
          onMouseUp={(e) => {
            clickedIcon.current = false;
          }}
        >
          <div
            className="SelectIconButton"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              toggleActive(e);
              guardIconClick();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setOpen(false);
              clickedIcon.current = true;
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseUp={(e) => {
              clickedIcon.current = false;
            }}
          >
            {props.type == "camera" &&
              (contentState.defaultVideoInput === "none" ||
              !contentState.cameraActive ? (
                <VideoCameraSlash size={16} />
              ) : (
                <VideoCamera size={16} />
              ))}
            {props.type == "mic" &&
              (contentState.defaultAudioInput === "none" ||
              !contentState.micActive ? (
                <MicrophoneSlash size={16} />
              ) : (
                <Microphone size={16} />
              ))}
          </div>
        </Select.Icon>
        <div className="SelectValue">
          <Select.Value
            placeholder={chrome.i18n.getMessage(
              "selectSourceDropdownPlaceholder"
            )}
          >
            {label}
          </Select.Value>
        </div>
        {props.type == "camera" &&
          (contentState.defaultVideoInput == "none" ||
            !contentState.cameraActive) && (
            <div className="SelectOff">
              {chrome.i18n.getMessage("offLabel")}
            </div>
          )}
        {props.type == "mic" &&
          (contentState.defaultAudioInput == "none" ||
            (!contentState.micActive && !contentState.pushToTalk)) && (
            <div className="SelectOff">
              {chrome.i18n.getMessage("offLabel")}
            </div>
          )}
        <Select.Icon className="SelectIconDrop">
          <CaretDown size={16} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal
        container={props.shadowRef.current.shadowRoot.querySelector(
          ".container"
        )}
      >
        <Select.Content position="popper" className="SelectContent">
          <Select.ScrollUpButton className="SelectScrollButton"></Select.ScrollUpButton>
          <Select.Viewport className="SelectViewport">
            <Select.Group>
              <SelectItem value="none">
                {props.type == "camera"
                  ? chrome.i18n.getMessage("noCameraDropdownLabel")
                  : chrome.i18n.getMessage("noMicrophoneDropdownLabel")}
              </SelectItem>
            </Select.Group>
            {props.type == "camera" && contentState.videoInput.length > 0 && (
              <Select.Separator className="SelectSeparator" />
            )}
            {props.type == "mic" && contentState.audioInput.length > 0 && (
              <Select.Separator className="SelectSeparator" />
            )}
            <Select.Group>
              {props.type == "camera" &&
                contentState.videoInput.map((device) => (
                  <SelectItem value={device.deviceId} key={device.deviceId}>
                    {device.label}
                  </SelectItem>
                ))}
              {props.type == "mic" &&
                contentState.audioInput.map((device) => (
                  <SelectItem value={device.deviceId} key={device.deviceId}>
                    {device.label}
                  </SelectItem>
                ))}
            </Select.Group>
          </Select.Viewport>
          <Select.ScrollDownButton className="SelectScrollButton"></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};

const SelectItem = React.forwardRef(
  ({ children, className, ...props }, forwardedRef) => {
    return (
      <Select.Item className="SelectItem" {...props} ref={forwardedRef}>
        <Select.ItemText>{children}</Select.ItemText>
        <Select.ItemIndicator className="SelectItemIndicator">
          <Check size={16} weight="bold" />
        </Select.ItemIndicator>
      </Select.Item>
    );
  }
);

export default Dropdown;
