import type { WorkspaceTrust } from "./runtime-state.js";
import type {
  EnvironmentMutationRecoveryRecord,
  WorkspaceEnvironmentBinding
} from "./worktree-environment.js";

export type WorkspaceId = string;
export type TaskId = string;

export type WorkspaceTrustProvenance =
  | "native-picker"
  | "user-confirmed"
  | "restored"
  | "identity-changed"
  | "indirect";

export type WorkspaceIdentityAssurance = "filesystem" | "path-only";
export type WorkspaceAvailability =
  | "available"
  | "missing"
  | "identity-changed"
  | "needs-confirmation"
  | "unavailable";

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
  lastVerifiedAt?: number;
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
      sessionFileIdentity: string;
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

export const WORKBENCH_SETTINGS_SECTIONS = [
  "account",
  "general",
  "context-memory",
  "providers",
  "packages",
  "extensions",
  "skills",
  "prompts",
  "rules",
  "lark",
  "vision",
  "integrations",
  "runtime",
  "usage",
  "network",
  "updates",
  "about"
] as const;

export type SettingsSection = (typeof WORKBENCH_SETTINGS_SECTIONS)[number];

export function isWorkbenchSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string"
    && WORKBENCH_SETTINGS_SECTIONS.some((section) => section === value);
}

export interface RuntimeRecoveryRecordV2 {
  taskId: TaskId;
  conversation: ConversationKey;
  sessionId: string;
  taskGeneration: number;
  lastKnownLifecycle: TaskLifecycle;
}

export interface SessionRef {
  workspaceId: WorkspaceId;
  sessionId: string;
  sessionFileIdentity: string;
  sessionPath: string;
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
  runtimeRecovery: RuntimeRecoveryRecordV2[];
  settings: WorkbenchSettingsState;
  cleanExit: boolean;
}

export interface RuntimeRecoveryRecord {
  taskId: TaskId;
  conversation: Extract<ConversationKey, { kind: "session" }>;
  sessionId: string;
  taskGeneration: number;
  sessionGeneration: number;
  hostInstanceId: string;
  hostEpoch: number;
  lastKnownLifecycle: TaskLifecycle;
}

export interface SessionCreationRecoveryRecord {
  taskId: TaskId;
  workspaceId: WorkspaceId;
  creationId: string;
  taskGeneration: number;
}

export interface WorkbenchStateV5 {
  version: 5;
  workspaces: WorkspaceDescriptor[];
  workspaceOrder: WorkspaceId[];
  expandedWorkspaceIds: WorkspaceId[];
  currentWorkspaceId?: WorkspaceId;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  sessionCreationRecovery: SessionCreationRecoveryRecord[];
  workspaceEnvironments: WorkspaceEnvironmentBinding[];
  environmentMutations: EnvironmentMutationRecoveryRecord[];
  settings: WorkbenchSettingsState;
  cleanExit: boolean;
}

export const MAX_RUNNING_TASKS = 8;
export const MAX_SESSION_CREATION_RECOVERY_RECORDS = 32;

export function taskConsumesRunSlot(lifecycle: TaskLifecycle): boolean {
  return lifecycle === "accepted"
    || lifecycle === "running"
    || lifecycle === "waiting-approval"
    || lifecycle === "waiting-extension-input";
}

export function taskCanBeStopped(lifecycle: TaskLifecycle): boolean {
  return taskConsumesRunSlot(lifecycle);
}

export type ConversationArchiveBlocker = "provisional" | "initializing" | "active-task" | "draft";

export function conversationArchiveBlocker(options: {
  kind: ConversationKey["kind"];
  lifecycle?: TaskLifecycle;
  hasDraft?: boolean;
}): ConversationArchiveBlocker | undefined {
  if (options.kind === "provisional") return "provisional";
  if (options.lifecycle === "initializing") return "initializing";
  if (options.lifecycle !== undefined && taskConsumesRunSlot(options.lifecycle)) return "active-task";
  if (options.hasDraft) return "draft";
  return undefined;
}

export function conversationKeyIdentity(conversation: ConversationKey): string {
  return conversation.kind === "session"
    ? `session:${conversation.workspaceId}:${conversation.sessionFileIdentity}`
    : `provisional:${conversation.workspaceId}:${conversation.draftId}`;
}
