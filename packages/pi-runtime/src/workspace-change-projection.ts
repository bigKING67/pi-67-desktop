import type { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  MAX_WORKSPACE_CHANGES,
  MAX_WORKSPACE_CHANGES_JSON_BYTES,
  MAX_WORKSPACE_CHANGE_METRICS_INPUT_BYTES,
  MAX_WORKSPACE_CHANGE_PATCH_BYTES,
  MAX_WORKSPACE_CHANGE_PATH_BYTES,
  type WorkspaceChangesProjection,
  type WorkspaceChangeView
} from "@pi67/domain";
import { boundUtf8 } from "./utf8-boundary.js";

type ChangeSessionManager = Pick<SessionManager, "getBranch" | "getSessionId">;

interface ToolResultRecord {
  toolName: string;
  details: unknown;
  isError: boolean;
}

interface LiveChangeStart {
  change: WorkspaceChangeView;
}

const MAX_PENDING_TOOL_RESULTS = MAX_WORKSPACE_CHANGES * 4;

export function projectWorkspaceChanges(
  sessionManager: ChangeSessionManager,
  activeToolCallIds: ReadonlySet<string> = new Set(),
  sessionStreaming = false
): WorkspaceChangesProjection {
  const entries = sessionManager.getBranch();
  const results = new Map<string, ToolResultRecord>();
  const recentReverse: WorkspaceChangeView[] = [];
  let total = 0;
  let latestAssistantSeen = false;

  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const entry = entries[entryIndex];
    if (!entry || entry.type !== "message") continue;
    const message = asRecord(entry.message);
    if (message.role === "toolResult") {
      if (recentReverse.length < MAX_WORKSPACE_CHANGES) rememberToolResult(message, results);
      continue;
    }
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const isLatestAssistant = !latestAssistantSeen;
    latestAssistantSeen = true;

    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = asRecord(message.content[partIndex]);
      if (part.type !== "toolCall") continue;
      const start = projectChangeStart(part.id, part.name, part.arguments);
      if (!start) continue;
      total += 1;
      if (recentReverse.length >= MAX_WORKSPACE_CHANGES) continue;
      const result = results.get(start.change.toolCallId);
      if (result) results.delete(start.change.toolCallId);
      recentReverse.push(result
        ? finishChange(start, result)
        : {
            ...start.change,
            status: activeToolCallIds.has(start.change.toolCallId)
              ? "running"
              : sessionStreaming && isLatestAssistant
                ? "pending"
                : "interrupted"
          });
    }

    if (recentReverse.length >= MAX_WORKSPACE_CHANGES) results.clear();
  }

  const recent = recentReverse.reverse();
  const sessionId = sessionManager.getSessionId();
  const items = fitProjectionBudget(sessionId, total, recent);
  return {
    sessionId,
    items,
    truncated: total > items.length,
    total
  };
}

export function projectLiveWorkspaceChangeStart(event: {
  toolCallId: string;
  toolName: string;
  args: unknown;
}): WorkspaceChangeView | undefined {
  return projectChangeStart(event.toolCallId, event.toolName, event.args)?.change;
}

export function projectLiveWorkspaceChangeEnd(
  change: WorkspaceChangeView,
  toolName: string,
  result: unknown,
  isError: boolean
): WorkspaceChangeView {
  return finishChange({ change }, { toolName, details: asRecord(result).details, isError });
}

function projectChangeStart(toolCallIdValue: unknown, toolNameValue: unknown, argsValue: unknown): LiveChangeStart | undefined {
  const toolCallId = boundedIdentifier(toolCallIdValue);
  const toolName = typeof toolNameValue === "string" ? toolNameValue : undefined;
  if (!toolCallId || (toolName !== "edit" && toolName !== "write")) return undefined;
  const args = asRecord(argsValue);
  const rawPath = stringValue(args.path);
  if (!rawPath) return undefined;
  const path = boundUtf8(rawPath, MAX_WORKSPACE_CHANGE_PATH_BYTES);
  const common = {
    toolCallId,
    path: path.value,
    pathTruncated: path.truncated,
    status: "running" as const
  };

  if (toolName === "edit") {
    if (!Array.isArray(args.edits)) return undefined;
    return { change: { ...common, kind: "edit", patchTruncated: false } };
  }

  const content = stringValue(args.content);
  if (content === undefined) return undefined;
  const metrics = measureWrite(content);
  return {
    change: {
      ...common,
      kind: "write",
      ...metrics
    }
  };
}

function finishChange(start: LiveChangeStart, result: ToolResultRecord): WorkspaceChangeView {
  const base: WorkspaceChangeView = {
    ...start.change,
    status: result.isError ? "failed" : "completed"
  };
  if (result.toolName !== base.kind) return { ...base, status: "failed" };
  if (result.isError || base.kind !== "edit") return base;

  const details = asRecord(result.details);
  const patchValue = stringValue(details.patch);
  const diffValue = stringValue(details.diff);
  if (patchValue === undefined || diffValue === undefined) return base;
  const patch = boundUtf8(patchValue, MAX_WORKSPACE_CHANGE_PATCH_BYTES);
  const firstChangedLine = integerValue(details.firstChangedLine);
  return {
    ...base,
    patch: patch.value,
    patchTruncated: patch.truncated,
    ...(patch.truncated ? {} : countPatchLines(patch.value)),
    ...(firstChangedLine === undefined ? {} : { firstChangedLine })
  };
}

function rememberToolResult(message: Record<string, unknown>, results: Map<string, ToolResultRecord>): void {
  const toolCallId = boundedIdentifier(message.toolCallId);
  const toolName = stringValue(message.toolName);
  if (!toolCallId || (toolName !== "edit" && toolName !== "write")) return;
  if (!results.has(toolCallId) && results.size >= MAX_PENDING_TOOL_RESULTS) return;
  results.set(toolCallId, {
    toolName,
    details: message.details,
    isError: message.isError === true
  });
}

function fitProjectionBudget(sessionId: string, total: number, items: WorkspaceChangeView[]): WorkspaceChangeView[] {
  const fitted: WorkspaceChangeView[] = [];
  // Reserve the larger `false` spelling so either final truncated value remains within budget.
  let bytes = Buffer.byteLength(JSON.stringify({ sessionId, items: [], truncated: true, total }), "utf8") + 1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8") + (fitted.length === 0 ? 0 : 1);
    if (bytes + itemBytes > MAX_WORKSPACE_CHANGES_JSON_BYTES) break;
    fitted.unshift(item);
    bytes += itemBytes;
  }
  return fitted;
}

function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  const hasHunks = patch.startsWith("@@ ") || patch.includes("\n@@ ");
  let inHunk = !hasHunks;
  let lineStart = 0;
  while (lineStart <= patch.length) {
    const lineEnd = patch.indexOf("\n", lineStart);
    const end = lineEnd < 0 ? patch.length : lineEnd;
    if (patch.startsWith("@@ ", lineStart)) {
      inHunk = true;
    } else if (inHunk && lineStart < end) {
      const prefix = patch.charCodeAt(lineStart);
      const header = !hasHunks && (
        patch.startsWith("+++ ", lineStart)
        || patch.startsWith("--- ", lineStart)
      );
      if (!header && prefix === 43) additions += 1;
      if (!header && prefix === 45) deletions += 1;
    }
    if (lineEnd < 0) break;
    lineStart = lineEnd + 1;
  }
  return { additions, deletions };
}

function measureWrite(value: string): Pick<Extract<WorkspaceChangeView, { kind: "write" }>, "writtenBytes" | "writtenLines" | "metricsTruncated"> {
  if (value.length > MAX_WORKSPACE_CHANGE_METRICS_INPUT_BYTES) return { metricsTruncated: true };
  return {
    writtenBytes: Buffer.byteLength(value, "utf8"),
    writtenLines: countLines(value),
    metricsTruncated: false
  };
}

function countLines(value: string): number {
  if (value.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

function boundedIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return undefined;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}
