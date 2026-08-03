import type {
  ImagePart,
  SessionMessageView,
  ToolCallPart
} from "@pi67/domain";

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
  | {
    kind: "process-group";
    key: string;
    items: TranscriptProcessItem[];
    stepCount: number;
    toolCount: number;
    failedToolCount: number;
    failed: boolean;
    hasFinalAnswer: boolean;
  };

export function projectTranscriptRows(messages: readonly SessionMessageView[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let processMessages: SessionMessageView[] = [];

  const flushProcess = (followedBy?: SessionMessageView) => {
    if (processMessages.length === 0) return;
    const items = projectProcessItems(processMessages);
    rows.push({
      kind: "process-group",
      key: `${processMessages[0]!.id}:group`,
      items,
      stepCount: Math.max(1, items.length),
      toolCount: items.filter((item) => item.kind === "tool" || item.kind === "orphan-tool-result").length,
      failedToolCount: items.filter(processItemFailed).length,
      failed: items.some(processItemFailed),
      hasFinalAnswer: followedBy?.role === "assistant" && hasVisibleAnswer(followedBy)
    });
    processMessages = [];
  };

  for (const message of messages) {
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

function processItemFailed(item: TranscriptProcessItem): boolean {
  if (item.kind === "tool") return item.call.status === "failed" || Boolean(item.result?.error);
  if (item.kind === "orphan-tool-result") return Boolean(item.result.error);
  return false;
}

function hasVisibleAnswer(message: SessionMessageView): boolean {
  return message.parts.some((part) => (
    part.type === "text" ? part.text.trim() !== "" : part.type === "image"
  ));
}

export function hasProcessGroupAfterLatestUser(rows: readonly TranscriptRow[]): boolean {
  let latestUserIndex = -1;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind === "message" && row.message.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  return rows.slice(latestUserIndex + 1).some((row) => row.kind === "process-group");
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
