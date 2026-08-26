import { createHash } from "node:crypto";
import {
  MAX_TOOL_CALL_ID_CHARS,
  MAX_TOOL_COMMAND_CHARS,
  MAX_TOOL_CWD_CHARS,
  MAX_TOOL_FAILURE_CHARS,
  MAX_TOOL_INPUT_SUMMARY_CHARS,
  MAX_TOOL_NAME_CHARS,
  MAX_TOOL_PROGRESS_CHARS,
  type BoundedToolText,
  type ToolExecutionFailureView
} from "@pi67/domain";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

const COMMAND_TOOL_NAMES = new Set([
  "bash",
  "shell",
  "exec",
  "exec-command",
  "exec_command",
  "run-command",
  "run_command"
]);

const SENSITIVE_KEY = /api[-_]?key|authorization|cookie|credential|pass(?:word|phrase)?|secret|token/iu;

export function safeToolCallId(value: string): string {
  if (value.length <= MAX_TOOL_CALL_ID_CHARS && !hasControlCharacter(value)) return value || "unknown-tool-call";
  const digest = createHash("sha256").update(value).digest("hex");
  return `tool-call:${digest}`;
}

export function safeToolName(value: string): string {
  const bounded = value.slice(0, MAX_TOOL_NAME_CHARS);
  return !bounded || hasControlCharacter(bounded) ? "unknown-tool" : bounded;
}

export function projectToolInput(
  toolName: string,
  args: unknown,
  cwd: string | undefined
): Pick<import("@pi67/domain").ToolExecutionView, "inputSummary" | "command" | "cwd"> {
  const inputSummary = summarizeToolInput(args);
  const command = isCommandTool(toolName) ? projectCommand(args) : undefined;
  const projectedCwd = cwd === undefined || cwd === ""
    ? undefined
    : boundedToolText(cwd, MAX_TOOL_CWD_CHARS).text;
  return {
    ...(inputSummary === undefined ? {} : { inputSummary }),
    ...(command === undefined ? {} : { command }),
    ...(projectedCwd === undefined ? {} : { cwd: projectedCwd })
  };
}

export function projectToolProgress(value: unknown): BoundedToolText | undefined {
  const projection = projectToolText(value, MAX_TOOL_PROGRESS_CHARS, true);
  return projection === undefined || projection.text.trim() === "" ? undefined : projection;
}

export function projectToolFailure(
  result: unknown,
  source: ToolExecutionFailureView["source"]
): ToolExecutionFailureView {
  const direct = extractToolErrorString(result);
  const message = direct === undefined
    ? projectToolText(result, MAX_TOOL_FAILURE_CHARS, false)
    : boundedToolText(direct, MAX_TOOL_FAILURE_CHARS);
  return message === undefined || message.text.trim() === ""
    ? { detailState: "missing", source }
    : {
        detailState: "available",
        source,
        message
      };
}

export function deriveToolDuration(startedAt: number | undefined, completedAt: number | undefined): number | undefined {
  if (startedAt === undefined || completedAt === undefined) return undefined;
  return Math.max(0, completedAt - startedAt);
}

function boundedToolText(value: string, maxLength: number, tail = false): BoundedToolText {
  const preLimit = Math.max(maxLength, maxLength * 4);
  const preBounded = value.length <= preLimit
    ? value
    : tail ? value.slice(-preLimit) : value.slice(0, preLimit);
  return finalizeBoundedToolText(preBounded, maxLength, tail, value.length > preLimit);
}

function finalizeBoundedToolText(
  preBounded: string,
  maxLength: number,
  tail: boolean,
  collectionTruncated: boolean
): BoundedToolText {
  const preLimit = Math.max(maxLength, maxLength * 4);
  const sanitized = sanitizeRuntimeText(preBounded, preLimit);
  const truncated = collectionTruncated || sanitized.length > maxLength;
  const text = sanitized.length <= maxLength
    ? sanitized
    : tail ? sanitized.slice(-maxLength) : sanitized.slice(0, maxLength);
  return { text, truncated };
}

function summarizeToolInput(value: unknown): BoundedToolText | undefined {
  if (value === undefined) return undefined;
  try {
    const projected = projectSummaryValue(value, 0, new WeakSet<object>());
    const text = typeof projected === "string" ? projected : JSON.stringify(projected);
    return boundedToolText(text, MAX_TOOL_INPUT_SUMMARY_CHARS);
  } catch {
    return { text: "Tool arguments unavailable", truncated: false };
  }
}

function projectCommand(value: unknown): BoundedToolText | undefined {
  const record = asRecord(value);
  for (const key of ["command", "cmd", "script"]) {
    const command = record[key];
    if (typeof command === "string" && command.trim() !== "") {
      return boundedToolText(command, MAX_TOOL_COMMAND_CHARS);
    }
  }
  return undefined;
}

function isCommandTool(toolName: string): boolean {
  return COMMAND_TOOL_NAMES.has(toolName.trim().toLocaleLowerCase("en-US"));
}

function extractToolErrorString(value: unknown): string | undefined {
  const record = asRecord(value);
  for (const key of ["errorMessage", "error", "message"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
    const nestedMessage = asRecord(candidate).message;
    if (typeof nestedMessage === "string" && nestedMessage.trim() !== "") return nestedMessage;
  }
  return undefined;
}

function projectToolText(
  value: unknown,
  maxLength: number,
  tail: boolean
): BoundedToolText | undefined {
  if (typeof value === "string") return boundedToolText(value, maxLength, tail);
  const record = asRecord(value);
  const direct = record.text;
  if (typeof direct === "string") return boundedToolText(direct, maxLength, tail);
  const content = record.content;
  if (!Array.isArray(content)) return undefined;
  return collectBoundedToolContent(content, maxLength, tail);
}

function collectBoundedToolContent(
  content: readonly unknown[],
  maxLength: number,
  tail: boolean
): BoundedToolText | undefined {
  const preLimit = Math.max(maxLength, maxLength * 4);
  const selected: string[] = [];
  let remaining = preLimit;
  let collectionTruncated = false;
  const start = tail ? content.length - 1 : 0;
  const end = tail ? -1 : content.length;
  const step = tail ? -1 : 1;
  for (let index = start; index !== end; index += step) {
    const part = content[index];
    const text = typeof part === "string" ? part : asRecord(part).text;
    if (typeof text !== "string") continue;
    if (remaining === 0) {
      collectionTruncated = true;
      break;
    }
    const separatorChars = selected.length > 0 ? 1 : 0;
    if (remaining <= separatorChars) {
      collectionTruncated = true;
      break;
    }
    const available = remaining - separatorChars;
    if (text.length > available) {
      selected.push(tail ? text.slice(-available) : text.slice(0, available));
      collectionTruncated = true;
      remaining = 0;
      break;
    }
    selected.push(text);
    remaining -= text.length + separatorChars;
  }
  if (tail) selected.reverse();
  return selected.length === 0
    ? undefined
    : finalizeBoundedToolText(selected.join("\n"), maxLength, tail, collectionTruncated);
}

function projectSummaryValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return boundedToolText(value, 512).text;
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.description ? `[symbol:${value.description}]` : "[symbol]";
  if (typeof value === "function") return value.name ? `[function:${value.name}]` : "[function]";
  if (seen.has(value)) return "[circular]";
  if (depth >= 3) return "[nested]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, 12).map((item) => projectSummaryValue(item, depth + 1, seen));
    }
    const entries = Object.entries(value).slice(0, 24).map(([key, item]) => [
      key.slice(0, 128),
      SENSITIVE_KEY.test(key) ? "[redacted]" : projectSummaryValue(item, depth + 1, seen)
    ]);
    return Object.fromEntries(entries);
  } finally {
    seen.delete(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
