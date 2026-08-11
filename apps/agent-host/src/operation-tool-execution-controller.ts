import {
  MAX_OPERATION_TOOL_EXECUTIONS,
  type OperationLifecycle,
  type OperationView,
  type ToolExecutionStatus,
  type ToolExecutionView
} from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";

export interface OperationToolExecutionTarget {
  view: OperationView;
}

export class OperationToolExecutionController {
  private operationId: string | undefined;
  private readonly executions = new Map<string, ToolExecutionView>();
  private truncated = false;

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  reset(): void {
    this.operationId = undefined;
    this.executions.clear();
    this.truncated = false;
  }

  update(target: OperationToolExecutionTarget | undefined, execution: ToolExecutionView): boolean {
    if (!target) return false;
    this.bind(target);
    this.executions.delete(execution.toolCallId);
    this.executions.set(execution.toolCallId, execution);
    this.trim();
    this.updateView(target);
    this.emit({
      type: "operation.toolExecutionChanged",
      payload: { operationId: target.view.operationId, execution }
    });
    return true;
  }

  settle(
    target: OperationToolExecutionTarget,
    lifecycle: Extract<OperationLifecycle, "completed" | "failed" | "cancelled" | "lost">,
    settledAt: number
  ): void {
    this.bind(target);
    const status = terminalToolStatus(lifecycle);
    for (const [toolCallId, execution] of this.executions) {
      if (execution.status !== "running" && execution.status !== "pending") continue;
      const settled: ToolExecutionView = {
        ...execution,
        status,
        resultState: "unreconciled",
        completedAt: settledAt,
        ...(execution.startedAt === undefined
          ? {}
          : { durationMs: Math.max(0, settledAt - execution.startedAt) })
      };
      this.executions.set(toolCallId, settled);
      this.emit({
        type: "operation.toolExecutionChanged",
        payload: { operationId: target.view.operationId, execution: settled }
      });
    }
    this.updateView(target);
  }

  private bind(target: OperationToolExecutionTarget): void {
    if (this.operationId === target.view.operationId) return;
    this.reset();
    this.operationId = target.view.operationId;
    for (const execution of target.view.toolExecutions ?? []) {
      this.executions.set(execution.toolCallId, execution);
    }
    this.truncated = target.view.toolExecutionsTruncated === true;
  }

  private trim(): void {
    while (this.executions.size > MAX_OPERATION_TOOL_EXECUTIONS) {
      const terminal = [...this.executions.entries()].find(([, execution]) => (
        execution.status !== "running" && execution.status !== "pending"
      ));
      const key = terminal?.[0] ?? this.executions.keys().next().value;
      if (key === undefined) return;
      this.executions.delete(key);
      this.truncated = true;
    }
  }

  private updateView(target: OperationToolExecutionTarget): void {
    target.view = {
      ...target.view,
      toolExecutions: [...this.executions.values()],
      ...(this.truncated ? { toolExecutionsTruncated: true } : {})
    };
  }
}

function terminalToolStatus(
  lifecycle: Extract<OperationLifecycle, "completed" | "failed" | "cancelled" | "lost">
): ToolExecutionStatus {
  if (lifecycle === "cancelled") return "cancelled";
  if (lifecycle === "lost") return "lost";
  return "interrupted";
}
