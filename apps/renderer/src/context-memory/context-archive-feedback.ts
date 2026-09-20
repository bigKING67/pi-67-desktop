import type { AgentEvent } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { commitContextSession } from "./context-memory-controller.js";

type Completion = Extract<AgentEvent, { type: "context.commitCompleted" }>;
type Failure = Extract<AgentEvent, { type: "context.commitFailed" }>;
export type ArchiveOutcome = NonNullable<Completion["payload"]["outcome"]>;

export const archiveOutcomeMessage: Record<ArchiveOutcome, string> = {
  retained: "暂时无需归档：当前消息仍在最近对话保留范围内；继续对话后再归档。",
  empty: "暂无可归档消息，本次没有启动记忆抽取。",
  skipped: "本次未归档消息，也未确认新的记忆抽取。",
  extracted: "本次归档的记忆处理已完成；不代表一定新增了记忆。",
  "extraction-failed": "消息已归档，但记忆处理未成功。原始会话仍保留，请检查本地记忆服务与模型配置。",
  unconfirmed: "暂未确认记忆处理结果；后台可能仍在执行。请勿为刷新状态重复归档。",
};

/** Subscribe before sending: an async operation may finish before its ack. */
export async function archiveWithFeedback(
  workspaceId: string, sessionId: string, signal: AbortSignal, onAccepted: () => void,
): Promise<ArchiveOutcome> {
  if (signal.aborted) return "unconfirmed";
  let operationId: string | undefined;
  const early: Array<Completion | Failure> = [];
  let finish!: (outcome: ArchiveOutcome) => void;
  let fail!: (error: Error) => void;
  const terminal = new Promise<ArchiveOutcome>((resolve, reject) => { finish = resolve; fail = reject; });
  // Teardown can reject while the request is still awaiting acknowledgement.
  void terminal.catch(() => undefined);
  const consume = (event: Completion | Failure) => {
    if (event.payload.operationId !== operationId) return;
    if (event.type === "context.commitFailed") fail(new Error("归档操作未完成，处理结果未知。请检查本地记忆服务；不要盲目重试。"));
    else finish(event.payload.outcome ?? "unconfirmed");
  };
  const unsubscribe = agentConnectionController.subscribe({
    onEvent(event, envelope) {
      if (signal.aborted || envelope.context.scope !== "workspace" || envelope.context.workspaceId !== workspaceId
        || (event.type !== "context.commitCompleted" && event.type !== "context.commitFailed")
        || event.payload.sessionId !== sessionId) return;
      if (operationId) consume(event);
      else if (early.length < 8) early.push(event);
    },
    onTeardown: () => finish("unconfirmed"),
    onSequenceGap: () => finish("unconfirmed"),
  });
  const abort = () => finish("unconfirmed");
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 75_000);
  try {
    const accepted = await commitContextSession(workspaceId, sessionId);
    operationId = accepted.operationId;
    if (!signal.aborted) onAccepted();
    for (const event of early) consume(event);
    return await terminal;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    unsubscribe();
  }
}
