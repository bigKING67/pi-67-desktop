import type { WorkspaceTrust } from "./runtime-state.js";

export type WorkspaceId = string;
export type TaskId = string;

export type WorkspaceTrustProvenance =
  | "native-picker"
  | "user-confirmed"
  | "restored"
  | "identity-changed"
  | "indirect";

export type WorkspaceIdentityAssurance = "filesystem" | "path-only";
export type WorkspaceAvailability = "available" | "missing" | "identity-changed" | "unavailable";

export interface WorkspacePathIdentity {
  canonicalPath: string;
  device?: string;
  inode?: string;
  birthtimeNs?: string;
  assurance: WorkspaceIdentityAssurance;
}

export interface WorkspaceDescriptor {
  id: WorkspaceId;
  displayName: string;
  identity: WorkspacePathIdentity;
  trust: WorkspaceTrust;
  trustProvenance: WorkspaceTrustProvenance;
  availability: WorkspaceAvailability;
}

export type TaskLifecycle =
  | "draft"
  | "initializing"
  | "idle"
  | "accepted"
  | "running"
  | "waiting-approval"
  | "waiting-extension-input"
  | "completed"
  | "failed"
  | "cancelled"
  | "lost"
  | "stopped";

export type ConversationKey =
  | {
      kind: "session";
      workspaceId: WorkspaceId;
      sessionPath: string;
    }
  | {
      kind: "provisional";
      workspaceId: WorkspaceId;
      draftId: string;
    };

export type WorkbenchSurface =
  | { kind: "conversation"; conversation: ConversationKey }
  | { kind: "settings" }
  | { kind: "workspace"; workspaceId: WorkspaceId };

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

export interface RuntimeRecoveryRecord {
  taskId: TaskId;
  conversation: ConversationKey;
  sessionId: string;
  taskGeneration: number;
  lastKnownLifecycle: TaskLifecycle;
}

export interface WorkbenchSettingsState {
  section: SettingsSection;
  scope: "global" | "project";
  workspaceId?: WorkspaceId;
}

export interface WorkbenchStateV2 {
  version: 2;
  workspaces: WorkspaceDescriptor[];
  workspaceOrder: WorkspaceId[];
  expandedWorkspaceIds: WorkspaceId[];
  currentWorkspaceId?: WorkspaceId;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  settings: WorkbenchSettingsState;
  cleanExit: boolean;
}

export const MAX_RUNNING_TASKS = 8;

export function taskConsumesRunSlot(lifecycle: TaskLifecycle): boolean {
  return lifecycle === "accepted"
    || lifecycle === "running"
    || lifecycle === "waiting-approval"
    || lifecycle === "waiting-extension-input";
}

export function conversationKeyIdentity(conversation: ConversationKey): string {
  return conversation.kind === "session"
    ? `session:${conversation.workspaceId}:${conversation.sessionPath}`
    : `provisional:${conversation.workspaceId}:${conversation.draftId}`;
}
