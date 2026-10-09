import React, { useEffect, useState, useContext } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../Components/Select";
import "../../../Components/Select.scss";

// Context
import { ContentStateContext } from "../../context/ContentState"; // Import the ContentState context

const Dropdown = () => {
  const [contentState, setContentState] = useContext(ContentStateContext); // Access the ContentState context

  const [value, setValue] = useState("none");

  // Video presets for Youtube, Instagram, TikTok, etc.
  const presets = [
    {
      name: "none",
    },
    {
      name: "Youtube",
      label: "Youtube",
      width: 1920,
      height: 1080,
    },
    {
      name: "YoutubeShorts",
      label: "Youtube Shorts",
      width: 1080,
      height: 1920,
    },
    {
      name: "InstagramPost",
      label: "Instagram Post",
      width: 1080,
      height: 1080,
    },
    {
      name: "InstagramStory",
      label: "Instagram Story",
      width: 1080,
      height: 1920,
    },
    {
      name: "TikTok",
      label: "TikTok",
      width: 1080,
      height: 1920,
    },
    {
      name: "Facebook",
      label: "Facebook",
      width: 1080,
      height: 1080,
    },
    {
      name: "Twitter",
      label: "Twitter",
      width: 1080,
      height: 1080,
    },
    {
      name: "Dribbble",
      label: "Dribbble",
      width: 2800,
      height: 2100,
    },
  ];

  useEffect(() => {
    // Update the value when the contentState changes
    setValue(contentState.cropPreset);

    if (contentState.cropPreset === "none") return;
    const preset = presets.find(
      (preset) => preset.name === contentState.cropPreset
    );
    const aspectRatio = preset.width / preset.height;
    const maxWidth = contentState.prevWidth;
    const maxHeight = contentState.prevHeight;

    let width = Math.min(preset.width, maxWidth);
    let height = Math.min(preset.height, maxHeight);

    if (width > maxWidth || height > maxHeight) {
      if (width / height > aspectRatio) {
        width = Math.min(maxWidth, width);
        height = width / aspectRatio;
      } else {
        height = Math.min(maxHeight, height);
        width = height * aspectRatio;
      }
    }

    if (width > maxWidth) {
      width = maxWidth;
      height = width / aspectRatio;
    }

    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspectRatio;
    }

    const left = maxWidth / 2 - width / 2;
    const top = maxHeight / 2 - height / 2;

    setContentState((prevContentState) => ({
      ...prevContentState,
      fromCropper: false,
      width: width,
      height: height,
      left: left,
      top: top,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentState.cropPreset]);

  return (
    <Select
      value={value}
      onValueChange={(newValue) => {
        setValue(newValue);
        setContentState((prevContentState) => ({
          ...prevContentState,
          cropPreset: newValue,
        }));
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select a source" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none" label="None">
          None
        </SelectItem>
        {presets.map(
          (preset) =>
            preset.name !== "none" && (
              <SelectItem
                value={preset.name}
                key={preset.name}
                label={preset.label}
              >
                {preset.label}
              </SelectItem>
            )
        )}
      </SelectContent>
    </Select>
  );
};

export default Dropdown;
