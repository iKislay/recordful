import React from "react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  ArrowUpRight,
  ArrowUUpLeft,
  ArrowUUpRight,
  Circle,
  Clock,
  CornersOut,
  Crosshair,
  Cursor,
  CursorClick,
  DotsNine,
  DotsSixVertical,
  DotsThree,
  Eraser,
  Eyedropper,
  EyeSlash,
  Flashlight,
  Highlighter,
  Image as ImageIconPh,
  Microphone,
  Minus,
  Pause,
  PencilSimpleLine,
  PictureInPicture,
  Play,
  Prohibit,
  Question,
  Rectangle,
  Selection,
  SpeakerHigh,
  Square,
  StopCircle,
  TextT,
  Trash,
  Triangle,
  VideoCamera,
  VideoCameraSlash,
  WarningCircle,
  WifiSlash,
  X,
} from "@phosphor-icons/react";

// All toolbar icons are Phosphor glyphs rendered inline. Callers keep the
// same API as before: <GrabIcon />, <StopIcon width="20" height="20" />,
// <Stroke3Icon className="stroke-icon" />. Size falls back to 16px.
const sizeOf = (props, fallback = 16) =>
  Number(props.width) || Number(props.size) || fallback;

const make = (Icon, weight = "regular") => {
  const Wrapped = (props) => (
    <Icon
      size={sizeOf(props)}
      weight={weight}
      className={props.className}
      style={props.style}
    />
  );
  return Wrapped;
};

const GrabIcon = make(DotsSixVertical);
const StopIcon = make(StopCircle, "fill");
const DrawIcon = make(PencilSimpleLine);
const PauseIcon = make(Pause, "fill");
const ResumeIcon = make(Play, "fill");
const CursorIcon = make(Cursor);
const MicIcon = make(Microphone);
const RestartIcon = make(ArrowCounterClockwise);
const DiscardIcon = make(Trash);
const EyeDropperIcon = make(Eyedropper);

const Stroke1Icon = (props) => (
  <Minus
    size={sizeOf(props, 18)}
    weight="light"
    className={props.className}
    style={{
      textAlign: "center",
      margin: "auto",
      display: "block",
      width: "100%",
      height: "100%",
      ...props.style,
    }}
  />
);

const Stroke2Icon = (props) => (
  <Minus
    size={sizeOf(props, 18)}
    weight="regular"
    className={props.className}
    style={{
      textAlign: "center",
      margin: "auto",
      display: "block",
      width: "100%",
      height: "100%",
      ...props.style,
    }}
  />
);

const Stroke3Icon = (props) => (
  <Minus
    size={sizeOf(props, 18)}
    weight="bold"
    className={props.className}
    style={{
      textAlign: "center",
      margin: "auto",
      display: "block",
      width: "100%",
      height: "100%",
      ...props.style,
    }}
  />
);

const TargetCursorIcon = make(Crosshair);
const HighlightCursorIcon = make(CursorClick);
const HideCursorIcon = make(EyeSlash);
const TextIcon = make(TextT);
const ArrowIcon = make(ArrowUpRight);
const EraserIcon = make(Eraser);
const UndoIcon = make(ArrowUUpLeft);
const RedoIcon = make(ArrowUUpRight);
const ImageIcon = make(ImageIconPh);
const TransformIcon = make(Selection);
const HighlighterIcon = make(Highlighter);
const RectangleIcon = make(Rectangle);
const CircleIcon = make(Circle);
const TriangleIcon = make(Triangle);
const RectangleFilledIcon = make(Square, "fill");
const CircleFilledIcon = make(Circle, "fill");
const TriangleFilledIcon = make(Triangle, "fill");
const TrashIcon = make(Trash);
const VideoOffIcon = make(VideoCameraSlash);
const CameraCloseIcon = make(X);
const CameraMoreIcon = make(DotsThree);
const CameraResizeIcon = make(CornersOut);
const CameraIcon = make(VideoCamera);
const BlurIcon = make(DotsNine, "fill");
const AlertIcon = make(WarningCircle);
const TimeIcon = make(Clock);
const SpotlightCursorIcon = make(Flashlight);
const Pip = make(PictureInPicture);
const CloseIconPopup = make(X);
const GrabIconPopup = make(DotsSixVertical);
const MoreIconPopup = make(DotsThree);
const OnboardingArrow = make(ArrowRight);
const NoInternet = make(WifiSlash);
const CloseButtonToolbar = make(X);
const HelpIconPopup = make(Question);
const AudioIcon = make(SpeakerHigh);
const NotSupportedIcon = make(Prohibit);

export {
  GrabIcon,
  StopIcon,
  DrawIcon,
  PauseIcon,
  ResumeIcon,
  CursorIcon,
  MicIcon,
  RestartIcon,
  DiscardIcon,
  EyeDropperIcon,
  Stroke1Icon,
  Stroke2Icon,
  Stroke3Icon,
  TargetCursorIcon,
  HighlightCursorIcon,
  HideCursorIcon,
  TextIcon,
  ArrowIcon,
  EraserIcon,
  UndoIcon,
  RedoIcon,
  ImageIcon,
  TransformIcon,
  HighlighterIcon,
  RectangleIcon,
  CircleIcon,
  TriangleIcon,
  RectangleFilledIcon,
  CircleFilledIcon,
  TriangleFilledIcon,
  TrashIcon,
  VideoOffIcon,
  CameraCloseIcon,
  CameraMoreIcon,
  CameraResizeIcon,
  CameraIcon,
  BlurIcon,
  AlertIcon,
  TimeIcon,
  SpotlightCursorIcon,
  Pip,
  CloseIconPopup,
  GrabIconPopup,
  OnboardingArrow,
  NoInternet,
  CloseButtonToolbar,
  HelpIconPopup,
  MoreIconPopup,
  AudioIcon,
  NotSupportedIcon,
};
