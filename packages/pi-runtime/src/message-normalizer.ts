import { createHash } from "node:crypto";
import {
  MAX_PROJECTED_MESSAGE_PARTS,
  MAX_PROJECTED_TEXT_BYTES,
  type AssetReference,
  type ExtensionToolAdapterView,
  type MessagePart,
  type SessionMessageView,
  type ToolExecutionView
} from "@pi67/domain";
import { projectToolFailure } from "./tool-execution-projection.js";
import {
  collectNestedToolResults,
  nestedToolResult,
  rootNestedExecution,
  type NestedToolProjection,
  type NestedToolResult
} from "./nested-tool-projection.js";
import {
  isPromptAttachmentMessage,
  mergePromptAttachments,
  normalizePromptAttachmentMessage,
  type NormalizedPromptAttachment
} from "./message-prompt-attachment-projection.js";

export interface ImageAssetSource {
  stableKey: string;
  mimeType: string;
  base64: string;
}

export type ImageAssetProjector = (source: ImageAssetSource) => AssetReference | undefined;

export function normalizeMessages(messages: readonly unknown[], stableIds: readonly string[] = []): SessionMessageView[] {
  return normalizeMessagesWithAdapters(messages, stableIds);
}

export function normalizeMessagesWithAdapters(
  messages: readonly unknown[],
  stableIds: readonly string[] = [],
  resolveToolAdapter?: (toolCallId: string) => ExtensionToolAdapterView | undefined,
  projectImageAsset?: ImageAssetProjector,
  resolveToolExecution?: (toolCallId: string) => ToolExecutionView | undefined,
  resolveNestedTools?: (rootToolCallId: string) => NestedToolProjection | undefined
): SessionMessageView[] {
  const toolResultStatuses = collectToolResultStatuses(messages);
  const nestedToolResults = collectNestedToolResults(messages);
  const normalized: SessionMessageView[] = [];
  let promptAttachments: NormalizedPromptAttachment[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (isPromptAttachmentMessage(message)) {
      const attachmentSet = normalizePromptAttachmentMessage(message);
      const nextAttachments = attachmentSet
        ? [...promptAttachments, ...attachmentSet]
        : [];
      promptAttachments = nextAttachments.length <= 20 ? nextAttachments : [];
      continue;
    }
    const projected = normalizeMessage(
      message,
      stableIds[index],
      resolveToolAdapter,
      projectImageAsset,
      resolveToolExecution,
      (toolCallId) => toolResultStatuses.get(toolCallId),
      (toolCallId) => nestedToolResults.get(toolCallId) ?? nestedToolResult(resolveNestedTools?.(toolCallId))
    );
    if (projected.role === "user" && promptAttachments.length > 0) {
      projected.parts = mergePromptAttachments(projected.parts, promptAttachments);
      promptAttachments = [];
    } else if (projected.role !== "user") {
      // Attachment metadata is turn-local and must not cross an intervening message.
      promptAttachments = [];
    }
    normalized.push(projected);
  }
  return normalized;
}

export function normalizeStreamDelta(value: unknown): {
  assistantMessageEvent: { type: "text_delta" | "thinking_delta"; delta: string };
} | undefined {
  const event = asRecord(value);
  const assistantEvent = asRecord(event.assistantMessageEvent);
  const type = assistantEvent.type;
  const delta = stringValue(assistantEvent.delta);
  if ((type !== "text_delta" && type !== "thinking_delta") || delta === undefined) return undefined;
  return { assistantMessageEvent: { type, delta } };
}

function normalizeMessage(
  value: unknown,
  stableId: string | undefined,
  resolveToolAdapter: ((toolCallId: string) => ExtensionToolAdapterView | undefined) | undefined,
  projectImageAsset: ImageAssetProjector | undefined,
  resolveToolExecution: ((toolCallId: string) => ToolExecutionView | undefined) | undefined,
  resolveToolStatus: (toolCallId: string) => ToolCallStatus | undefined,
  resolveNestedTools: (toolCallId: string) => NestedToolResult | undefined
): SessionMessageView {
  const message = asRecord(value);
  const role = normalizeRole(message.role);
  const id = stringValue(message.id) ?? stringValue(message.toolCallId) ?? stableId ?? fallbackMessageId(message);
  const parts = normalizeContent(
    message.content,
    message,
    id,
    resolveToolAdapter,
    projectImageAsset,
    resolveToolExecution,
    resolveToolStatus,
    resolveNestedTools
  );
  const createdAt = numberValue(message.timestamp) ?? numberValue(message.createdAt);
  const model = stringValue(message.model);
  const toolName = role === "tool" ? stringValue(message.toolName)?.slice(0, 128) : undefined;
  const projectedFailure = message.isError === true ? projectToolFailure(message, "pi-result") : undefined;
  const error = stringValue(message.errorMessage)
    ?? projectedFailure?.message?.text
    ?? (message.isError === true ? "Tool execution failed." : emptyAssistantResponseError(message, role, parts));
  return {
    id,
    role,
    parts: parts.length > 0 ? parts : fallbackParts(message, role),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(model === undefined ? {} : { model }),
    ...(toolName === undefined ? {} : { toolName }),
    ...(message.stopReason === "aborted" ? { stopped: true } : {}),
    ...(error === undefined ? {} : { error })
  };
}

function normalizeContent(
  content: unknown,
  message: Record<string, unknown>,
  messageId: string,
  resolveToolAdapter: ((toolCallId: string) => ExtensionToolAdapterView | undefined) | undefined,
  projectImageAsset: ImageAssetProjector | undefined,
  resolveToolExecution: ((toolCallId: string) => ToolExecutionView | undefined) | undefined,
  resolveToolStatus: (toolCallId: string) => ToolCallStatus | undefined,
  resolveNestedTools: (toolCallId: string) => NestedToolResult | undefined
): MessagePart[] {
  if (typeof content === "string") return [{ type: "text", text: boundedText(content) }];
  if (!Array.isArray(content)) {
    const toolName = stringValue(message.toolName);
    const toolCallId = stringValue(message.toolCallId) ?? toolName;
    const adapter = toolCallId === undefined ? undefined : resolveToolAdapter?.(toolCallId);
    return toolName ? [{
      type: "tool-call",
      id: toolCallId ?? toolName,
      name: toolName,
      status: message.isError ? "failed" : "completed",
      ...(adapter === undefined ? {} : { adapter })
    }] : [];
  }
  const inputLimit = Math.min(content.length, MAX_PROJECTED_MESSAGE_PARTS);
  const parts: MessagePart[] = [];
  for (let partIndex = 0; partIndex < inputLimit && parts.length < MAX_PROJECTED_MESSAGE_PARTS; partIndex += 1) {
    const part = content[partIndex];
    if (part === undefined) continue;
    // Preserve room for every original part that the historical bounded scan
    // would have considered. Nested cards must not hide later text or tools.
    const reservedForFollowingParts = inputLimit - partIndex - 1;
    const remainingParts = Math.max(1, MAX_PROJECTED_MESSAGE_PARTS - parts.length - reservedForFollowingParts);
    parts.push(...normalizePart(
      part,
      messageId,
      partIndex,
      resolveToolAdapter,
      projectImageAsset,
      resolveToolExecution,
      resolveToolStatus,
      resolveNestedTools,
      remainingParts
    ));
  }
  return parts;
}

function normalizePart(
  value: unknown,
  messageId: string,
  partIndex: number,
  resolveToolAdapter: ((toolCallId: string) => ExtensionToolAdapterView | undefined) | undefined,
  projectImageAsset: ImageAssetProjector | undefined,
  resolveToolExecution: ((toolCallId: string) => ToolExecutionView | undefined) | undefined,
  resolveToolStatus: (toolCallId: string) => ToolCallStatus | undefined,
  resolveNestedTools: (toolCallId: string) => NestedToolResult | undefined,
  remainingParts: number
): MessagePart[] {
  const part = asRecord(value);
  const type = stringValue(part.type);
  if (type === "text") return [{ type: "text", text: boundedText(stringValue(part.text) ?? "") }];
  if (type === "thinking") {
    const text = boundedText(stringValue(part.thinking) ?? stringValue(part.text) ?? "");
    return text.trim() === "" ? [] : [{ type: "thinking", text }];
  }
  if (type === "toolCall" || type === "tool-call") {
    const name = stringValue(part.name) ?? "tool";
    const summary = part.arguments === undefined ? undefined : summarizeToolArguments(name, part.arguments);
    const toolCallId = stringValue(part.id) ?? `${messageId}:tool:${stableDigest(`${name}:${summary ?? ""}`)}`;
    const adapter = resolveToolAdapter?.(toolCallId);
    const nested = resolveNestedTools(toolCallId);
    const childCapacity = Math.max(0, remainingParts - 1);
    const visibleChildren = nested?.projection?.calls.slice(0, childCapacity) ?? [];
    const nestedComplete = nested === undefined
      ? undefined
      : nested.complete && visibleChildren.length === (nested.projection?.calls.length ?? 0);
    const resolvedExecution = resolveToolExecution?.(toolCallId);
    const status = resolvedExecution?.status ?? resolveToolStatus(toolCallId) ?? "unreconciled";
    const execution = nestedComplete === undefined
      ? resolvedExecution
      : {
          ...(resolvedExecution ?? rootNestedExecution(toolCallId, name, status)),
          nestedRecord: { complete: nestedComplete }
        };
    const root: MessagePart = {
      type: "tool-call",
      id: toolCallId,
      name,
      status,
      ...(summary === undefined ? {} : { summary }),
      ...(execution === undefined ? {} : { execution }),
      ...(adapter === undefined ? {} : { adapter })
    };
    const children: MessagePart[] = visibleChildren.map((child) => {
      const resolvedChild = resolveToolExecution?.(child.toolCallId);
      const parentToolCallId = resolvedChild?.parentToolCallId ?? child.parentToolCallId;
      const childExecution = resolvedChild === undefined
        ? child
        : {
            ...child,
            ...resolvedChild,
            ...(parentToolCallId === undefined ? {} : { parentToolCallId })
          };
      const childAdapter = resolveToolAdapter?.(child.toolCallId);
      return {
        type: "tool-call",
        id: child.toolCallId,
        name: child.toolName,
        status: childExecution.status,
        ...(childExecution.inputSummary === undefined ? {} : { summary: childExecution.inputSummary.text }),
        execution: childExecution,
        ...(childAdapter === undefined ? {} : { adapter: childAdapter })
      };
    });
    return [root, ...children];
  }
  if (type === "image") {
    const mimeType = stringValue(part.mimeType) ?? "image/png";
    const data = stringValue(part.data);
    const name = stringValue(part.name);
    const asset = data === undefined ? undefined : projectImageAsset?.({
      stableKey: `${messageId}:image:${partIndex}`,
      mimeType,
      base64: data
    });
    return [{
      type: "image",
      mimeType,
      ...(asset === undefined ? {} : { asset }),
      ...(name === undefined ? {} : { name: name.slice(0, 512) })
    }];
  }
  const text = stringValue(part.text);
  return text ? [{ type: "text", text: boundedText(text) }] : [];
}

type ToolCallStatus = Extract<MessagePart, { type: "tool-call" }>["status"];

function collectToolResultStatuses(messages: readonly unknown[]): Map<string, ToolCallStatus> {
  const statuses = new Map<string, ToolCallStatus>();
  for (const value of messages) {
    const message = asRecord(value);
    if (message.role !== "toolResult") continue;
    const toolCallId = stringValue(message.toolCallId);
    if (!toolCallId) continue;
    statuses.set(toolCallId, message.isError === true ? "failed" : "completed");
  }
  return statuses;
}

function fallbackMessageId(message: Record<string, unknown>): string {
  const timestamp = numberValue(message.timestamp) ?? stringValue(message.timestamp) ?? "";
  const content = Array.isArray(message.content)
    ? message.content.slice(0, 8).map((part) => {
      const value = asRecord(part);
      return `${stringValue(value.type) ?? "part"}:${(stringValue(value.text) ?? stringValue(value.thinking) ?? "").slice(0, 512)}`;
    }).join("|")
    : typeof message.content === "string"
      ? message.content.slice(0, 2_048)
      : "";
  return `message-${stableDigest(`${stringValue(message.role) ?? "tool"}|${timestamp}|${content}`)}`;
}

function stableDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function normalizeRole(value: unknown): SessionMessageView["role"] {
  if (value === "user" || value === "assistant" || value === "system") return value;
  return "tool";
}

function fallbackParts(
  message: Record<string, unknown>,
  role: SessionMessageView["role"]
): MessagePart[] {
  if (role === "assistant" && Array.isArray(message.content)) return [];
  const toolName = stringValue(message.toolName);
  return [{
    type: "text",
    text: toolName ? `${toolName} tool result` : "当前版本无法显示此消息。"
  }];
}

function emptyAssistantResponseError(
  message: Record<string, unknown>,
  role: SessionMessageView["role"],
  parts: readonly MessagePart[]
): string | undefined {
  if (
    role !== "assistant"
    || !Array.isArray(message.content)
    || parts.length > 0
    || message.stopReason === "aborted"
  ) return undefined;
  return message.content.length === 0
    ? "模型未返回内容，请重试；若持续出现，请切换模型或检查模型服务配置。"
    : "模型返回了当前版本无法显示的内容，请重试或切换模型。";
}

function summarizeToolArguments(toolName: string, value: unknown): string {
  try {
    const mutationSummary = projectMutationSummary(toolName, value);
    if (mutationSummary) return JSON.stringify(mutationSummary);
    const projected = projectSummaryValue(value, 0, new WeakSet<object>());
    const text = typeof projected === "string" ? projected : JSON.stringify(projected);
    return redactSensitiveText(text).slice(0, 2_000);
  } catch {
    return "Tool arguments unavailable";
  }
}

function projectMutationSummary(toolName: string, value: unknown): Record<string, unknown> | undefined {
  if (toolName !== "write" && toolName !== "edit") return undefined;
  const args = asRecord(value);
  const path = stringValue(args.path) ?? stringValue(args.filePath);
  if (toolName === "write") {
    const content = stringValue(args.content);
    return {
      ...(path === undefined ? {} : { path: path.slice(0, 1_024) }),
      ...(content === undefined ? {} : { content: `[omitted:${content.length} chars]` })
    };
  }
  return {
    ...(path === undefined ? {} : { path: path.slice(0, 1_024) }),
    editCount: Array.isArray(args.edits) ? args.edits.length : 0,
    edits: "[omitted]"
  };
}

function projectSummaryValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.description ?? "[symbol]";
  if (typeof value === "function") return "[function]";
  if (value === undefined) return null;
  if (seen.has(value)) return "[circular]";
  if (depth >= 3) return "[nested]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 16).map((item) => projectSummaryValue(item, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 16)) {
    result[key] = isSensitiveKey(key)
      ? "[redacted]"
      : projectSummaryValue(child, depth + 1, seen);
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  return /(?:api[-_]?key|authorization|cookie|credential|pass(?:word|phrase)?|secret|token)/iu.test(key);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9._-]{8,}/gu, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, "[redacted]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/giu, "$1[redacted]@");
}

function boundedText(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= MAX_PROJECTED_TEXT_BYTES) return value;
  const suffix = "\n\n[内容过长，桌面投影已截断]";
  const byteBudget = MAX_PROJECTED_TEXT_BYTES - Buffer.byteLength(suffix, "utf8");
  let prefix = Buffer.from(value, "utf8").subarray(0, byteBudget).toString("utf8");
  while (prefix.endsWith("\uFFFD")) prefix = prefix.slice(0, -1);
  return `${prefix}${suffix}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
