import { Type, Value } from "./typebox-schema.js";
import type { AgentCommandType } from "./agent-messages.js";
import { strictObject } from "./schemas.js";

export interface AppProtocolContext {
  scope: "app";
}

export interface WorkspaceProtocolContext {
  scope: "workspace";
  workspaceId: string;
}

export type TaskProtocolContext = {
  scope: "task";
  workspaceId: string;
  taskId: string;
  taskGeneration: number;
} & ({
  sessionId?: never;
  sessionGeneration?: never;
  operationId?: never;
} | {
  sessionId: string;
  sessionGeneration: number;
  operationId?: string;
});

export type ProtocolContext = AppProtocolContext | WorkspaceProtocolContext | TaskProtocolContext;

export const APP_PROTOCOL_CONTEXT: AppProtocolContext = Object.freeze({ scope: "app" });

const ProtocolIdentifierSchema = Type.String({ minLength: 1, maxLength: 512 });
export const AppProtocolContextSchema = strictObject({ scope: Type.Literal("app") });
export const WorkspaceProtocolContextSchema = strictObject({
  scope: Type.Literal("workspace"),
  workspaceId: ProtocolIdentifierSchema
});
export const TaskProtocolContextWithoutSessionSchema = strictObject({
  scope: Type.Literal("task"),
  workspaceId: ProtocolIdentifierSchema,
  taskId: ProtocolIdentifierSchema,
  taskGeneration: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
});
export const TaskProtocolContextWithSessionSchema = strictObject({
  scope: Type.Literal("task"),
  workspaceId: ProtocolIdentifierSchema,
  taskId: ProtocolIdentifierSchema,
  taskGeneration: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  sessionId: ProtocolIdentifierSchema,
  sessionGeneration: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  operationId: Type.Optional(ProtocolIdentifierSchema)
});
export const ProtocolContextSchema = Type.Union([
  AppProtocolContextSchema,
  WorkspaceProtocolContextSchema,
  TaskProtocolContextWithoutSessionSchema,
  TaskProtocolContextWithSessionSchema
]);

export const COMMAND_CONTEXT_SCOPE_REQUIREMENTS: Readonly<Partial<
  Record<AgentCommandType, ProtocolContext["scope"]>
>> = {
  "workspace.register": "workspace",
  "workspace.unregister": "workspace",
  "session.catalog.query": "workspace",
  "session.forkFromTask": "task",
  "provider.list": "workspace",
  "provider.setRuntimeKey": "workspace",
  "provider.configuration.get": "workspace",
  "provider.configuration.save": "workspace",
  "provider.configuration.remove": "workspace",
  "provider.credential.store": "workspace",
  "provider.credential.reveal": "workspace",
  "provider.credential.remove": "workspace",
  "model.default.set": "workspace",
  "provider.configuration.reload": "workspace",
  "context.file.list": "workspace",
  "context.file.read": "workspace",
  "context.file.save": "workspace",
  "workspace.file.list": "workspace",
  "workspace.file.search": "workspace",
  "workspace.file.resolve": "workspace",
  "workspace.file.open": "workspace",
  "workspace.file.save": "workspace",
  "workspace.file.create": "workspace",
  "workspace.file.rename": "workspace",
  "message.index": "task",
  "message.locate": "task",
  "task.close": "task",
  "task.toolMode.set": "task",
  "extension.package.list": "workspace",
  "extension.package.checkUpdates": "workspace",
  "extension.package.install": "workspace",
  "extension.package.update": "workspace",
  "extension.package.setEnabled": "workspace",
  "extension.package.restoreInheritance": "workspace",
  "extension.package.uninstall": "workspace",
  "skill.pack.list": "workspace",
  "skill.pack.checkUpdates": "workspace",
  "skill.pack.update": "workspace",
  "skill.pack.restore": "workspace"
};

export function hasValidCommandContext(
  type: AgentCommandType,
  context: ProtocolContext
): boolean {
  const requiredScope = COMMAND_CONTEXT_SCOPE_REQUIREMENTS[type];
  return requiredScope === undefined || context.scope === requiredScope;
}

export function isProtocolContext(value: unknown): value is ProtocolContext {
  return Value.Check(ProtocolContextSchema, value);
}

export function protocolContextsEqual(left: ProtocolContext, right: ProtocolContext): boolean {
  if (left.scope !== right.scope) return false;
  if (left.scope === "app" && right.scope === "app") return true;
  if (left.scope === "workspace" && right.scope === "workspace") {
    return left.workspaceId === right.workspaceId;
  }
  if (left.scope !== "task" || right.scope !== "task") return false;
  return left.workspaceId === right.workspaceId
    && left.taskId === right.taskId
    && left.taskGeneration === right.taskGeneration
    && left.sessionId === right.sessionId
    && left.sessionGeneration === right.sessionGeneration
    && left.operationId === right.operationId;
}
