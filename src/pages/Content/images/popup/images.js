// I need to make this work for a Chrome extension, so I can't import images, instead it needs to be a string with the path to the image
// NOTE: UI icons live in @phosphor-icons/react (see toolbar/components/SVG.jsx).
// This module only keeps raster assets (thumbnails, canvas handles) that can't
// be replaced by a font-style glyph.
const URL =
  "chrome-extension://" + chrome.i18n.getMessage("@@extension_id") + "/assets";

const TempFigma = `${URL}/temp/figma.webp`;
const TempTwitter = `${URL}/temp/twitter.webp`;
const TempDesignSystem = `${URL}/temp/designsystem.webp`;
const TempMarketing = `${URL}/temp/marketing.webp`;
const TempSubstack = `${URL}/temp/substack.webp`;
const HandleControl = `${URL}/canvas/handle.png`;
const RotateControl = `${URL}/canvas/rotate.png`;
const MiddleHandleControl = `${URL}/canvas/middle-handle.png`;
const MiddleHandleControlV = `${URL}/canvas/middle-handle-v.png`;
const PlaceholderThumb = `${URL}/placeholder-thumb.png`;

export {
  TempFigma,
  TempTwitter,
  TempDesignSystem,
  TempMarketing,
  TempSubstack,
  HandleControl,
  RotateControl,
  MiddleHandleControl,
  MiddleHandleControlV,
  PlaceholderThumb,
};
