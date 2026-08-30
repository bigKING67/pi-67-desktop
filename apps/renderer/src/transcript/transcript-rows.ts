import type {
  ImagePart,
  OperationView,
  PlanProposalTimelineView,
  SessionMessageView,
  ToolCallPart
} from "@pi67/domain";
import { isUnsuccessfulToolStatus } from "@pi67/domain";

export type ProcessGroupOutcome =
  | "running"
  | "completed"
  | "completed-with-warnings"
  | "failed"
  | "cancelled"
  | "lost"
  | "incomplete";

export type TranscriptProcessItem =
  | {
    kind: "reasoning";
    key: string;
    text: string;
    createdAt?: number;
  }
  | {
    kind: "narration";
    key: string;
    content: string | ImagePart;
    createdAt?: number;
  }
  | {
    kind: "tool";
    key: string;
    call: ToolCallPart;
    result?: SessionMessageView;
    createdAt?: number;
  }
  | {
    kind: "orphan-tool-result";
    key: string;
    result: SessionMessageView;
  };

export type TranscriptRow =
  | { kind: "message"; key: string; message: SessionMessageView }
  | { kind: "plan-proposal"; key: string; plan: PlanProposalTimelineView }
  | {
    kind: "process-group";
    key: string;
    sourceMessageIds: string[];
    items: TranscriptProcessItem[];
    stepCount: number;
    toolCount: number;
    unsuccessfulToolCount: number;
    outcome: ProcessGroupOutcome;
    hasFinalAnswer: boolean;
  };

export function projectTranscriptRows(messages: readonly SessionMessageView[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let processMessages: SessionMessageView[] = [];

  const flushProcess = (followedBy?: SessionMessageView) => {
    if (processMessages.length === 0) return;
    const items = projectProcessItems(processMessages);
    const unsuccessfulToolCount = items.filter(processItemUnsuccessful).length;
    const hasFinalAnswer = followedBy?.role === "assistant" && hasVisibleAnswer(followedBy);
    rows.push({
      kind: "process-group",
      key: `${processMessages[0]!.id}:group`,
      sourceMessageIds: processMessages.map((message) => message.id),
      items,
      stepCount: Math.max(1, items.length),
      toolCount: items.filter((item) => item.kind === "tool" || item.kind === "orphan-tool-result").length,
      unsuccessfulToolCount,
      outcome: hasFinalAnswer
        ? unsuccessfulToolCount > 0 ? "completed-with-warnings" : "completed"
        : "incomplete",
      hasFinalAnswer
    });
    processMessages = [];
  };

  for (const message of messages) {
    const plan = message.parts.find((part) => part.type === "plan-proposal")?.plan;
    if (plan) {
      flushProcess();
      rows.push({ kind: "plan-proposal", key: plan.entryId, plan });
      continue;
    }
    for (const segment of splitAssistantResult(message)) {
      if (isProcessMessage(segment)) {
        processMessages.push(segment);
        continue;
      }
      flushProcess(segment);
      rows.push({ kind: "message", key: segment.id, message: segment });
    }
  }
  flushProcess();
  return rows;
}

function projectProcessItems(messages: readonly SessionMessageView[]): TranscriptProcessItem[] {
  const items: TranscriptProcessItem[] = [];
  const toolItemIndexes = new Map<string, number>();

  for (const message of messages) {
    if (message.role === "tool") {
      const toolIndex = toolItemIndexes.get(message.id);
      if (toolIndex !== undefined) {
        const matched = items[toolIndex];
        if (matched?.kind === "tool" && matched.result === undefined) {
          items[toolIndex] = { ...matched, result: message };
          continue;
        }
      }
      items.push({
        kind: "orphan-tool-result",
        key: `${message.id}:orphan-result:${items.length}`,
        result: message
      });
      continue;
    }

    for (const [partIndex, part] of message.parts.entries()) {
      if (part.type === "thinking") {
        if (part.text.trim() === "") continue;
        items.push({
          kind: "reasoning",
          key: `${message.id}:reasoning:${partIndex}`,
          text: part.text,
          ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt })
        });
        continue;
      }
      if (part.type === "text") {
        if (part.text.trim() === "") continue;
        items.push({
          kind: "narration",
          key: `${message.id}:narration:${partIndex}`,
          content: part.text,
          ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt })
        });
        continue;
      }
      if (part.type === "image") {
        items.push({
          kind: "narration",
          key: `${message.id}:image:${partIndex}`,
          content: part,
          ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt })
        });
        continue;
      }
      if (part.type !== "tool-call") continue;
      const index = items.length;
      items.push({
        kind: "tool",
        key: part.id,
        call: part,
        ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt })
      });
      if (!toolItemIndexes.has(part.id)) toolItemIndexes.set(part.id, index);
    }
  }

  return items;
}

function processItemUnsuccessful(item: TranscriptProcessItem): boolean {
  if (item.kind === "tool") return isUnsuccessfulToolStatus(item.call.status) || Boolean(item.result?.error);
  if (item.kind === "orphan-tool-result") return Boolean(item.result.error);
  return false;
}

function hasVisibleAnswer(message: SessionMessageView): boolean {
  return message.parts.some((part) => (
    part.type === "text" ? part.text.trim() !== "" : part.type === "image"
  ));
}

export function hasProcessGroupAfterLatestUser(rows: readonly TranscriptRow[]): boolean {
  const latestUserIndex = findLatestUserRowIndex(rows);
  return rows.slice(latestUserIndex + 1).some((row) => row.kind === "process-group");
}

export function transcriptRowContainsMessage(row: TranscriptRow, messageId: string): boolean {
  return row.kind === "message"
    ? row.message.id === messageId
    : row.kind === "process-group" && row.sourceMessageIds.includes(messageId);
}

export function findTranscriptRowIndexByMessageId(
  rows: readonly TranscriptRow[],
  messageId: string
): number {
  return rows.findIndex((row) => transcriptRowContainsMessage(row, messageId));
}

export function hasFinalAnswerAfterLatestUser(rows: readonly TranscriptRow[]): boolean {
  const latestUserIndex = findLatestUserRowIndex(rows);
  if (latestUserIndex < 0) return false;
  return rows.slice(latestUserIndex + 1).some((row) => (
    row.kind === "message"
    && row.message.role === "assistant"
    && row.message.error === undefined
    && hasVisibleAnswer(row.message)
  ));
}

export function createLiveProcessRow(
  operation: OperationView,
  hasFinalAnswer: boolean
): Extract<TranscriptRow, { kind: "process-group" }> {
  const unsuccessfulToolCount = (operation.toolExecutions ?? [])
    .filter((execution) => isUnsuccessfulToolStatus(execution.status)).length;
  return {
    kind: "process-group",
    key: `${operation.operationId}:live-process`,
    sourceMessageIds: [],
    items: [],
    stepCount: 1,
    toolCount: 0,
    unsuccessfulToolCount,
    outcome: operation.lifecycle === "failed"
      ? "failed"
      : operation.lifecycle === "cancelled"
        ? "cancelled"
        : operation.lifecycle === "lost"
          ? "lost"
          : operation.lifecycle === "completed"
            ? hasFinalAnswer
              ? unsuccessfulToolCount > 0 ? "completed-with-warnings" : "completed"
              : "incomplete"
            : "running",
    hasFinalAnswer
  };
}

function isProcessMessage(message: SessionMessageView): boolean {
  if (message.role === "tool") return true;
  if (message.role !== "assistant" || message.error) return false;
  if (message.parts.some((part) => part.type === "tool-call")) return true;
  return message.parts.length > 0 && message.parts.every((part) => part.type === "thinking");
}

function splitAssistantResult(message: SessionMessageView): SessionMessageView[] {
  if (
    message.role !== "assistant"
    || message.error
    || message.parts.some((part) => part.type === "tool-call")
  ) return [message];

  const thinking = message.parts.filter((part) => part.type === "thinking" && part.text.trim() !== "");
  const result = message.parts.filter((part) => part.type !== "thinking");
  if (thinking.length === 0 || result.length === 0) return [message];

  return [
    { ...message, id: `${message.id}:process`, parts: thinking },
    { ...message, parts: result }
  ];
}

function findLatestUserRowIndex(rows: readonly TranscriptRow[]): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind === "message" && row.message.role === "user") return index;
  }
  return -1;
}
