import { VIRTUAL_MODEL_STATE_ENTRY, type AgentSession } from "@earendil-works/pi-coding-agent";
import { RuntimeError, type SessionRecoveryView } from "@pi67/domain";
import { AUTO_MODEL_ID, AUTO_MODEL_PROVIDER, isDesktopAutoModel, withDesktopAutoContinuation } from "./auto-routing.js";

export const TASK_RECOVERY_MESSAGE_TYPE = "pi67.task-recovery.v1";
const MAX_RECOVERY_BRANCH_ENTRIES = 4096;

export function inspectInterruptedTask(session: AgentSession): SessionRecoveryView {
  if (!session.isIdle) return { status: "none" };
  const branch = session.sessionManager.getBranch();
  const anchor = session.sessionManager.getLeafId();
  if (!anchor) return { status: "none" };
  const tail = branch.slice(-MAX_RECOVERY_BRANCH_ENTRIES);
  const lastMessage = tail.findLast(entry => entry.type === "message"
    && (entry.message.role === "user" || entry.message.role === "assistant" || entry.message.role === "toolResult"));
  if (!lastMessage || lastMessage.type !== "message") return { status: "none" };
  if (lastMessage.message.role === "assistant" && lastMessage.message.stopReason === "stop") return { status: "none" };
  const userIndex = tail.findLastIndex(entry => entry.type === "message" && entry.message.role === "user");
  if (userIndex < 0) return { status: "blocked", reason: "history-limit", pendingToolCount: 0 };
  const task = tail.slice(userIndex);
  const pending = new Set<string>();
  for (const entry of task) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "assistant") {
      for (const part of message.content) if (part.type === "toolCall") pending.add(part.id);
    } else if (message.role === "toolResult") pending.delete(message.toolCallId);
  }
  if (pending.size) return { status: "blocked", reason: "unconfirmed-tools", pendingToolCount: pending.size };
  // A previous task's selection is not a valid decision for an interrupted new task.
  if (isDesktopAutoModel(session.model) && !task.some(entry => entry.type === "custom"
    && entry.customType === VIRTUAL_MODEL_STATE_ENTRY
    && matchesAutoState(entry.data))) {
    return { status: "blocked", reason: "auto-selection-missing", pendingToolCount: 0 };
  }
  return { status: "available", anchor };
}

function matchesAutoState(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return "provider" in value && value.provider === AUTO_MODEL_PROVIDER
    && "modelId" in value && value.modelId === AUTO_MODEL_ID;
}

/** Caller owns current Workspace/team authorization, configuration and operation admission. */
export async function continueInterruptedTask(session: AgentSession, expectedAnchor: string): Promise<void> {
  const recovery = inspectInterruptedTask(session);
  if (recovery.status !== "available" || recovery.anchor !== expectedAnchor) {
    throw new RuntimeError("INVALID_PAYLOAD", "当前会话已变化或含结果未确认的操作，请重新检查任务记录。", { recoverable: true });
  }
  await withDesktopAutoContinuation(session, () => session.sendCustomMessage({
    customType: TASK_RECOVERY_MESSAGE_TYPE,
    content: "The user explicitly requests continuation of the unfinished task in this conversation. Continue from the recorded context and completed tool results. Do not repeat completed work or assume an unrecorded side effect failed. Existing authorization and tool restrictions still apply.",
    display: false,
    details: { anchor: expectedAnchor }
  }, { triggerTurn: true }));
}
