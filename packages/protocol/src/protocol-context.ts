import { strictObject, Type, Value } from "./typebox-schema.js";
import type { AgentCommandType } from "./agent-messages.js";

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
  sessionFileIdentity?: never;
  sessionGeneration?: never;
  operationId?: never;
} | {
  sessionId: string;
  sessionFileIdentity: string;
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
  sessionFileIdentity: ProtocolIdentifierSchema,
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
  "session.catalog.contentSearch": "workspace",
  "workspace.usage.report": "workspace",
  "session.creation.resolve": "workspace",
  "session.nameByPath": "workspace",
  "conversation.pin": "workspace",
  "conversation.archive": "workspace",
  "conversation.snooze": "workspace",
  "conversation.reorderPinned": "workspace",
  "session.forkFromTask": "task",
  "provider.list": "workspace",
  "provider.setRuntimeKey": "workspace",
  "provider.configuration.get": "app",
  "provider.configuration.save": "app",
  "provider.configuration.remove": "app",
  "provider.credential.store": "app",
  "provider.credential.reveal": "app",
  "provider.credential.remove": "app",
  "model.default.set": "app",
  "provider.configuration.reload": "app",
  "provider.modelCatalog.refresh": "app",
  "provider.projectConfiguration.get": "workspace",
  "provider.projectConfiguration.reload": "workspace",
  "model.projectDefault.set": "workspace",
  "vision.assistant.global.set": "app",
  "vision.assistant.project.set": "workspace",
  "context.file.list": "workspace",
  "context.file.read": "workspace",
  "context.file.save": "workspace",
  "workspace.file.list": "workspace",
  "workspace.file.search": "workspace",
  "workspace.file.contentSearch": "workspace",
  "workspace.file.resolve": "workspace",
  "workspace.file.open": "workspace",
  "workspace.file.save": "workspace",
  "workspace.file.create": "workspace",
  "workspace.file.rename": "workspace",
  "message.index": "task",
  "message.search": "task",
  "message.locate": "task",
  "task.close": "task",
  "task.toolMode.set": "task",
  "subagent.list": "task",
  "subagent.status": "task",
  "subagent.wait": "task",
  "subagent.steer": "task",
  "subagent.stop": "task",
  "subagent.resume": "task",
  "session.interactionMode.set": "task",
  "session.title.regenerate": "task",
  "plan.implement": "task",
  "extension.package.list": "workspace",
  "extension.package.checkUpdates": "workspace",
  "extension.package.install": "workspace",
  "extension.package.update": "workspace",
  "extension.package.approveObserved": "workspace",
  "extension.package.onboarding.get": "workspace",
  "extension.package.onboarding.decline": "workspace",
  "extension.package.setEnabled": "workspace",
  "extension.package.restoreInheritance": "workspace",
  "extension.package.uninstall": "workspace",
  "skill.pack.list": "workspace",
  "skill.pack.checkUpdates": "workspace",
  "skill.pack.install": "workspace",
  "skill.pack.update": "workspace",
  "skill.pack.restore": "workspace",
  "lark.auth.status": "app",
  "lark.auth.login.begin": "app",
  "lark.app.configuration.save": "app",
  "context.status.get": "app",
  "context.config.get": "app",
  "context.config.update": "app",
  "context.runtime.doctor": "app",
  "enterprise.identity.get": "app",
  "enterprise.auth.begin": "app",
  "enterprise.auth.poll": "app",
  "enterprise.auth.disconnect": "app",
  "enterprise.project.list": "app",
  "context.session.get": "workspace",
  "context.session.commit": "workspace",
  "context.recall.list": "workspace",
  "context.recall.feedback": "workspace",
  "context.recall.metrics": "workspace",
  "memory.search": "workspace",
  "memory.get": "workspace",
  "memory.forget.preview": "workspace",
  "memory.forget.confirm": "workspace",
  "experience.private.list": "workspace",
  "experience.candidate.get": "workspace",
  "experience.candidate.review": "workspace",
  "experience.candidate.promote": "workspace",
  "experience.candidate.reject": "workspace",
  "experience.shared.search": "workspace",
  "experience.shared.get": "workspace",
  "sop.shared.search": "workspace",
  "sop.shared.get": "workspace",
  "enterprise.workspace.get": "workspace",
  "enterprise.workspace.bind": "workspace",
  "enterprise.workspace.unbind": "workspace"
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
    && left.sessionFileIdentity === right.sessionFileIdentity
    && left.sessionGeneration === right.sessionGeneration
    && left.operationId === right.operationId;
}
