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
};

export class AgentBridgeError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "AgentBridgeError";
    this.code = code;
    this.data = data;
  }
}
