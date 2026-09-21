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
