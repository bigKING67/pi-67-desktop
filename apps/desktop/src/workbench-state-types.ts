import type { WorkspaceDescriptor } from "./workspace-identity.js";
import type { TaskLifecycle } from "./workbench-state-lifecycle.js";
import type { SessionCreationRecoveryRecord } from "./workbench-state-session-creation.js";

export const WORKBENCH_STATE_VERSION = 4 as const;

export type ConversationKey =
  | { kind: "session"; workspaceId: string; sessionFileIdentity: string; sessionPath: string }
  | { kind: "provisional"; workspaceId: string; draftId: string };

export type LegacyConversationKey =
  | { kind: "session"; workspaceId: string; sessionPath: string }
  | { kind: "provisional"; workspaceId: string; draftId: string };

export type SessionConversationKey = Extract<ConversationKey, { kind: "session" }>;

export type SettingsSection =
  | "account"
  | "general"
  | "providers"
  | "packages"
  | "extensions"
  | "skills"
  | "prompts"
  | "rules"
  | "mcp"
  | "integrations"
  | "runtime"
  | "network"
  | "updates"
  | "about";

export type WorkbenchSurface =
  | { kind: "conversation"; conversation: ConversationKey }
  | { kind: "settings" }
  | { kind: "workspace"; workspaceId: string };

export type LegacyWorkbenchSurface =
  | { kind: "conversation"; conversation: LegacyConversationKey }
  | { kind: "settings" }
  | { kind: "workspace"; workspaceId: string };

export interface RuntimeRecoveryRecordV2 {
  taskId: string;
  conversation: LegacyConversationKey;
  sessionId: string;
  taskGeneration: number;
  lastKnownLifecycle: TaskLifecycle;
}

export interface RuntimeRecoveryRecord {
  taskId: string;
  conversation: SessionConversationKey;
  sessionId: string;
  taskGeneration: number;
  sessionGeneration: number;
  hostInstanceId: string;
  hostEpoch: number;
  lastKnownLifecycle: TaskLifecycle;
}

export interface WorkbenchSettingsState {
  section: SettingsSection;
  scope: "global" | "project";
  workspaceId?: string;
}

export interface WorkbenchStateV2 {
  version: 2;
  workspaces: WorkspaceDescriptor[];
  workspaceOrder: string[];
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: LegacyWorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecordV2[];
  settings: WorkbenchSettingsState;
  cleanExit: boolean;
}

export interface WorkbenchStateV4 {
  version: typeof WORKBENCH_STATE_VERSION;
  workspaces: WorkspaceDescriptor[];
  workspaceOrder: string[];
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  sessionCreationRecovery: SessionCreationRecoveryRecord[];
  settings: WorkbenchSettingsState;
  cleanExit: boolean;
}

/** Renderer-owned fields. Main retains Workspace registrations, ordering, and clean-exit state. */
export interface WorkbenchLayoutV4 {
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  sessionCreationRecovery: SessionCreationRecoveryRecord[];
  settings: WorkbenchSettingsState;
}

interface WorkbenchLoadRecovery {
  kind: "initialized" | "corrupt-reset" | "migrated-v1" | "migrated-v2" | "migrated-v3";
  quarantinedFileName?: string;
}

export interface WorkbenchLoadResult {
  state: WorkbenchStateV4;
  recovery?: WorkbenchLoadRecovery;
}
