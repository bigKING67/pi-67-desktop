import type { WorkspaceDescriptor } from "./workspace-identity.js";
import type {
  EnvironmentMutationRecoveryRecord,
  WorkspaceEnvironmentBinding
} from "@pi67/protocol";
import type { TaskLifecycle } from "./workbench-state-lifecycle.js";
import type { SessionCreationRecoveryRecord } from "./workbench-state-session-creation.js";

export const WORKBENCH_STATE_VERSION = 5 as const;

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
  version: 4;
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

export interface WorkbenchStateV5 extends Omit<WorkbenchStateV4, "version"> {
  version: typeof WORKBENCH_STATE_VERSION;
  workspaceEnvironments: WorkspaceEnvironmentBinding[];
  environmentMutations: EnvironmentMutationRecoveryRecord[];
}

/** Renderer-owned fields. Main retains Workspace registrations, ordering, and clean-exit state. */
export interface WorkbenchLayoutV5 {
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  sessionCreationRecovery: SessionCreationRecoveryRecord[];
  settings: WorkbenchSettingsState;
}

interface WorkbenchLoadRecovery {
  kind: "initialized" | "corrupt-reset" | "migrated-v1" | "migrated-v2" | "migrated-v3" | "migrated-v4";
  quarantinedFileName?: string;
}

export interface WorkbenchLoadResult {
  state: WorkbenchStateV5;
  recovery?: WorkbenchLoadRecovery;
}
