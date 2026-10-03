import React from "react";

import * as Select from "@radix-ui/react-select";
import {
  CaretDown,
  Check,
  Crop,
  Monitor,
  VideoCamera,
} from "@phosphor-icons/react";

// Recording-mode picker styled like the camera/mic device dropdowns.
// Replaces the old Screen / Tab area / Camera tab row.
const MODES = [
  {
    value: "screen",
    label: () => chrome.i18n.getMessage("screenType"),
    Icon: Monitor,
  },
  {
    value: "region",
    label: () => chrome.i18n.getMessage("tabType"),
    Icon: Crop,
  },
  {
    value: "camera",
    label: () => chrome.i18n.getMessage("cameraType"),
    Icon: VideoCamera,
  },
];

const ModeSelectItem = React.forwardRef(
  ({ children, ...props }, forwardedRef) => {
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

const ModeDropdown = (props) => {
  const current = MODES.find((mode) => mode.value === props.value) || MODES[0];
  const CurrentIcon = current.Icon;

  return (
    <Select.Root value={props.value} onValueChange={props.onChange}>
      <Select.Trigger className="SelectTrigger" aria-label="Recording mode">
        <Select.Icon className="SelectIconType">
          <CurrentIcon size={16} />
        </Select.Icon>
        <div className="SelectValue">
          <Select.Value placeholder={current.label()}>
            {current.label()}
          </Select.Value>
        </div>
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
          <Select.Viewport className="SelectViewport">
            {MODES.map((mode) => {
              const ModeIcon = mode.Icon;
              const disabled =
                mode.value === "region" && props.regionDisabled;
              return (
                <ModeSelectItem
                  value={mode.value}
                  key={mode.value}
                  disabled={disabled}
                >
                  <span className="SelectItemWithIcon">
                    <ModeIcon size={16} />
                    {mode.label()}
                  </span>
                </ModeSelectItem>
              );
            })}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};

export default ModeDropdown;
