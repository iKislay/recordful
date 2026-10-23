// Codes mirror recordful-agent-bridge/src/protocol/errors.ts; agents see them.
export const AgentErrorCode = {
  UnknownMethod: "UNKNOWN_METHOD",
  InvalidParams: "INVALID_PARAMS",
  AlreadyRecording: "ALREADY_RECORDING",
  NotRecording: "NOT_RECORDING",
  NoTargetTab: "NO_TARGET_TAB",
  TabNotRecordable: "TAB_NOT_RECORDABLE",
  StartFailed: "START_FAILED",
  PermissionsNeeded: "PERMISSIONS_NEEDED",
  StopFailed: "STOP_FAILED",
  Internal: "INTERNAL",
  // page tools
  NotArmed: "NOT_ARMED",
  TabNotActive: "TAB_NOT_ACTIVE",
  PageNotScriptable: "PAGE_NOT_SCRIPTABLE",
  StaleRef: "STALE_REF",
  ElementNotInteractable: "ELEMENT_NOT_INTERACTABLE",
  ElementObscured: "ELEMENT_OBSCURED",
  NavigationFailed: "NAVIGATION_FAILED",
  WaitTimeout: "WAIT_TIMEOUT",
  // uploads, videos, transcripts
  NoRecording: "NO_RECORDING",
  CloudUnavailable: "CLOUD_UNAVAILABLE",
  CloudUnreachable: "CLOUD_UNREACHABLE",
  CloudError: "CLOUD_ERROR",
  NotSignedIn: "NOT_SIGNED_IN",
  ProRequired: "PRO_REQUIRED",
  VideoNotFound: "VIDEO_NOT_FOUND",
  StorageFull: "STORAGE_FULL",
  NotUploaded: "NOT_UPLOADED",
  RateLimited: "RATE_LIMITED",
  TranscriptionUnavailable: "TRANSCRIPTION_UNAVAILABLE",
  UploadFailed: "UPLOAD_FAILED",
  UploadInterrupted: "UPLOAD_INTERRUPTED",
  // managing videos, folders and comments
  Forbidden: "FORBIDDEN",
};

export class AgentBridgeError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "AgentBridgeError";
    this.code = code;
    this.data = data;
  }
}
