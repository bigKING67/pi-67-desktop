import type { AgentCommandType } from "./agent-messages.js";

export const REPLAY_SAFE_CONTROL_MUTATION_TYPES = [
  "runtime.initialize",
  "workspace.open",
  "workspace.register",
  "workspace.unregister",
  "workspace.setTrust",
  "task.close",
  "session.create",
  "session.open",
  "session.fork",
  "session.forkFromTask",
  "session.rollback",
  "session.name",
  "session.interactionMode.set",
  "session.nameByPath",
  "conversation.pin",
  "conversation.archive",
  "conversation.snooze",
  "conversation.reorderPinned",
  "model.select",
  "model.setRuntimeKey",
  "provider.setRuntimeKey",
  "provider.configuration.save",
  "provider.configuration.remove",
  "provider.credential.store",
  "provider.credential.remove",
  "model.default.set",
  "model.projectDefault.set",
  "vision.assistant.global.set",
  "vision.assistant.project.set",
  "thinking.set",
  "resource.reload",
  "context.file.save",
  "workspace.file.save",
  "workspace.file.create",
  "workspace.file.rename",
  "extension.package.install",
  "extension.package.update",
  "extension.package.approveObserved",
  "extension.package.onboarding.decline",
  "extension.package.setEnabled",
  "extension.package.restoreInheritance",
  "extension.package.uninstall",
  "skill.pack.update",
  "skill.pack.install",
  "skill.pack.restore"
] as const satisfies readonly AgentCommandType[];

export type ReplaySafeControlMutationType = typeof REPLAY_SAFE_CONTROL_MUTATION_TYPES[number];

const REPLAY_SAFE_CONTROL_MUTATIONS = new Set<AgentCommandType>(REPLAY_SAFE_CONTROL_MUTATION_TYPES);

export function isReplaySafeControlMutation(
  type: AgentCommandType
): type is ReplaySafeControlMutationType {
  return REPLAY_SAFE_CONTROL_MUTATIONS.has(type);
}

export const REPLAY_SAFE_OPERATION_ACK_TYPES = [
  "session.import",
  "session.compact",
  "plan.implement",
  "command.invoke"
] as const satisfies readonly AgentCommandType[];

export type ReplaySafeOperationAckType = typeof REPLAY_SAFE_OPERATION_ACK_TYPES[number];

const REPLAY_SAFE_OPERATION_ACKS = new Set<AgentCommandType>(REPLAY_SAFE_OPERATION_ACK_TYPES);

export function isReplaySafeOperationAck(
  type: AgentCommandType
): type is ReplaySafeOperationAckType {
  return REPLAY_SAFE_OPERATION_ACKS.has(type);
}
