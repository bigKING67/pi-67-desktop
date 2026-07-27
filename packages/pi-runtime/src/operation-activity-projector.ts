import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { OperationActivity, RuntimeOperationActivity, ToolPresentationKind } from "@pi67/domain";

const MAX_ACTIVE_TOOLS = 64;

/** Projects Pi's real session lifecycle into the one current desktop activity. */
export class OperationActivityProjector {
  private readonly activeTools = new Map<string, Extract<OperationActivity, { kind: "tool" }>>();
  private current: RuntimeOperationActivity | undefined;

  constructor(private readonly emit: (activity: RuntimeOperationActivity) => void) {}

  reset(): void {
    this.activeTools.clear();
    this.current = undefined;
  }

  handle(event: AgentSessionEvent, toolKind: ToolPresentationKind = "generic"): void {
    switch (event.type) {
      case "agent_start":
      case "turn_start":
      case "auto_retry_start":
      case "summarization_retry_scheduled":
      case "summarization_retry_attempt_start":
        this.publish(null);
        return;
      case "message_start":
        if (event.message.role === "assistant") this.publish(null);
        return;
      case "message_update": {
        const update = event.assistantMessageEvent.type;
        if (update === "thinking_start" || update === "thinking_delta") {
          this.publish({ kind: "thinking" });
        } else if (update === "text_start" || update === "text_delta") {
          this.publish({ kind: "responding" });
        } else if (update === "toolcall_start") {
          this.publish(null);
        }
        return;
      }
      case "tool_execution_start": {
        const activity = {
          kind: "tool",
          toolCallId: event.toolCallId,
          toolKind
        } as const;
        this.activeTools.delete(event.toolCallId);
        this.activeTools.set(event.toolCallId, activity);
        trimOldestTools(this.activeTools);
        this.publish(activity);
        return;
      }
      case "tool_execution_end":
        this.activeTools.delete(event.toolCallId);
        this.publish(lastActiveTool(this.activeTools) ?? null);
        return;
      case "compaction_start":
        this.publish({ kind: "compaction" });
        return;
      case "compaction_end":
        this.publish(null);
        return;
      case "agent_settled":
        this.publish(null);
        this.reset();
        return;
    }
  }

  private publish(activity: RuntimeOperationActivity): void {
    if (sameActivity(this.current, activity)) return;
    this.current = activity;
    this.emit(activity);
  }
}

function lastActiveTool(
  activeTools: ReadonlyMap<string, Extract<OperationActivity, { kind: "tool" }>>
): Extract<OperationActivity, { kind: "tool" }> | undefined {
  let latest: Extract<OperationActivity, { kind: "tool" }> | undefined;
  for (const activity of activeTools.values()) latest = activity;
  return latest;
}

function trimOldestTools(
  activeTools: Map<string, Extract<OperationActivity, { kind: "tool" }>>
): void {
  while (activeTools.size > MAX_ACTIVE_TOOLS) {
    const oldest = activeTools.keys().next().value;
    if (oldest === undefined) return;
    activeTools.delete(oldest);
  }
}

function sameActivity(
  left: RuntimeOperationActivity | undefined,
  right: RuntimeOperationActivity
): boolean {
  if (left === null || right === null) return left === right;
  if (!left || left.kind !== right.kind) return false;
  if (left.kind === "tool" && right.kind === "tool") {
    return left.toolCallId === right.toolCallId && left.toolKind === right.toolKind;
  }
  return true;
}
