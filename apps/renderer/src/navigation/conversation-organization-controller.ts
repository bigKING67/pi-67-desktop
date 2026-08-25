import {
  conversationArchiveBlocker,
  MAX_PINNED_CONVERSATION_ORDER_ITEMS,
  MAX_SESSION_CATALOG_PAGE_ITEMS,
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
import { queryFirstSessionCatalog, querySessionCatalogPage } from "./session-catalog-controller.js";

export async function renameRendererConversation(
  workspaceId: WorkspaceId,
  session: RendererSessionLocator,
  name: string | undefined
): Promise<boolean> {
  const mutation = name === undefined
    ? { action: "clear" as const }
    : { action: "set" as const, name: name.trim() };
  if (mutation.action === "set" && !mutation.name) return false;
  const task = taskForSession(workspaceId, session);
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
          : task.recentUserMessagePreview ? "seed" : "fallback"
      });
    } else {
      await agentConnectionController.request(
        "session.nameByPath",
        { path: session.path, mutation },
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

export async function regenerateRendererConversationTitle(
  workspaceId: WorkspaceId,
  session: RendererSessionLocator
): Promise<boolean> {
  const task = taskForSession(workspaceId, session);
  if (!task || task.sessionGeneration === undefined || task.runtime.phase === "stopped") {
    publishNotification({
      level: "warning",
      title: "请先打开这个对话",
      message: "重新生成标题会使用该对话当前选择的 Pi 模型。"
    });
    return false;
  }
  try {
    await agentConnectionController.request(
      "session.title.regenerate",
      {},
      [],
      { context: workbenchProtocolContextForTask(task) }
    );
    await queryFirstSessionCatalog(workspaceId);
    publishNotification({ level: "success", title: "自动标题已重新生成" });
    return true;
  } catch (error) {
    publishNotification({
      level: "error",
      title: "无法重新生成标题",
      message: errorMessage(error)
    });
    return false;
  }
}

export async function setRendererConversationPinned(
  workspaceId: WorkspaceId,
  session: RendererSessionLocator & Pick<SessionSummary, "pinnedAt">
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

export type ConversationSnoozePreset = "later" | "tomorrow" | "next-week";

export function conversationSnoozeUntil(preset: ConversationSnoozePreset, now = Date.now()): number {
  if (preset === "later") return now + 60 * 60 * 1_000;
  const current = new Date(now);
  if (preset === "tomorrow") {
    return new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 1,
      9
    ).getTime();
  }
  const daysUntilNextMonday = current.getDay() === 0 ? 1 : 8 - current.getDay();
  return new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() + daysUntilNextMonday,
    9
  ).getTime();
}

export async function snoozeRendererConversation(
  workspaceId: WorkspaceId,
  session: RendererSessionLocator,
  preset: ConversationSnoozePreset
): Promise<boolean> {
  const task = taskForSession(workspaceId, session);
  const blocker = conversationArchiveBlocker({
    kind: "session",
    ...(task ? { lifecycle: task.lifecycle, hasDraft: hasTaskDraft(task) } : {})
  });
  if (blocker) {
    publishNotification({
      level: "warning",
      title: "暂时无法稍后处理对话",
      message: snoozeBlockerMessage(blocker)
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
  const snoozedUntil = conversationSnoozeUntil(preset);
  try {
    await setSnoozedUntil(workspaceId, session.path, snoozedUntil);
    const workbench = rendererWorkbenchStore.getState();
    if (workbench.selectedSurface?.kind === "conversation"
      && rendererConversationIdentity(workbench.selectedSurface.conversation)
        === rendererConversationIdentity({
          kind: "session",
          workspaceId,
          sessionFileIdentity: session.fileIdentity,
          sessionPath: session.path
        })) {
      workbench.selectWorkspace(workspaceId);
    }
    await queryFirstSessionCatalog(workspaceId);
    publishNotification({
      level: "success",
      title: `对话将在${formatSnoozeUntil(snoozedUntil)}回到最近列表`,
      action: {
        label: "撤销",
        run: async () => { await wakeRendererConversation(workspaceId, session); }
      }
    });
    return true;
  } catch (error) {
    publishNotification({ level: "error", title: "无法稍后处理对话", message: errorMessage(error) });
    return false;
  }
}

export async function wakeRendererConversation(
  workspaceId: WorkspaceId,
  session: RendererSessionLocator,
  notify = true
): Promise<boolean> {
  try {
    await setSnoozedUntil(workspaceId, session.path, undefined);
    await queryFirstSessionCatalog(workspaceId);
    if (notify) publishNotification({ level: "success", title: "对话已回到最近列表" });
    return true;
  } catch (error) {
    if (notify) publishNotification({ level: "error", title: "无法唤醒对话", message: errorMessage(error) });
    return false;
  }
}

export async function wakeRendererConversationForAttention(
  workspaceId: WorkspaceId,
  session: RendererSessionLocator
): Promise<void> {
  if (await wakeRendererConversation(workspaceId, session, false)) return;
  publishNotification({
    level: "warning",
    title: "对话已有新动态",
    message: "稍后状态未能自动清除，请从对话菜单手动唤醒。"
  });
}

export async function moveRendererPinnedConversation(
  workspaceId: WorkspaceId,
  fileIdentity: string,
  direction: "up" | "down"
): Promise<boolean> {
  try {
    const pinned = await loadPinnedSessions(workspaceId);
    const index = pinned.findIndex((session) => session.fileIdentity === fileIdentity);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= pinned.length) return false;
    const order = [...pinned];
    [order[index], order[targetIndex]] = [order[targetIndex]!, order[index]!];
    return persistPinnedOrder(workspaceId, order.map((session) => session.path));
  } catch (error) {
    publishPinnedOrderError(error);
    return false;
  }
}

export async function placeRendererPinnedConversationBefore(
  workspaceId: WorkspaceId,
  draggedFileIdentity: string,
  targetFileIdentity: string
): Promise<boolean> {
  if (draggedFileIdentity === targetFileIdentity) return false;
  try {
    const pinned = await loadPinnedSessions(workspaceId);
    const dragged = pinned.find((session) => session.fileIdentity === draggedFileIdentity);
    const targetIndex = pinned.findIndex((session) => session.fileIdentity === targetFileIdentity);
    if (!dragged || targetIndex < 0) return false;
    const withoutDragged = pinned.filter((session) => session.fileIdentity !== draggedFileIdentity);
    const insertionIndex = withoutDragged.findIndex((session) => session.fileIdentity === targetFileIdentity);
    withoutDragged.splice(insertionIndex < 0 ? targetIndex : insertionIndex, 0, dragged);
    return persistPinnedOrder(workspaceId, withoutDragged.map((session) => session.path));
  } catch (error) {
    publishPinnedOrderError(error);
    return false;
  }
}

async function loadPinnedSessions(workspaceId: WorkspaceId): Promise<SessionSummary[]> {
  const pinned: SessionSummary[] = [];
  let cursor: Awaited<ReturnType<typeof querySessionCatalogPage>>["nextCursor"];
  while (true) {
    const page = await querySessionCatalogPage({
      workspaceId,
      limit: MAX_SESSION_CATALOG_PAGE_ITEMS,
      ...(cursor === undefined ? {} : { cursor })
    });
    if (page.rebuilding || page.state === "unavailable" || page.incomplete) {
      throw new Error("Session 目录尚未完成，暂时不能调整置顶顺序。");
    }
    for (const session of page.items) {
      if (session.pinnedAt === undefined) return pinned;
      pinned.push(session);
      if (pinned.length > MAX_PINNED_CONVERSATION_ORDER_ITEMS) {
        throw new Error("置顶对话数量超过支持上限。");
      }
    }
    if (!page.hasMore) return pinned;
    if (!page.nextCursor) throw new Error("Session 目录分页信息不完整。");
    cursor = page.nextCursor;
  }
}

async function persistPinnedOrder(workspaceId: WorkspaceId, paths: string[]): Promise<boolean> {
  try {
    await agentConnectionController.request(
      "conversation.reorderPinned",
      { paths },
      [],
      { context: { scope: "workspace", workspaceId } }
    );
    await queryFirstSessionCatalog(workspaceId);
    return true;
  } catch (error) {
    publishNotification({
      level: "error",
      title: "无法调整置顶顺序",
      message: errorMessage(error)
    });
    return false;
  }
}

function publishPinnedOrderError(error: unknown): void {
  publishNotification({
    level: "error",
    title: "无法调整置顶顺序",
    message: errorMessage(error)
  });
}

export async function archiveRendererConversation(
  workspaceId: WorkspaceId,
  session: RendererSessionLocator
): Promise<boolean> {
  const task = taskForSession(workspaceId, session);
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
    await setArchived(workspaceId, session.path, true);
    const workbench = rendererWorkbenchStore.getState();
    if (session && workbench.selectedSurface?.kind === "conversation"
      && rendererConversationIdentity(workbench.selectedSurface.conversation)
        === rendererConversationIdentity({
          kind: "session",
          workspaceId,
          sessionFileIdentity: session.fileIdentity,
          sessionPath: session.path
        })) {
      workbench.selectWorkspace(workspaceId);
    }
    await queryFirstSessionCatalog(workspaceId);
    publishNotification({
      level: "success",
      title: "对话已归档",
      action: {
        label: "撤销",
        run: async () => { await restoreRendererConversation(workspaceId, session); }
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
  session: RendererSessionLocator,
  open = false
): Promise<boolean> {
  try {
    await setArchived(workspaceId, session.path, false);
    await queryFirstSessionCatalog(workspaceId);
    if (open) {
      const workbench = rendererWorkbenchStore.getState();
      workbench.selectConversation({
        kind: "session",
        workspaceId,
        sessionFileIdentity: session.fileIdentity,
        sessionPath: session.path
      });
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

async function setSnoozedUntil(
  workspaceId: WorkspaceId,
  path: string,
  snoozedUntil: number | undefined
): Promise<void> {
  await agentConnectionController.request(
    "conversation.snooze",
    { path, ...(snoozedUntil === undefined ? {} : { snoozedUntil }) },
    [],
    { context: { scope: "workspace", workspaceId } }
  );
}

function taskForSession(
  workspaceId: WorkspaceId,
  session: RendererSessionLocator
): RendererWorkbenchTask | undefined {
  return taskForConversation(rendererWorkbenchStore.getState().tasks, {
    kind: "session",
    workspaceId,
    sessionFileIdentity: session.fileIdentity,
    sessionPath: session.path
  });
}

export interface RendererSessionLocator {
  fileIdentity: string;
  path: string;
}

function hasTaskDraft(task: RendererWorkbenchTask): boolean {
  const draft = useTaskDraftStore.getState().drafts[task.id];
  return task.hasDraft
    || task.attachmentCount > 0
    || Boolean(draft && (
      draft.text.trim()
      || draft.attachments.length > 0
      || draft.workspaceFiles.length > 0
    ));
}

function archiveBlockerMessage(blocker: NonNullable<ReturnType<typeof conversationArchiveBlocker>>): string {
  if (blocker === "active-task") return "任务仍在运行或等待输入，请先完成或停止任务。";
  if (blocker === "initializing") return "对话仍在初始化，请稍后再试。";
  if (blocker === "draft") return "输入框中仍有未发送内容，请发送或清空草稿。";
  return "尚未保存的新对话不能归档。";
}

function snoozeBlockerMessage(blocker: NonNullable<ReturnType<typeof conversationArchiveBlocker>>): string {
  if (blocker === "active-task") return "任务仍在运行、等待批准或等待扩展输入，请先处理或停止任务。";
  if (blocker === "initializing") return "对话仍在初始化，请稍后再试。";
  if (blocker === "draft") return "输入框中仍有未发送内容，请先发送、暂存或清空草稿。";
  return "尚未保存的新对话不能稍后处理。";
}

function formatSnoozeUntil(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Pi 运行服务未能完成操作。";
}
