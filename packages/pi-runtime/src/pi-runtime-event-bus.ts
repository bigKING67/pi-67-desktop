import type {
  RuntimeOperationActivity,
  ToolExecutionView
} from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";

export class PiRuntimeEventBus {
  private readonly agentListeners = new Set<(event: AgentEvent) => void>();
  private readonly activityListeners = new Set<(activity: RuntimeOperationActivity) => void>();
  private readonly toolExecutionListeners = new Set<(execution: ToolExecutionView) => void>();

  subscribeAgent(listener: (event: AgentEvent) => void): () => void {
    this.agentListeners.add(listener);
    return () => this.agentListeners.delete(listener);
  }

  subscribeActivity(listener: (activity: RuntimeOperationActivity) => void): () => void {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  subscribeToolExecution(listener: (execution: ToolExecutionView) => void): () => void {
    this.toolExecutionListeners.add(listener);
    return () => this.toolExecutionListeners.delete(listener);
  }

  emitAgent(event: AgentEvent): void {
    this.agentListeners.forEach((listener) => listener(event));
  }

  emitActivity(activity: RuntimeOperationActivity): void {
    this.activityListeners.forEach((listener) => listener(activity));
  }

  emitToolExecution(execution: ToolExecutionView): void {
    this.toolExecutionListeners.forEach((listener) => listener(execution));
  }

  clear(): void {
    this.agentListeners.clear();
    this.activityListeners.clear();
    this.toolExecutionListeners.clear();
  }
}
