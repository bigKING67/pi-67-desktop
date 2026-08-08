import {
  taskConsumesRunSlot,
  type RuntimeRecoveryRecord,
  type RuntimeStatus,
  type SessionCreationRecoveryRecord,
  type TaskLifecycle
} from "@pi67/domain";
import type { RendererWorkbenchTask } from "./workbench-store-contract.js";

export function taskFromRuntimeRecovery(record: RuntimeRecoveryRecord): RendererWorkbenchTask {
  return {
    id: record.taskId,
    conversation: record.conversation,
    workspaceId: record.conversation.workspaceId,
    sessionId: record.sessionId,
    taskGeneration: record.taskGeneration,
    sessionGeneration: record.sessionGeneration,
    lifecycle: record.lastKnownLifecycle,
    runtime: stoppedRuntime(record.lastKnownLifecycle),
    title: "未命名会话",
    titleSource: "fallback",
    sessionFileIdentity: record.conversation.sessionFileIdentity,
    sessionPath: record.conversation.sessionPath,
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto",
    recoveryHostInstanceId: record.hostInstanceId,
    recoveryHostEpoch: record.hostEpoch
  };
}

export function taskFromSessionCreationRecovery(
  record: SessionCreationRecoveryRecord
): RendererWorkbenchTask {
  return {
    id: record.taskId,
    conversation: {
      kind: "provisional",
      workspaceId: record.workspaceId,
      draftId: record.taskId
    },
    workspaceId: record.workspaceId,
    sessionId: `pending:${record.taskId}`,
    taskGeneration: record.taskGeneration,
    lifecycle: "draft",
    runtime: {
      phase: "failed",
      detail: "对话创建结果尚未确认",
      recoverable: true
    },
    title: "未命名会话",
    titleSource: "fallback",
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto",
    creationId: record.creationId,
    creationStatus: "unconfirmed"
  };
}

function stoppedRuntime(lifecycle: TaskLifecycle): RuntimeStatus {
  const lost = taskConsumesRunSlot(lifecycle);
  return {
    phase: lost ? "failed" : "stopped",
    detail: lost ? "上次运行已中断" : "会话尚未运行",
    recoverable: true
  };
}
