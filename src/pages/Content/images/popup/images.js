// I need to make this work for a Chrome extension, so I can't import images, instead it needs to be a string with the path to the image
// NOTE: UI icons live in @phosphor-icons/react (see toolbar/components/SVG.jsx).
// This module only keeps raster assets (thumbnails, canvas handles) that can't
// be replaced by a font-style glyph.
const URL =
  "chrome-extension://" + chrome.i18n.getMessage("@@extension_id") + "/assets";

const HandleControl = `${URL}/canvas/handle.png`;
const RotateControl = `${URL}/canvas/rotate.png`;
const MiddleHandleControl = `${URL}/canvas/middle-handle.png`;
const MiddleHandleControlV = `${URL}/canvas/middle-handle-v.png`;

export {
  HandleControl,
  RotateControl,
  MiddleHandleControl,
  MiddleHandleControlV,
};
