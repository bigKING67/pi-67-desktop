import type { AgentRuntime } from "@pi67/pi-runtime";
import type { AgentCommand } from "@pi67/protocol";
import type { OperationRegistry } from "./operation-registry.js";
import { textOperationSubmissionIdentity } from "./operation-submission-identity.js";
import { HostCommandError } from "./protocol-error.js";

export function dispatchSessionRecoveryCommand(
  runtime: AgentRuntime,
  command: Extract<AgentCommand, { type: "session.recovery.inspect" | "session.recovery.continue" }>,
  operations: () => OperationRegistry,
  submissionFingerprint?: string
) {
  if (command.type === "session.recovery.inspect") {
    if (!runtime.getInterruptedTask) throw new HostCommandError("INVALID_PAYLOAD", "Interrupted task inspection is unavailable.", true);
    return runtime.getInterruptedTask();
  }
  if (!runtime.continueInterruptedTask) throw new HostCommandError("INVALID_PAYLOAD", "Interrupted task continuation is unavailable.", true);
  const continueTask = runtime.continueInterruptedTask.bind(runtime);
  const submission = textOperationSubmissionIdentity(command.payload.submissionId, command.type, command.payload.anchor);
  return operations().accept({
    submissionId: submission.submissionId,
    fingerprint: submissionFingerprint ?? submission.fingerprint,
    kind: "prompt",
    execute: ({ signal }) => continueTask(command.payload.anchor, signal),
    abort: () => runtime.abort(),
    beforeTerminal: () => runtime.flushStream()
  });
}
