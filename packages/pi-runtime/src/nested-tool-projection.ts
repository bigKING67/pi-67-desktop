import {
  MAX_PROJECTED_MESSAGE_PARTS,
  MAX_TOOL_CALL_ID_CHARS,
  MAX_TOOL_FAILURE_CHARS,
  MAX_TOOL_NAME_CHARS,
  type ToolExecutionStatus,
  type ToolExecutionView,
  type ToolPresentationKind
} from "@pi67/domain";
import { projectToolFailure, projectToolInput, safeToolCallId, safeToolName } from "./tool-execution-projection.js";

// Pi 1.0 bounds this native record at 256 calls. Keep the same ceiling when
// reading JSONL so an edited or future-format entry cannot grow a projection.
const MAX_NESTED_CALLS = 256;

export interface NestedToolProjection {
  calls: ToolExecutionView[];
  complete: boolean;
}

export interface NestedToolResult {
  projection?: NestedToolProjection;
  complete: boolean;
}

/**
 * Projects Pi's persisted `toolResult.nestedCalls` summary. This is deliberately
 * separate from Codemode's display-only `details.calls`: Pi JSONL remains the
 * source for cold recovery and no nested tool output is copied into Desktop state.
 */
export function projectNestedToolCalls(
  parentToolCallId: string,
  value: unknown,
  cwd: string | undefined
): NestedToolProjection | undefined {
  const parent = boundedString(parentToolCallId, MAX_TOOL_CALL_ID_CHARS);
  const record = asRecord(value);
  if (!parent || !record || !hasOnlyKeys(record, ["calls", "complete"])
    || !Array.isArray(record.calls) || record.calls.length > MAX_NESTED_CALLS
    || typeof record.complete !== "boolean") return undefined;

  const calls: ToolExecutionView[] = [];
  const seen = new Set<string>();
  for (const candidate of record.calls) {
    const child = projectNestedToolCall(parent, candidate, cwd);
    if (!child || seen.has(child.toolCallId)) return undefined;
    seen.add(child.toolCallId);
    calls.push(child);
  }
  return { calls, complete: record.complete };
}

export function toolKindForName(toolName: string): ToolPresentationKind {
  const normalized = toolName.trim().toLocaleLowerCase("en-US").replaceAll("_", "-");
  if (["bash", "shell", "exec", "exec-command", "run-command"].includes(normalized)) return "shell";
  if (["read", "read-file", "view-image"].includes(normalized)) return normalized === "view-image" ? "image" : "read";
  if (["grep", "search", "find", "glob", "rg"].includes(normalized)) return "search";
  if (["edit", "write", "apply-patch"].includes(normalized)) return "edit";
  if (["subagent", "spawn-agent", "delegate"].includes(normalized)) return "subagent";
  return "generic";
}

/**
 * Collects page-local native results before message projection. This is kept
 * beside the native record parser so malformed and colliding summaries have
 * one fail-closed interpretation in both live pages and durable recovery.
 */
export function collectNestedToolResults(messages: readonly unknown[]): Map<string, NestedToolResult> {
  const nested = new Map<string, NestedToolResult>();
  const rootToolCallIds = collectRootToolCallIds(messages);
  const seenChildren = new Set<string>();
  for (const value of messages) {
    const message = asRecord(value);
    if (!message || message.role !== "toolResult") continue;
    const toolCallId = nonEmptyString(message.toolCallId);
    if (!toolCallId || message.nestedCalls === undefined) continue;
    const projection = projectNestedToolCalls(toolCallId, message.nestedCalls, undefined);
    if (!projection || projection.calls.some((child) => rootToolCallIds.has(child.toolCallId) || seenChildren.has(child.toolCallId))) {
      nested.set(toolCallId, { complete: false });
      continue;
    }
    for (const child of projection.calls) seenChildren.add(child.toolCallId);
    nested.set(toolCallId, { projection, complete: projection.complete });
  }
  return nested;
}

export function nestedToolResult(projection: NestedToolProjection | undefined): NestedToolResult | undefined {
  return projection === undefined ? undefined : { projection, complete: projection.complete };
}

export function rootNestedExecution(
  toolCallId: string,
  toolName: string,
  status: ToolExecutionStatus
): ToolExecutionView {
  return {
    toolCallId,
    toolName,
    toolKind: toolKindForName(toolName),
    status,
    projectionSource: "durable",
    resultState: status === "unreconciled" ? "unreconciled" : "present"
  };
}

function projectNestedToolCall(
  rootToolCallId: string,
  value: unknown,
  cwd: string | undefined
): ToolExecutionView | undefined {
  const record = asRecord(value);
  if (!record || !hasOnlyKeys(record, ["id", "name", "status", "arguments", "argumentsBytes", "durationMs", "error"])) {
    return undefined;
  }
  const rawId = boundedString(record.id, MAX_TOOL_CALL_ID_CHARS);
  const rawName = boundedString(record.name, MAX_TOOL_NAME_CHARS);
  const status = nestedStatus(record.status);
  const durationMs = nonNegativeInteger(record.durationMs);
  const error = optionalBoundedText(record.error, MAX_TOOL_FAILURE_CHARS);
  const argumentsBytes = nonNegativeInteger(record.argumentsBytes);
  if (!rawId || !rawName || !status
    || (record.durationMs !== undefined && durationMs === undefined)
    || (record.error !== undefined && error === undefined)
    || (record.argumentsBytes !== undefined && argumentsBytes === undefined)
    || (record.arguments !== undefined && record.argumentsBytes !== undefined)
    || !isNestedId(rootToolCallId, rawId)) return undefined;

  const toolCallId = safeToolCallId(rawId);
  const toolName = safeToolName(rawName);
  const resultState = status === "unreconciled" ? "unreconciled" : "present";
  return {
    toolCallId,
    toolName,
    toolKind: toolKindForName(toolName),
    status,
    projectionSource: "durable",
    resultState,
    parentToolCallId: nestedParentId(rootToolCallId, rawId),
    ...(record.arguments === undefined ? {} : projectToolInput(toolName, record.arguments, cwd)),
    ...(durationMs === undefined ? {} : { durationMs, timingSource: "pi-result" as const }),
    ...(status === "failed" && error !== undefined ? { failure: projectToolFailure({ error }, "pi-result") } : {})
  };
}

function nestedStatus(value: unknown): ToolExecutionStatus | undefined {
  if (value === "ok") return "completed";
  if (value === "error") return "failed";
  if (value === "unfinished") return "unreconciled";
  return undefined;
}

function nestedParentId(rootToolCallId: string, toolCallId: string): string {
  const separator = toolCallId.lastIndexOf("/");
  return separator > rootToolCallId.length ? toolCallId.slice(0, separator) : rootToolCallId;
}

function isNestedId(rootToolCallId: string, toolCallId: string): boolean {
  if (!toolCallId.startsWith(`${rootToolCallId}/`)) return false;
  return toolCallId.slice(rootToolCallId.length + 1)
    .split("/")
    .every((segment) => /^[1-9][0-9]*$/u.test(segment));
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function optionalBoundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return undefined;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return undefined;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function collectRootToolCallIds(messages: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const value of messages) {
    const message = asRecord(value);
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content.slice(0, MAX_PROJECTED_MESSAGE_PARTS)) {
      const record = asRecord(part);
      const id = record === undefined ? undefined : nonEmptyString(record.id);
      if ((record?.type !== "toolCall" && record?.type !== "tool-call") || !id) continue;
      ids.add(id);
    }
  }
  return ids;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(record).every((key) => allowedKeys.has(key));
}
