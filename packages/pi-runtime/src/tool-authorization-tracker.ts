import type {
  ToolAuthorizationProjection,
  ToolAutoAuthorizationReason
} from "@pi67/domain";

const MAX_TRACKED_TOOL_AUTHORIZATIONS = 64;

/** Carries a bounded, non-sensitive safety decision from tool_call to operation activity. */
export class ToolAuthorizationTracker {
  private readonly byToolCallId = new Map<string, ToolAuthorizationProjection>();

  record(toolCallId: string, reason: ToolAutoAuthorizationReason): void {
    if (!toolCallId || toolCallId.length > 512) return;
    this.byToolCallId.delete(toolCallId);
    this.byToolCallId.set(toolCallId, { mode: "auto", reason });
    while (this.byToolCallId.size > MAX_TRACKED_TOOL_AUTHORIZATIONS) {
      const oldest = this.byToolCallId.keys().next().value;
      if (oldest === undefined) break;
      this.byToolCallId.delete(oldest);
    }
  }

  get(toolCallId: string): ToolAuthorizationProjection | undefined {
    return this.byToolCallId.get(toolCallId);
  }

  complete(toolCallId: string): void {
    this.byToolCallId.delete(toolCallId);
  }

  reset(): void {
    this.byToolCallId.clear();
  }
}
