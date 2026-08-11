export const MAX_NATIVE_SUBAGENT_TASK_CHARS = 32_768;
export const MAX_NATIVE_SUBAGENT_STEER_CHARS = 16_384;
export const MAX_NATIVE_SUBAGENT_RESULT_CHARS = 32_768;
export const MAX_NATIVE_SUBAGENT_ERROR_CHARS = 4_096;
export const MAX_NATIVE_SUBAGENT_LIVE_GLOBAL = 8;
export const MAX_NATIVE_SUBAGENT_LIVE_PER_PARENT = 4;
export const MAX_NATIVE_SUBAGENT_SPAWN_BATCH = 4;
export const MAX_NATIVE_SUBAGENT_NESTING_DEPTH = 2;
export const MAX_NATIVE_SUBAGENT_WAIT_MS = 300_000;

export type NativeSubagentRole = "explorer" | "worker" | "reviewer" | "general";
export type NativeSubagentMode = "foreground" | "background";
export type NativeSubagentContext = "fresh" | "fork";
export type NativeSubagentIsolation = "shared" | "worktree";
export type NativeSubagentReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type NativeSubagentState =
  | "pending"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type NativeSubagentChangeReason =
  | "spawned"
  | "started"
  | "completed"
  | "failed"
  | "stopped"
  | "resumed"
  | "steered"
  | "recovered"
  | "interrupted";

export interface NativeSubagentModelSelection {
  provider: string;
  id: string;
}

export interface NativeSubagentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/** Stable child identity and the current activation used for event attribution. */
export interface NativeSubagentLineage {
  runId: string;
  childId: string;
  activationId: string;
  parentChildId?: string;
  depth: number;
  role: NativeSubagentRole;
}

export interface NativeSubagentView extends NativeSubagentLineage {
  state: NativeSubagentState;
  mode: NativeSubagentMode;
  context: NativeSubagentContext;
  isolation: NativeSubagentIsolation;
  model?: NativeSubagentModelSelection;
  reasoning?: NativeSubagentReasoningLevel;
  cwd?: string;
  worktreePath?: string;
  sessionPath?: string;
  startedAt?: number;
  updatedAt: number;
  settledAt?: number;
  result?: string;
  error?: string;
  usage?: NativeSubagentUsage;
}

export interface NativeSubagentSpawnRequest {
  task: string;
  role?: NativeSubagentRole;
  mode?: NativeSubagentMode;
  context?: NativeSubagentContext;
  isolation?: NativeSubagentIsolation;
  model?: NativeSubagentModelSelection;
  reasoning?: NativeSubagentReasoningLevel;
}

export interface NativeSubagentWaitResult {
  items: NativeSubagentView[];
  timedOut: boolean;
}

export function isNativeSubagentTerminalState(state: NativeSubagentState): boolean {
  return state === "completed"
    || state === "failed"
    || state === "cancelled"
    || state === "interrupted";
}
