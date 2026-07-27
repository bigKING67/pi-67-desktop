import type { AgentEvent } from "@pi67/protocol";

type ExternalSessionChangeReason = Extract<
  AgentEvent,
  { type: "session.externalChangeDetected" }
>["payload"]["reason"];

export function externalSessionChangeMessage(reason: ExternalSessionChangeReason): string {
  if (reason === "invalid") return "会话文件包含无效 JSONL，需要先修复或重新导入。";
  if (reason === "unavailable") return "会话文件暂不可用，恢复文件后请重新打开。";
  return "重新打开该会话后才能继续写入。";
}
