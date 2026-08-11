import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ToolExecutionView, ToolPresentationKind } from "@pi67/domain";
import { desktopToolAliasTarget } from "./tool-routing-extension.js";
import {
  deriveToolDuration,
  projectToolFailure,
  projectToolInput,
  safeToolCallId,
  safeToolName
} from "./tool-execution-projection.js";
import {
  parseToolExecutionReceipt,
  TOOL_EXECUTION_RECEIPT_TYPE,
  type ToolExecutionReceiptItem
} from "./tool-execution-receipt.js";

interface DurableToolResult {
  toolName?: string;
  result: unknown;
  isError: boolean;
}

export class DurableToolExecutionIndex {
  private readonly calls = new Map<string, ToolExecutionView>();
  private readonly results = new Map<string, DurableToolResult>();
  private readonly receipts = new Map<string, ToolExecutionReceiptItem>();

  constructor(private cwd = "") {}

  rebuild(entries: readonly SessionEntry[], cwd = this.cwd): void {
    this.cwd = cwd;
    this.calls.clear();
    this.results.clear();
    this.receipts.clear();
    for (const entry of entries) this.observe(entry);
  }

  observe(entry: SessionEntry): void {
    if (entry.type === "custom" && entry.customType === TOOL_EXECUTION_RECEIPT_TYPE) {
      const receipt = parseToolExecutionReceipt(entry.data);
      if (!receipt) return;
      for (const item of receipt.items) {
        this.receipts.set(item.toolCallId, item);
        this.reconcile(item.toolCallId);
      }
      return;
    }
    if (entry.type !== "message") return;
    const message = asRecord(entry.message);
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const partValue of message.content) this.observeAssistantPart(partValue);
      return;
    }
    if (message.role !== "toolResult") return;
    const rawId = stringValue(message.toolCallId);
    if (!rawId) return;
    const toolCallId = safeToolCallId(rawId);
    this.results.set(toolCallId, {
      ...(stringValue(message.toolName) === undefined ? {} : { toolName: safeToolName(stringValue(message.toolName)!) }),
      result: message,
      isError: message.isError === true
    });
    this.reconcile(toolCallId);
  }

  get(toolCallId: string): ToolExecutionView | undefined {
    const projectedId = safeToolCallId(toolCallId);
    const call = this.calls.get(projectedId);
    if (!call) return undefined;
    if (call.status !== "pending") return call;
    return { ...call, status: "unreconciled", resultState: "unreconciled" };
  }

  private observeAssistantPart(value: unknown): void {
    const part = asRecord(value);
    const type = stringValue(part.type);
    if (type !== "toolCall" && type !== "tool-call") return;
    const rawId = stringValue(part.id);
    if (!rawId) return;
    const toolCallId = safeToolCallId(rawId);
    const toolName = safeToolName(stringValue(part.name) ?? "tool");
    const aliasTarget = desktopToolAliasTarget(toolName);
    this.calls.set(toolCallId, {
      toolCallId,
      toolName,
      toolKind: toolKindForName(toolName),
      status: "pending",
      projectionSource: "durable",
      resultState: "pending",
      ...projectToolInput(toolName, part.arguments, this.cwd),
      ...(aliasTarget === undefined ? {} : { aliasTarget })
    });
    this.reconcile(toolCallId);
  }

  private reconcile(toolCallId: string): void {
    const call = this.calls.get(toolCallId);
    if (!call) return;
    const result = this.results.get(toolCallId);
    const receipt = this.receipts.get(toolCallId);
    const validReceipt = receipt?.toolName === call.toolName ? receipt : undefined;
    const startedAt = validReceipt?.startedAt;
    const completedAt = validReceipt?.completedAt;
    const durationMs = deriveToolDuration(startedAt, completedAt);
    if (result) {
      this.calls.set(toolCallId, {
        ...call,
        status: result.isError ? "failed" : "completed",
        resultState: "present",
        ...(result.isError ? { failure: projectToolFailure(result.result, "pi-result") } : {}),
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(completedAt === undefined ? {} : { completedAt }),
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(validReceipt === undefined ? {} : { timingSource: "receipt" })
      });
      return;
    }
    if (!validReceipt) return;
    const status = validReceipt.status === "completed" || validReceipt.status === "failed"
      ? "unreconciled"
      : validReceipt.status;
    this.calls.set(toolCallId, {
      ...call,
      status,
      resultState: "unreconciled",
      ...(validReceipt.status === "failed"
        ? { failure: { detailState: "missing", source: "projection-integrity" } as const }
        : {}),
      ...(startedAt === undefined ? {} : { startedAt }),
      completedAt: validReceipt.completedAt,
      ...(durationMs === undefined ? {} : { durationMs }),
      timingSource: "receipt"
    });
  }
}

function toolKindForName(toolName: string): ToolPresentationKind {
  const normalized = toolName.trim().toLocaleLowerCase("en-US").replaceAll("_", "-");
  if (["bash", "shell", "exec", "exec-command", "run-command"].includes(normalized)) return "shell";
  if (["read", "read-file", "view-image"].includes(normalized)) return normalized === "view-image" ? "image" : "read";
  if (["grep", "search", "find", "glob", "rg"].includes(normalized)) return "search";
  if (["edit", "write", "apply-patch"].includes(normalized)) return "edit";
  if (["subagent", "spawn-agent", "delegate"].includes(normalized)) return "subagent";
  return "generic";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
