import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ToolExecutionView } from "@pi67/domain";
import { desktopToolAliasTarget } from "./tool-routing-extension.js";
import {
  deriveToolDuration,
  projectToolFailure,
  projectToolInput,
  safeToolCallId,
  safeToolName
} from "./tool-execution-projection.js";
import {
  projectNestedToolCalls,
  toolKindForName,
  type NestedToolProjection
} from "./nested-tool-projection.js";
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
  private readonly nativeNestedCallIds = new Set<string>();
  private readonly nativeNestedParents = new Map<string, string>();
  private readonly nestedTools = new Map<string, NestedToolProjection>();

  constructor(private cwd = "") {}

  rebuild(entries: readonly SessionEntry[], cwd = this.cwd): void {
    this.cwd = cwd;
    this.calls.clear();
    this.results.clear();
    this.receipts.clear();
    this.nativeNestedCallIds.clear();
    this.nativeNestedParents.clear();
    this.nestedTools.clear();
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
    this.observeNestedCalls(toolCallId, message.nestedCalls);
    this.reconcile(toolCallId);
  }

  get(toolCallId: string): ToolExecutionView | undefined {
    const projectedId = safeToolCallId(toolCallId);
    const call = this.calls.get(projectedId);
    if (!call) return undefined;
    if (call.status !== "pending") return call;
    return { ...call, status: "unreconciled", resultState: "unreconciled" };
  }

  /**
   * Returns the bounded native Pi summary for one root call. This is a
   * disposable lookup index, never a second transcript or execution record.
   */
  getNestedTools(rootToolCallId: string): NestedToolProjection | undefined {
    const nested = this.nestedTools.get(safeToolCallId(rootToolCallId));
    if (!nested) return undefined;
    return {
      complete: nested.complete,
      calls: nested.calls.map((call) => ({
        ...call,
        ...(call.nestedRecord === undefined ? {} : { nestedRecord: { ...call.nestedRecord } })
      }))
    };
  }

  private observeAssistantPart(value: unknown): void {
    const part = asRecord(value);
    const type = stringValue(part.type);
    if (type !== "toolCall" && type !== "tool-call") return;
    const rawId = stringValue(part.id);
    if (!rawId) return;
    const toolCallId = safeToolCallId(rawId);
    const nestedParent = this.nativeNestedParents.get(toolCallId);
    if (nestedParent !== undefined) {
      this.markNestedRecordIncomplete(nestedParent);
      return;
    }
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

  private observeNestedCalls(parentToolCallId: string, value: unknown): void {
    if (value === undefined || !this.calls.has(parentToolCallId)) return;
    const nested = projectNestedToolCalls(parentToolCallId, value, this.cwd);
    if (!nested || nested.calls.some((child) => this.calls.has(child.toolCallId))) {
      this.markNestedRecordIncomplete(parentToolCallId);
      return;
    }
    this.setNestedRecord(parentToolCallId, nested.complete);
    this.nestedTools.set(parentToolCallId, nested);
    for (const child of nested.calls) {
      this.calls.set(child.toolCallId, child);
      this.nativeNestedCallIds.add(child.toolCallId);
      this.nativeNestedParents.set(child.toolCallId, parentToolCallId);
    }
  }

  private markNestedRecordIncomplete(parentToolCallId: string): void {
    this.setNestedRecord(parentToolCallId, false);
    this.nestedTools.set(parentToolCallId, { calls: [], complete: false });
  }

  private setNestedRecord(parentToolCallId: string, complete: boolean): void {
    const parent = this.calls.get(parentToolCallId);
    if (parent) this.calls.set(parentToolCallId, { ...parent, nestedRecord: { complete } });
  }

  private reconcile(toolCallId: string): void {
    const call = this.calls.get(toolCallId);
    if (!call) return;
    // Pi persists the nested outcome as `toolResult.nestedCalls`, not as a
    // standalone child Tool Result. A Desktop receipt may add live timing, but
    // cannot replace that native outcome with an invented durable result.
    if (this.nativeNestedCallIds.has(toolCallId)) return;
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
