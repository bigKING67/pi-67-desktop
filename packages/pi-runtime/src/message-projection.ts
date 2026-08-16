import {
  sessionEntryToContextMessages,
  type SessionEntry,
  type SessionManager
} from "@earendil-works/pi-coding-agent";
import {
  MAX_CONVERSATION_PAGE_JSON_BYTES,
  parseActiveProposedPlan,
  parsePlanDecision,
  parsePlanImplementation,
  type ConversationPage,
  type ExtensionToolAdapterView,
  type PlanProposalStatus,
  type SessionMessageView,
  type ToolExecutionView
} from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import {
  normalizeMessagesWithAdapters,
  type ImageAssetProjector
} from "./message-normalizer.js";
import {
  PLAN_DECISION_ENTRY_TYPE,
  PLAN_IMPLEMENTATION_ENTRY_TYPE,
  PROPOSED_PLAN_ENTRY_TYPE
} from "./plan-mode-controller.js";
import {
  parseVisionAssistanceEvidence,
  VISION_ASSISTANCE_ENTRY_TYPE
} from "./vision-assistance.js";

export const DEFAULT_MESSAGE_PAGE_SIZE = 100;
export const MAX_MESSAGE_PAGE_SIZE = 200;

export interface MessagePageOptions {
  direction?: "older" | "newer";
  cursor?: string;
  limit?: number;
}

type MessageSessionManager = Pick<SessionManager, "getBranch" | "getSessionId"> & {
  findBranchEntryIndex?(id: string): number | undefined;
};

export function projectMessagePage(
  sessionManager: MessageSessionManager,
  options: MessagePageOptions = {},
  resolveToolAdapter?: (toolCallId: string) => ExtensionToolAdapterView | undefined,
  projectImageAsset?: ImageAssetProjector,
  resolveToolExecution?: (toolCallId: string) => ToolExecutionView | undefined
): ConversationPage {
  const entries = sessionManager.getBranch();
  const planStatuses = projectPlanProposalStatuses(entries);
  const direction = options.direction ?? "older";
  const limit = Math.min(MAX_MESSAGE_PAGE_SIZE, Math.max(1, options.limit ?? DEFAULT_MESSAGE_PAGE_SIZE));
  const locatedCursorIndex = options.cursor === undefined
    ? undefined
    : sessionManager.findBranchEntryIndex?.(options.cursor)
      ?? entries.findIndex((entry) => entry.id === options.cursor);
  const cursorEntryIndex = locatedCursorIndex === -1 ? undefined : locatedCursorIndex;
  const cursorEntry = cursorEntryIndex === undefined ? undefined : entries[cursorEntryIndex];
  if (
    (options.cursor !== undefined && locatedCursorIndex === -1)
    || (cursorEntryIndex !== undefined && (
      !cursorEntry
      || !projectEntryRecord(cursorEntry, cursorEntryIndex, planStatuses)
    ))
  ) {
    throw new ProtocolRequestError({
      code: "INVALID_PAYLOAD",
      message: "The message page cursor does not exist in the active session branch.",
      recoverable: true
    });
  }

  const collectedPage = direction === "older"
    ? collectOlder(entries, cursorEntryIndex ?? entries.length, limit, planStatuses)
    : collectNewer(entries, cursorEntryIndex === undefined ? 0 : cursorEntryIndex + 1, limit, planStatuses);
  const normalizedMessages = normalizeMessagesWithAdapters(
    collectedPage.filter(isContextMessageRecord).map((record) => record.message),
    collectedPage.filter(isContextMessageRecord).map((record) => record.id),
    resolveToolAdapter,
    projectImageAsset,
    resolveToolExecution
  );
  let normalizedIndex = 0;
  const normalized = collectedPage.map((record) => (
    record.kind === "projected"
      ? record.message
      : normalizedMessages[normalizedIndex++]!
  ));
  const bounded = fitPageToByteBudget(collectedPage, normalized, direction);
  const page = bounded.records;
  const first = page[0];
  const last = page.at(-1);
  const hasOlder = direction === "older"
    ? bounded.truncated || hasVisibleEntry(
      entries,
      0,
      first?.entryIndex ?? (cursorEntryIndex ?? entries.length),
      planStatuses
    )
    : cursorEntryIndex !== undefined && hasVisibleEntry(entries, 0, cursorEntryIndex + 1, planStatuses);
  const hasNewer = direction === "older"
    ? cursorEntryIndex !== undefined && hasVisibleEntry(entries, cursorEntryIndex, entries.length, planStatuses)
    : bounded.truncated || hasVisibleEntry(
      entries,
      (last?.entryIndex ?? cursorEntryIndex ?? -1) + 1,
      entries.length,
      planStatuses
    );
  return {
    sessionId: sessionManager.getSessionId(),
    messages: bounded.messages,
    ...(first === undefined ? {} : { startCursor: first.id }),
    ...(last === undefined ? {} : { endCursor: last.id }),
    hasOlder,
    hasNewer
  };
}

function fitPageToByteBudget(
  records: MessageEntryRecord[],
  messages: ReturnType<typeof normalizeMessagesWithAdapters>,
  direction: "older" | "newer"
): { records: MessageEntryRecord[]; messages: ReturnType<typeof normalizeMessagesWithAdapters>; truncated: boolean } {
  let bytes = 512;
  if (direction === "newer") {
    let end = 0;
    while (end < messages.length) {
      const nextBytes = projectedJsonBytes(messages[end]);
      if (end > 0 && bytes + nextBytes > MAX_CONVERSATION_PAGE_JSON_BYTES) break;
      bytes += nextBytes;
      end += 1;
    }
    return { records: records.slice(0, end), messages: messages.slice(0, end), truncated: end < records.length };
  }

  let start = messages.length;
  while (start > 0) {
    const nextBytes = projectedJsonBytes(messages[start - 1]);
    if (start < messages.length && bytes + nextBytes > MAX_CONVERSATION_PAGE_JSON_BYTES) break;
    bytes += nextBytes;
    start -= 1;
  }
  return { records: records.slice(start), messages: messages.slice(start), truncated: start > 0 };
}

function projectedJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8") + 1;
}

type MessageEntryRecord = ContextMessageEntryRecord | ProjectedEntryRecord;

interface ContextMessageEntryRecord {
  kind: "message";
  id: string;
  message: unknown;
  entryIndex: number;
}

interface ProjectedEntryRecord {
  kind: "projected";
  id: string;
  message: SessionMessageView;
  entryIndex: number;
}

function collectOlder(
  entries: SessionEntry[],
  end: number,
  limit: number,
  planStatuses: ReadonlyMap<number, PlanProposalStatus>
): MessageEntryRecord[] {
  const records: MessageEntryRecord[] = [];
  for (let index = end - 1; index >= 0 && records.length < limit; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    const record = projectEntryRecord(entry, index, planStatuses);
    if (record) records.push(record);
  }
  records.reverse();
  return records;
}

function collectNewer(
  entries: SessionEntry[],
  start: number,
  limit: number,
  planStatuses: ReadonlyMap<number, PlanProposalStatus>
): MessageEntryRecord[] {
  const records: MessageEntryRecord[] = [];
  for (let index = start; index < entries.length && records.length < limit; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const record = projectEntryRecord(entry, index, planStatuses);
    if (record) records.push(record);
  }
  return records;
}

function hasVisibleEntry(
  entries: SessionEntry[],
  start: number,
  end: number,
  planStatuses: ReadonlyMap<number, PlanProposalStatus>
): boolean {
  for (let index = Math.max(0, start); index < Math.min(end, entries.length); index += 1) {
    const entry = entries[index];
    if (entry && projectEntryRecord(entry, index, planStatuses)) return true;
  }
  return false;
}

function projectEntryRecord(
  entry: SessionEntry,
  entryIndex: number,
  planStatuses: ReadonlyMap<number, PlanProposalStatus>
): MessageEntryRecord | undefined {
  if (entry.type === "custom" && entry.customType === VISION_ASSISTANCE_ENTRY_TYPE) {
    const evidence = parseVisionAssistanceEvidence(entry.data);
    if (!evidence) return undefined;
    return {
      kind: "projected",
      id: entry.id,
      entryIndex,
      message: {
        id: entry.id,
        role: "system",
        createdAt: evidence.createdAt,
        parts: [{
          type: "vision-evidence",
          provider: evidence.provider,
          model: evidence.model,
          attachments: evidence.attachments,
          description: evidence.description,
          inputTokens: evidence.usage.input,
          outputTokens: evidence.usage.output,
          totalTokens: evidence.usage.totalTokens,
          totalCost: evidence.usage.cost.total
        }]
      }
    };
  }
  if (entry.type === "custom" && entry.customType === PROPOSED_PLAN_ENTRY_TYPE) {
    const plan = parseActiveProposedPlan(entry.data);
    const status = planStatuses.get(entryIndex);
    if (!plan || !status) return undefined;
    return {
      kind: "projected",
      id: entry.id,
      entryIndex,
      message: {
        id: entry.id,
        role: "system",
        createdAt: plan.createdAt,
        parts: [{
          type: "plan-proposal",
          plan: { ...plan, entryId: entry.id, status }
        }]
      }
    };
  }
  if (entry.type === "custom_message" && !entry.display) return undefined;
  const [message] = sessionEntryToContextMessages(entry);
  return message === undefined ? undefined : {
    kind: "message",
    id: entry.id,
    message,
    entryIndex
  };
}

function isContextMessageRecord(record: MessageEntryRecord): record is ContextMessageEntryRecord {
  return record.kind === "message";
}

function projectPlanProposalStatuses(entries: readonly SessionEntry[]): ReadonlyMap<number, PlanProposalStatus> {
  const statuses = new Map<number, PlanProposalStatus>();
  let active: { entryIndex: number; planId: string } | undefined;
  for (const [entryIndex, entry] of entries.entries()) {
    if (entry.type !== "custom") continue;
    if (entry.customType === PROPOSED_PLAN_ENTRY_TYPE) {
      const plan = parseActiveProposedPlan(entry.data);
      if (!plan) continue;
      if (active) statuses.set(active.entryIndex, "dismissed");
      statuses.set(entryIndex, "proposed");
      active = { entryIndex, planId: plan.planId };
      continue;
    }
    if (entry.customType === PLAN_IMPLEMENTATION_ENTRY_TYPE) {
      const implementation = parsePlanImplementation(entry.data);
      if (
        implementation?.phase === "started"
        && active
        && implementation.planId === active.planId
      ) {
        statuses.set(active.entryIndex, "implemented");
        active = undefined;
      }
      continue;
    }
    if (entry.customType !== PLAN_DECISION_ENTRY_TYPE) continue;
    const decision = parsePlanDecision(entry.data);
    if (!decision || !active || decision.planId !== active.planId) continue;
    statuses.set(active.entryIndex, decision.decision === "implement" ? "implemented" : "dismissed");
    active = undefined;
  }
  return statuses;
}
