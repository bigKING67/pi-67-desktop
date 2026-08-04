import {
  conversationArchiveBlocker,
  type SessionSummary,
  type WorkspaceId
} from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import {
  rendererWorkbenchStore,
  rendererConversationIdentity,
  taskForConversation,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";
import { queryFirstSessionCatalog } from "./session-catalog-controller.js";

export async function renameRendererConversation(
  workspaceId: WorkspaceId,
  path: string,
  name: string | undefined
): Promise<boolean> {
  const mutation = name === undefined
    ? { action: "clear" as const }
    : { action: "set" as const, name: name.trim() };
  if (mutation.action === "set" && !mutation.name) return false;
  const task = taskForSession(workspaceId, path);
  try {
    if (task && task.sessionGeneration !== undefined && task.runtime.phase !== "stopped") {
      await agentConnectionController.request(
        "session.name",
        { mutation },
        [],
        { context: workbenchProtocolContextForTask(task) }
      );
      rendererWorkbenchStore.getState().updateTask(task.id, {
        title: mutation.action === "set"
          ? mutation.name
          : task.recentUserMessagePreview ?? "未命名任务",
        titleSource: mutation.action === "set"
          ? "explicit"
          : task.recentUserMessagePreview ? "latest-user" : "fallback"
      });
    } else {
      await agentConnectionController.request(
        "session.nameByPath",
        { path, mutation },
        [],
        { context: { scope: "workspace", workspaceId } }
      );
    }
    await queryFirstSessionCatalog(workspaceId);
    publishNotification({
      level: "success",
      title: mutation.action === "set" ? "对话已重命名" : "已恢复自动标题"
    });
    return true;
  } catch (error) {
    publishNotification({
      level: "error",
      title: mutation.action === "set" ? "无法重命名对话" : "无法恢复自动标题",
      message: errorMessage(error)
    });
    return false;
  }
}

export async function setRendererConversationPinned(
  workspaceId: WorkspaceId,
  session: Pick<SessionSummary, "path" | "pinnedAt">
): Promise<boolean> {
  const pinned = session.pinnedAt === undefined;
  try {
    await agentConnectionController.request(
      "conversation.pin",
      { path: session.path, pinned },
      [],
      { context: { scope: "workspace", workspaceId } }
    );
    await queryFirstSessionCatalog(workspaceId);
    return true;
  } catch (error) {
    publishNotification({
      level: "error",
      title: pinned ? "无法置顶对话" : "无法取消置顶",
      message: errorMessage(error)
    });
    return false;
  }
}

export async function archiveRendererConversation(
  workspaceId: WorkspaceId,
  path: string
): Promise<boolean> {
  const task = taskForSession(workspaceId, path);
  const blocker = conversationArchiveBlocker({
    kind: "session",
    ...(task ? { lifecycle: task.lifecycle, hasDraft: hasTaskDraft(task) } : {})
  });
  if (blocker) {
    publishNotification({
      level: "warning",
      title: "暂时无法归档对话",
      message: archiveBlockerMessage(blocker)
    });
    return false;
  }
  if (task && task.runtime.phase !== "stopped") {
    try {
      await agentConnectionController.request(
        "task.close",
        { mode: "dispose" },
        [],
        { context: workbenchProtocolContextForTask(task) }
      );
      rendererWorkbenchStore.getState().removeRuntimeTask(task.id);
    } catch (error) {
      publishNotification({ level: "error", title: "无法释放对话运行资源", message: errorMessage(error) });
      return false;
    }
  }
  try {
    await setArchived(workspaceId, path, true);
    const workbench = rendererWorkbenchStore.getState();
    if (workbench.selectedSurface?.kind === "conversation"
      && rendererConversationIdentity(workbench.selectedSurface.conversation)
        === rendererConversationIdentity({ kind: "session", workspaceId, sessionPath: path })) {
      workbench.selectWorkspace(workspaceId);
    }
    await queryFirstSessionCatalog(workspaceId);
    publishNotification({
      level: "success",
      title: "对话已归档",
      action: {
        label: "撤销",
        run: async () => { await restoreRendererConversation(workspaceId, path); }
      }
    });
    return true;
  } catch (error) {
    publishNotification({ level: "error", title: "无法归档对话", message: errorMessage(error) });
    return false;
  }
}

export async function restoreRendererConversation(
  workspaceId: WorkspaceId,
  path: string,
  open = false
): Promise<boolean> {
  try {
    await setArchived(workspaceId, path, false);
    await queryFirstSessionCatalog(workspaceId);
    if (open) {
      const workbench = rendererWorkbenchStore.getState();
      workbench.selectConversation({ kind: "session", workspaceId, sessionPath: path });
    }
    publishNotification({ level: "success", title: "对话已恢复" });
    return true;
  } catch (error) {
    publishNotification({ level: "error", title: "无法恢复对话", message: errorMessage(error) });
    return false;
  }
}

async function setArchived(workspaceId: WorkspaceId, path: string, archived: boolean): Promise<void> {
  await agentConnectionController.request(
    "conversation.archive",
    { path, archived },
    [],
    { context: { scope: "workspace", workspaceId } }
  );
}

function taskForSession(workspaceId: WorkspaceId, path: string): RendererWorkbenchTask | undefined {
  return taskForConversation(rendererWorkbenchStore.getState().tasks, {
    kind: "session",
    workspaceId,
    sessionPath: path
  });
}

function hasTaskDraft(task: RendererWorkbenchTask): boolean {
  const draft = useTaskDraftStore.getState().drafts[task.id];
  return task.hasDraft
    || task.attachmentCount > 0
    || Boolean(draft && (draft.text.trim() || draft.attachments.length > 0));
}

function archiveBlockerMessage(blocker: NonNullable<ReturnType<typeof conversationArchiveBlocker>>): string {
  if (blocker === "active-task") return "任务仍在运行或等待输入，请先完成或停止任务。";
  if (blocker === "initializing") return "对话仍在初始化，请稍后再试。";
  if (blocker === "draft") return "输入框中仍有未发送内容，请发送或清空草稿。";
  return "尚未保存的新对话不能归档。";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Pi 运行服务未能完成操作。";
}
