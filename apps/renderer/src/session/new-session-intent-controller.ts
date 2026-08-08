import { MAX_RUNNING_TASKS, type ComposerWorkspaceFileRef } from "@pi67/domain";
import { publishNotification } from "../notifications/notification-store.js";
import type { DraftAttachment } from "../composer/composer-attachments.js";
import {
  submitRendererPrompt,
  type PromptSubmissionResult
} from "../composer/prompt-submission-controller.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask
} from "../workbench/workbench-store.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import { materializeRendererSessionIntent } from "./session-lifecycle-controller.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { setRendererSessionInteractionMode } from "./session-plan-controller.js";

const MATERIALIZATION_TIMEOUT_MS = 5_000;
const inFlightByTask = new Map<string, Promise<PromptSubmissionResult>>();

export function submitRendererNewSessionIntent(
  taskId: string,
  text: string,
  submissionId: string,
  attachments: readonly DraftAttachment[] = [],
  workspaceFiles: readonly ComposerWorkspaceFileRef[] = []
): Promise<PromptSubmissionResult> {
  const existing = inFlightByTask.get(taskId);
  if (existing) return existing;
  const submission = submitIntent(taskId, text, submissionId, attachments, workspaceFiles).finally(() => {
    if (inFlightByTask.get(taskId) === submission) inFlightByTask.delete(taskId);
  });
  inFlightByTask.set(taskId, submission);
  return submission;
}

async function submitIntent(
  taskId: string,
  text: string,
  submissionId: string,
  attachments: readonly DraftAttachment[],
  workspaceFiles: readonly ComposerWorkspaceFileRef[]
): Promise<PromptSubmissionResult> {
  const selected = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  if (
    !selected
    || selected.id !== taskId
    || selected.conversation.kind !== "provisional"
    || selected.creationStatus !== undefined
  ) {
    return { accepted: false, error: "当前新对话草稿已失效，请重新选择后再发送。" };
  }
  if (rendererWorkbenchStore.getState().canStartTask(taskId) === "run-limit") {
    const error = `已有 ${MAX_RUNNING_TASKS} 个会话任务正在运行或等待交互。请先完成或停止一个任务。`;
    publishNotification({
      level: "warning",
      title: "已达到并发上限",
      message: `${error} 草稿和附件已保留。`
    });
    return { accepted: false, error };
  }

  const interactionMode = useTaskDraftStore.getState().drafts[taskId]?.interactionMode ?? "execute";

  const materialized = await materializeRendererSessionIntent(taskId);
  if (materialized.status !== "materialized") {
    return { accepted: false, error: materialized.error };
  }
  if (!await waitForMaterializedTask(taskId)) {
    const error = "对话已经创建，但界面尚未完成绑定。草稿和附件已保留，请稍候后重试。";
    publishNotification({ level: "warning", title: "首条消息尚未发送", message: error });
    return { accepted: false, error };
  }
  if (
    interactionMode === "plan"
    && !await setRendererSessionInteractionMode("plan")
  ) {
    const error = "对话已经创建，但计划模式未能确认。草稿和附件已保留，请重试。";
    publishNotification({ level: "warning", title: "首条消息尚未发送", message: error });
    return { accepted: false, error };
  }
  return submitRendererPrompt(text, "send", submissionId, attachments, workspaceFiles);
}

function waitForMaterializedTask(taskId: string): Promise<boolean> {
  if (taskMatchesActiveProjection(taskId)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      unsubscribeWorkbench();
      unsubscribeProjection();
      resolve(result);
    };
    const check = () => {
      if (taskMatchesActiveProjection(taskId)) finish(true);
    };
    const timer = globalThis.setTimeout(() => finish(false), MATERIALIZATION_TIMEOUT_MS);
    const unsubscribeWorkbench = rendererWorkbenchStore.subscribe(check);
    const unsubscribeProjection = useSessionProjectionStore.subscribe(check);
    check();
  });
}

function taskMatchesActiveProjection(taskId: string): boolean {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  const projection = useSessionProjectionStore.getState();
  return Boolean(
    task
    && task.conversation.kind === "session"
    && projection.authority.phase === "active"
    && projection.identity?.sessionFileIdentity === task.conversation.sessionFileIdentity
    && projection.authority.sessionId === task.sessionId
    && projection.authority.sessionGeneration === task.sessionGeneration
  );
}
