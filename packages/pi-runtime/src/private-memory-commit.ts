import type { AgentSessionServices, EventBus } from "@earendil-works/pi-coding-agent";
import { RuntimeError, type ContextSessionStatus } from "@pi67/domain";

export interface PrivateMemoryCommitResult {
  status: string; archived: boolean; task_id?: string;
  reason?: "all_within_keep_window" | "no_messages";
  extraction?: "completed" | "failed" | "unconfirmed";
}
type Commit = (request: { sessionId: string; canCommit: () => boolean }) => Promise<PrivateMemoryCommitResult>;
const buses = new WeakMap<AgentSessionServices, EventBus>();
const pending = new WeakSet<AgentSessionServices>();

export function bindPrivateMemoryCommitBus(services: AgentSessionServices, bus: EventBus): void {
  buses.set(services, bus);
}

/** Uses the admitted memory owner's Pi bus, never a second HTTP or Session path. */
export async function requestPrivateMemoryCommit(
  services: AgentSessionServices, sessionId: string, canCommit: () => boolean
): Promise<PrivateMemoryCommitResult> {
  if (!canCommit() || pending.has(services)) throw unavailable();
  const owners: Commit[] = [];
  buses.get(services)?.emit("pi67:private-memory:commit", {
    provide: (commit: Commit) => { if (typeof commit === "function") owners.push(commit); }
  });
  // Select before invoking anything; duplicate owners must cause zero writes.
  if (owners.length !== 1 || !canCommit()) throw unavailable();
  pending.add(services);
  try {
    const result = await owners[0]!({ sessionId, canCommit });
    if (!result || typeof result.status !== "string" || typeof result.archived !== "boolean"
      || (result.task_id !== undefined && (typeof result.task_id !== "string" || result.task_id.length > 512))) {
      throw unavailable();
    }
    return { status: result.status, archived: result.archived,
      ...(result.reason === "all_within_keep_window" || result.reason === "no_messages" ? { reason: result.reason } : {}),
      ...(result.archived && ["completed", "failed", "unconfirmed"].includes(result.extraction ?? "") ? { extraction: result.extraction! } : {}),
      ...(result.task_id === undefined ? {} : { task_id: result.task_id }) };
  } finally {
    pending.delete(services);
  }
}

function unavailable(): RuntimeError {
  return new RuntimeError("RUNTIME_NOT_READY", "Private memory Commit requires one available memory owner and the current idle Session.");
}

/** Read metadata through the current owner, which alone knows its OV lineage. */
export async function inspectPrivateMemorySession(
  services: AgentSessionServices, sessionId: string, isCurrent: () => boolean
): Promise<ContextSessionStatus> {
  type Inspect = (request: { sessionId: string; isCurrent: () => boolean }) => Promise<ContextSessionStatus>;
  const owners: Inspect[] = [];
  const unavailable = () => new RuntimeError("RUNTIME_NOT_READY", "Private memory Session metadata requires one available memory owner and the current Session.");
  if (!isCurrent()) throw unavailable();
  buses.get(services)?.emit("pi67:private-memory:inspect", {
    provide: (inspect: Inspect) => { if (typeof inspect === "function") owners.push(inspect); }
  });
  if (owners.length !== 1 || !isCurrent()) throw unavailable();
  const result = await owners[0]!({ sessionId, isCurrent });
  if (!isCurrent() || !result || result.sessionId !== sessionId || result.owner !== "pi67-openviking"
    || !["private-learning", "full-learning", "read-only", "off"].includes(result.privacyMode)
    || ![result.capturedTurns, result.pendingTokens, result.liveTailTurns].every(value => Number.isSafeInteger(value) && value >= 0)
    || typeof result.takeoverActive !== "boolean"
    || (result.lastCommitAt !== undefined && !Number.isFinite(result.lastCommitAt))) throw unavailable();
  return { sessionId, owner: result.owner, privacyMode: result.privacyMode,
    capturedTurns: result.capturedTurns, pendingTokens: result.pendingTokens,
    liveTailTurns: result.liveTailTurns, takeoverActive: result.takeoverActive,
    ...(result.lastCommitAt === undefined ? {} : { lastCommitAt: result.lastCommitAt }) };
}
