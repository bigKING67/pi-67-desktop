import type { AgentSession, AgentSessionEvent, SessionStats } from "@earendil-works/pi-coding-agent";
import type {
  RuntimeOperationActivity,
  ToolPresentationKind,
  WorkspaceChangeView
} from "@pi67/domain";
import type { AgentEvent, StreamDelta } from "@pi67/protocol";
import {
  conversationChangedEvent,
  queueChangedEvent,
  sessionMetaChangedEvent,
  usageChangedEvent
} from "./incremental-events.js";
import { normalizeStreamDelta } from "./message-normalizer.js";
import {
  projectLiveWorkspaceChangeEnd,
  projectLiveWorkspaceChangeStart
} from "./workspace-change-projection.js";
import { OperationActivityProjector } from "./operation-activity-projector.js";

interface SessionEventProjectionTarget {
  getSession: () => AgentSession;
  getStats: () => SessionStats;
  emit: (event: AgentEvent) => void;
  emitActivity: (activity: RuntimeOperationActivity) => void;
  pushStream: (delta: StreamDelta) => void;
  flushStream: () => void;
  bindToolExecutionStart: (toolCallId: string, toolName: string) => ToolPresentationKind;
  completeToolExecution: (toolCallId: string) => void;
  settleActiveToolExecutions: () => void;
}

export class SessionEventProjector {
  private readonly liveChanges = new Map<string, WorkspaceChangeView>();
  private readonly activity: OperationActivityProjector;

  constructor(private readonly target: SessionEventProjectionTarget) {
    this.activity = new OperationActivityProjector(target.emitActivity);
  }

  reset(): void {
    this.liveChanges.clear();
    this.activity.reset();
  }

  handle(event: AgentSessionEvent): void {
    const toolKind = event.type === "tool_execution_start"
      ? this.target.bindToolExecutionStart(event.toolCallId, event.toolName)
      : undefined;
    this.activity.handle(event, toolKind);
    if (event.type === "tool_execution_start") {
      const change = projectLiveWorkspaceChangeStart(event);
      if (change) {
        this.liveChanges.set(event.toolCallId, change);
        this.emitChange(change);
      }
    }
    if (event.type === "tool_execution_end") {
      this.target.completeToolExecution(event.toolCallId);
      const start = this.liveChanges.get(event.toolCallId);
      if (start) {
        this.liveChanges.delete(event.toolCallId);
        this.emitChange(projectLiveWorkspaceChangeEnd(start, event.toolName, event.result, event.isError));
      }
    }
    if (event.type === "message_update") {
      const delta = normalizeStreamDelta(event);
      if (delta) this.target.pushStream(delta);
    }
    if (event.type === "entry_appended") {
      this.target.emit({ type: "tree.changed", payload: { reason: "session-entry" } });
    }
    if (event.type === "message_end" || event.type === "agent_end" || event.type === "agent_settled") {
      this.target.flushStream();
    }

    const session = this.target.getSession();
    if (event.type === "queue_update") this.target.emit(queueChangedEvent(session));
    if (event.type === "thinking_level_changed") this.target.emit(sessionMetaChangedEvent(session));
    if (event.type === "agent_settled") {
      this.target.settleActiveToolExecutions();
      for (const change of this.liveChanges.values()) this.emitChange({ ...change, status: "interrupted" });
      this.liveChanges.clear();
      this.target.emit(conversationChangedEvent(session, "settled"));
      this.target.emit(sessionMetaChangedEvent(session));
      this.target.emit(usageChangedEvent(this.target.getStats()));
    }
    if (event.type === "compaction_end") {
      this.target.emit(conversationChangedEvent(session, "compacted"));
      this.target.emit({ type: "tree.changed", payload: { reason: "compacted" } });
      this.target.emit(usageChangedEvent(this.target.getStats()));
    }
  }

  private emitChange(change: WorkspaceChangeView): void {
    this.target.emit({
      type: "workspace.changeChanged",
      payload: { sessionId: this.target.getSession().sessionId, change }
    });
  }
}
