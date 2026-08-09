import {
  isReplaySafeControlMutation,
  ProtocolRequestError,
  type AgentCommandType
} from "./agent-messages.js";
import {
  EXTENSION_PACKAGE_REQUEST_TIMEOUT_MS,
  isWorkerBackedExtensionPackageCommand
} from "./extension-package-operation.js";

export const CONTROL_MUTATION_ACK_TIMEOUT_MS = 60_000;

function timeoutFor(type: AgentCommandType, fallback: number): number {
  if (isWorkerBackedExtensionPackageCommand(type)) return EXTENSION_PACKAGE_REQUEST_TIMEOUT_MS;
  if (isReplaySafeControlMutation(type)) return CONTROL_MUTATION_ACK_TIMEOUT_MS;
  if (type === "prompt.submit" || type === "command.invoke" || type === "session.compact" || type === "session.import") return 5_000;
  if (type === "runtime.getStatus") return 5_000;
  return fallback;
}

export function acknowledgementTimeout(
  override: number | undefined,
  type: AgentCommandType,
  fallback: number
): number {
  if (override === undefined) return timeoutFor(type, fallback);
  if (!Number.isSafeInteger(override) || override < 1_000 || override > CONTROL_MUTATION_ACK_TIMEOUT_MS) {
    throw new ProtocolRequestError({
      code: "INVALID_PAYLOAD",
      message: "Agent acknowledgement timeout is outside the supported range.",
      recoverable: false
    });
  }
  return override;
}
