import React from "react";

import { Crop, Monitor } from "@phosphor-icons/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../Components/Select";

// Recording-mode picker styled like the camera/mic device dropdowns.
// There is no camera-only mode: the camera records beside the screen as a
// file of its own, and the editor can size it to fill the picture.
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
];

const ModeDropdown = (props) => {
  const current = MODES.find((mode) => mode.value === props.value) || MODES[0];
  const CurrentIcon = current.Icon;

  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger>
        <span className="rf-select-leading">
          <CurrentIcon size={16} />
        </span>
        <SelectValue placeholder={current.label()} />
      </SelectTrigger>
      <SelectContent>
        {MODES.map((mode) => {
          const ModeIcon = mode.Icon;
          const disabled = mode.value === "region" && props.regionDisabled;
          return (
            <SelectItem
              value={mode.value}
              key={mode.value}
              disabled={disabled}
              label={mode.label()}
            >
              <span className="rf-select-item-icon">
                <ModeIcon size={16} />
                {mode.label()}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

export default ModeDropdown;
