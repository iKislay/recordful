// Codes mirror recordful-agent-bridge/src/protocol/errors.ts; agents see them.
export const AgentErrorCode = {
  UnknownMethod: "UNKNOWN_METHOD",
  InvalidParams: "INVALID_PARAMS",
  AlreadyRecording: "ALREADY_RECORDING",
  NotRecording: "NOT_RECORDING",
  NoTargetTab: "NO_TARGET_TAB",
  TabNotRecordable: "TAB_NOT_RECORDABLE",
  StartFailed: "START_FAILED",
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
};

export class AgentBridgeError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "AgentBridgeError";
    this.code = code;
    this.data = data;
  }
}
