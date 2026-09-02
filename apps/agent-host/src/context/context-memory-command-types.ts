import type {
  AgentCommandType,
  ContextMemoryCommandPayloads
} from "@pi67/protocol";

export type ContextMemoryAppCommandType =
  | "context.status.get"
  | "context.config.get"
  | "context.config.update"
  | "context.runtime.doctor"
  | "enterprise.identity.get"
  | "enterprise.auth.begin"
  | "enterprise.auth.poll"
  | "enterprise.auth.disconnect"
  | "enterprise.project.list";

export type ContextMemoryWorkspaceCommandType = Exclude<
  keyof ContextMemoryCommandPayloads,
  ContextMemoryAppCommandType
>;

export function isContextMemoryAppCommand(
  type: AgentCommandType
): type is ContextMemoryAppCommandType {
  return type === "context.status.get"
    || type === "context.config.get"
    || type === "context.config.update"
    || type === "context.runtime.doctor"
    || type === "enterprise.identity.get"
    || type === "enterprise.auth.begin"
    || type === "enterprise.auth.poll"
    || type === "enterprise.auth.disconnect"
    || type === "enterprise.project.list";
}

export function isContextMemoryWorkspaceCommand(
  type: AgentCommandType
): type is ContextMemoryWorkspaceCommandType {
  return type === "context.session.get"
    || type === "context.session.commit"
    || type === "context.recall.list"
    || type === "memory.search"
    || type === "memory.get"
    || type === "memory.forget.preview"
    || type === "memory.forget.confirm"
    || type === "experience.private.list"
    || type === "experience.candidate.get"
    || type === "experience.candidate.review"
    || type === "experience.candidate.promote"
    || type === "experience.candidate.reject"
    || type === "experience.shared.search"
    || type === "experience.shared.get"
    || type === "enterprise.workspace.get"
    || type === "enterprise.workspace.bind"
    || type === "enterprise.workspace.unbind";
}
