import type {
  AgentCommandType,
  CommandPayloads,
  ProtocolContext
} from "@pi67/protocol";
import { currentWorkbenchProtocolContext } from "../workbench/workbench-protocol-context.js";

export function agentConnectionRequestContext<T extends AgentCommandType>(
  type: T,
  payload: CommandPayloads[T]
): ProtocolContext {
  if (
    type === "diagnostics.collect"
    || type === "doctor.run"
    || type === "lark.auth.status"
    || type === "lark.auth.login.begin"
  ) return { scope: "app" };
  const current = currentWorkbenchProtocolContext();
  if (type === "session.catalog.query") {
    const scope = (payload as CommandPayloads["session.catalog.query"]).scope;
    if (scope === "all") return { scope: "app" };
    return current.scope === "app"
      ? current
      : { scope: "workspace", workspaceId: current.workspaceId };
  }
  if (type === "session.creation.resolve") {
    return current.scope === "app"
      ? current
      : { scope: "workspace", workspaceId: current.workspaceId };
  }
  return current;
}
