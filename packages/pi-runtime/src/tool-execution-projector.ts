import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  MAX_TOOL_EXECUTION_RECEIPT_ITEMS,
  type ToolAuthorizationProjection,
  type ToolExecutionView,
  type ToolPresentationKind
} from "@pi67/domain";
import { desktopToolAliasTarget } from "./tool-routing-extension.js";
import {
  deriveToolDuration,
  projectToolFailure,
  projectToolInput,
  projectToolProgress,
  safeToolCallId,
  safeToolName
} from "./tool-execution-projection.js";
import type {
  ToolExecutionReceiptData,
  ToolExecutionReceiptItem,
  ToolExecutionReceiptStatus
} from "./tool-execution-receipt.js";

const TOOL_PROGRESS_INTERVAL_MS = 100;

interface ToolExecutionProjectorTarget {
  emit(execution: ToolExecutionView): void;
  getCwd(): string | undefined;
  persistReceipt(data: ToolExecutionReceiptData): void;
  reportReceiptFailure(): void;
  now?: () => number;
}

export class ToolExecutionProjector {
  private readonly executions = new Map<string, ToolExecutionView>();
  private readonly pendingUpdates = new Map<string, ToolExecutionView>();
  private readonly updateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private omittedCount = 0;
  private cancellationRequested = false;
  private readonly now: () => number;

  constructor(private readonly target: ToolExecutionProjectorTarget) {
    this.now = target.now ?? Date.now;
  }

  reset(): void {
    for (const timer of this.updateTimers.values()) clearTimeout(timer);
    this.updateTimers.clear();
    this.pendingUpdates.clear();
    this.executions.clear();
    this.omittedCount = 0;
    this.cancellationRequested = false;
  }

  requestCancellation(): void {
    this.cancellationRequested = true;
  }

  recordAuthorization(toolCallId: string, authorization: ToolAuthorizationProjection): void {
    const projectedId = safeToolCallId(toolCallId);
    const current = this.executions.get(projectedId);
    if (!current) return;
    const updated = { ...current, authorization };
    this.executions.set(projectedId, updated);
    this.emitNow(updated);
  }

  handle(
    event: AgentSessionEvent,
    toolKind: ToolPresentationKind = "generic",
    authorization?: ToolAuthorizationProjection
  ): void {
    if (event.type === "agent_start") {
      if (this.executions.size > 0) this.settle();
      else this.reset();
      return;
    }
    if (event.type === "tool_execution_start") {
      this.start(event, toolKind, authorization);
      return;
    }
    if (event.type === "tool_execution_update") {
      this.update(event);
      return;
    }
    if (event.type === "tool_execution_end") {
      this.end(event, authorization);
      return;
    }
    if (event.type === "agent_settled") this.settle();
  }

  private start(
    event: Extract<AgentSessionEvent, { type: "tool_execution_start" }>,
    toolKind: ToolPresentationKind,
    authorization: ToolAuthorizationProjection | undefined
  ): void {
    const toolCallId = safeToolCallId(event.toolCallId);
    const toolName = safeToolName(event.toolName);
    const aliasTarget = desktopToolAliasTarget(toolName);
    const execution: ToolExecutionView = {
      toolCallId,
      toolName,
      toolKind,
      status: "running",
      projectionSource: "live",
      resultState: "pending",
      startedAt: this.now(),
      timingSource: "runtime",
      ...projectToolInput(toolName, event.args, this.target.getCwd()),
      ...(aliasTarget === undefined ? {} : { aliasTarget }),
      ...(authorization === undefined ? {} : { authorization })
    };
    this.remember(execution);
    this.emitNow(execution);
  }

  private update(event: Extract<AgentSessionEvent, { type: "tool_execution_update" }>): void {
    const toolCallId = safeToolCallId(event.toolCallId);
    const current = this.executions.get(toolCallId);
    if (!current || current.status !== "running") return;
    const progress = projectToolProgress(event.partialResult);
    if (!progress || sameText(current.progress, progress)) return;
    const updated = { ...current, progress };
    this.executions.set(toolCallId, updated);
    this.pendingUpdates.set(toolCallId, updated);
    if (this.updateTimers.has(toolCallId)) return;
    const timer = setTimeout(() => {
      this.updateTimers.delete(toolCallId);
      const pending = this.pendingUpdates.get(toolCallId);
      this.pendingUpdates.delete(toolCallId);
      if (pending) this.target.emit(pending);
    }, TOOL_PROGRESS_INTERVAL_MS);
    this.updateTimers.set(toolCallId, timer);
  }

  private end(
    event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>,
    authorization: ToolAuthorizationProjection | undefined
  ): void {
    const toolCallId = safeToolCallId(event.toolCallId);
    const current = this.executions.get(toolCallId);
    const completedAt = this.now();
    const toolName = current?.toolName ?? safeToolName(event.toolName);
    const aliasTarget = current?.aliasTarget ?? desktopToolAliasTarget(toolName);
    const resolvedAuthorization = current?.authorization ?? authorization;
    const durationMs = deriveToolDuration(current?.startedAt, completedAt);
    const execution: ToolExecutionView = {
      toolCallId,
      toolName,
      toolKind: current?.toolKind ?? "generic",
      status: event.isError ? "failed" : "completed",
      projectionSource: "live",
      resultState: "present",
      completedAt,
      timingSource: "runtime",
      ...(current?.startedAt === undefined ? {} : { startedAt: current.startedAt }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(current?.inputSummary === undefined ? {} : { inputSummary: current.inputSummary }),
      ...(current?.command === undefined ? {} : { command: current.command }),
      ...(current?.cwd === undefined ? {} : { cwd: current.cwd }),
      ...(current?.progress === undefined ? {} : { progress: current.progress }),
      ...(event.isError ? { failure: projectToolFailure(event.result, "runtime-event") } : {}),
      ...(aliasTarget === undefined ? {} : { aliasTarget }),
      ...(resolvedAuthorization === undefined ? {} : { authorization: resolvedAuthorization })
    };
    this.remember(execution);
    this.emitNow(execution);
  }

  private settle(): void {
    const settledAt = this.now();
    for (const [toolCallId, current] of this.executions) {
      if (current.status !== "running") continue;
      const status = this.cancellationRequested ? "cancelled" : "interrupted";
      const durationMs = deriveToolDuration(current.startedAt, settledAt);
      const execution: ToolExecutionView = {
        ...current,
        status,
        resultState: "unreconciled",
        completedAt: settledAt,
        ...(durationMs === undefined ? {} : { durationMs })
      };
      this.executions.set(toolCallId, execution);
      this.emitNow(execution);
    }
    const items = [...this.executions.values()]
      .filter((execution): execution is ToolExecutionView & { completedAt: number } => (
        execution.completedAt !== undefined && receiptStatus(execution.status) !== undefined
      ))
      .slice(-MAX_TOOL_EXECUTION_RECEIPT_ITEMS)
      .map(toReceiptItem);
    const omittedCount = Math.max(0, this.omittedCount + this.executions.size - items.length);
    if (items.length > 0) {
      try {
        this.target.persistReceipt({
          items,
          ...(omittedCount === 0 ? {} : { omittedCount })
        });
      } catch {
        this.target.reportReceiptFailure();
      }
    }
    this.reset();
  }

  private remember(execution: ToolExecutionView): void {
    if (!this.executions.has(execution.toolCallId) && this.executions.size >= MAX_TOOL_EXECUTION_RECEIPT_ITEMS) {
      const oldest = this.executions.keys().next().value;
      if (oldest !== undefined) {
        this.executions.delete(oldest);
        this.omittedCount += 1;
      }
    }
    this.executions.set(execution.toolCallId, execution);
  }

  private emitNow(execution: ToolExecutionView): void {
    const timer = this.updateTimers.get(execution.toolCallId);
    if (timer) clearTimeout(timer);
    this.updateTimers.delete(execution.toolCallId);
    this.pendingUpdates.delete(execution.toolCallId);
    this.target.emit(execution);
  }
}

function toReceiptItem(execution: ToolExecutionView & { completedAt: number }): ToolExecutionReceiptItem {
  const status = receiptStatus(execution.status);
  if (status === undefined) {
    throw new Error("Tool execution receipt received a non-terminal status.");
  }
  return {
    toolCallId: execution.toolCallId,
    toolName: execution.toolName,
    ...(execution.startedAt === undefined ? {} : { startedAt: execution.startedAt }),
    completedAt: execution.completedAt,
    status
  };
}

function receiptStatus(status: ToolExecutionView["status"]): ToolExecutionReceiptStatus | undefined {
  return status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled"
    ? status
    : undefined;
}

function sameText(
  left: import("@pi67/domain").BoundedToolText | undefined,
  right: import("@pi67/domain").BoundedToolText
): boolean {
  return left?.text === right.text && left.truncated === right.truncated;
}
