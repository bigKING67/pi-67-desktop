import { createHash } from "node:crypto";
import type { AgentCommand } from "@pi67/protocol";

export interface OperationSubmissionIdentity {
  submissionId: string;
  fingerprint: string;
}

export function operationSubmissionIdentity(command: AgentCommand): OperationSubmissionIdentity | undefined {
  switch (command.type) {
    case "prompt.submit":
      return {
        submissionId: command.payload.submissionId,
        fingerprint: promptSubmissionFingerprint(command.payload)
      };
    case "session.import":
    case "session.compact":
    case "plan.implement":
    case "command.invoke":
      return textOperationSubmissionIdentity(
        command.payload.submissionId,
        command.type,
        command.type === "session.import"
          ? command.payload.path
          : command.type === "session.compact"
            ? command.payload.instructions ?? ""
            : command.type === "plan.implement"
              ? command.payload.planId
              : command.payload.command
      );
    default:
      return undefined;
  }
}

export function promptSubmissionFingerprint(
  payload: Extract<AgentCommand, { type: "prompt.submit" }>["payload"]
): string {
  const hash = createHash("sha256");
  const updateText = (value: string) => hash.update(value, "utf8").update("\0");
  updateText(payload.delivery);
  updateText(payload.text);
  for (const attachment of payload.attachments ?? []) updateText(attachment.id);
  for (const workspaceFile of payload.workspaceFiles ?? []) {
    updateText(workspaceFile.id);
    updateText(workspaceFile.revision);
  }
  return hash.digest("hex");
}

export function textOperationSubmissionIdentity(
  submissionId: string,
  type: "session.import" | "session.compact" | "plan.implement" | "command.invoke",
  value: string
): OperationSubmissionIdentity {
  const hash = createHash("sha256");
  hash.update(type, "utf8").update("\0").update(value, "utf8");
  return { submissionId, fingerprint: hash.digest("hex") };
}
