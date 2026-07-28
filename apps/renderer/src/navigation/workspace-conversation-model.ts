import {
  taskConsumesRunSlot,
  type ConversationKey,
  type SessionSummary
} from "@pi67/domain";
import {
  rendererConversationIdentity,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { formatSessionRelativeTime } from "./session-navigation.js";

export interface ConversationRowModel {
  identity: string;
  conversation: ConversationKey;
  task?: RendererWorkbenchTask;
  title: string;
  meta: string;
  status?: "running" | "waiting" | "draft";
  priority: boolean;
  modifiedAt: number;
}

export function conversationRows(
  workspaceId: string,
  tasks: RendererWorkbenchTask[],
  sessions: SessionSummary[],
  query: string
): ConversationRowModel[] {
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
  const sessionByPath = new Map(sessions.map((session) => [session.path, session]));
  const rows = tasks.map((task): SearchableConversationRow => {
    const session = task.sessionPath ? sessionByPath.get(task.sessionPath) : undefined;
    if (task.sessionPath) sessionByPath.delete(task.sessionPath);
    const status = taskStatus(task);
    const stableTitle = ["未命名会话", "未命名任务"].includes(task.title) && session
      ? session.name
      : task.title;
    const title = task.recentUserMessagePreview ?? stableTitle;
    const meta = session
      ? task.recentUserMessagePreview
        ? `${stableTitle} · ${sessionMeta(session)}`
        : sessionMeta(session)
      : task.conversation.kind === "provisional" ? "尚未保存 · 当前草稿" : stableTitle;
    return {
      identity: rendererConversationIdentity(task.conversation),
      conversation: task.conversation,
      task,
      title,
      meta,
      ...(status ? { status } : {}),
      priority: status !== undefined,
      modifiedAt: session?.modifiedAt ?? 0,
      searchText: session
        ? sessionSearchText(session, `${title} ${stableTitle}`, meta)
        : `${title} ${stableTitle} ${meta}`
    };
  });
  rows.push(...[...sessionByPath.values()].map((session): SearchableConversationRow => {
    const conversation = { kind: "session" as const, workspaceId, sessionPath: session.path };
    const meta = sessionMeta(session);
    return {
      identity: rendererConversationIdentity(conversation),
      conversation,
      title: session.name,
      meta,
      priority: false,
      modifiedAt: session.modifiedAt,
      searchText: sessionSearchText(session, session.name, meta)
    };
  }));
  return rows
    .filter((row) => !normalizedQuery || row.searchText.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => Number(right.priority) - Number(left.priority)
      || taskStatusRank(left.status) - taskStatusRank(right.status)
      || right.modifiedAt - left.modifiedAt)
    .map(({ searchText: _searchText, ...row }) => row);
}

interface SearchableConversationRow extends ConversationRowModel {
  searchText: string;
}

export function boundedRecent(
  rows: ConversationRowModel[],
  selectedIdentity: string | undefined,
  limit: number
): ConversationRowModel[] {
  const visible = rows.slice(0, limit);
  const selected = rows.find((row) => row.identity === selectedIdentity);
  return selected && !visible.includes(selected) ? [...visible, selected] : visible;
}

export function statusLabel(status: NonNullable<ConversationRowModel["status"]>): string {
  return status === "running" ? "运行中" : status === "waiting" ? "等待" : "草稿";
}

export function workspaceStatus(workspace: {
  availability: "available" | "missing" | "identity-changed" | "unavailable";
  trust: "unknown" | "trusted" | "untrusted";
}): string {
  if (workspace.availability === "missing") return "目录已移动或删除";
  if (workspace.availability === "identity-changed") return "目录身份已变化";
  if (workspace.availability === "unavailable") return "暂不可用";
  return workspace.trust === "trusted" ? "本地工作区" : "等待信任";
}

function taskStatus(task: RendererWorkbenchTask): ConversationRowModel["status"] {
  if (task.lifecycle === "waiting-approval" || task.lifecycle === "waiting-extension-input") return "waiting";
  if (taskConsumesRunSlot(task.lifecycle) || task.lifecycle === "initializing") return "running";
  if (task.conversation.kind === "provisional" || task.hasDraft) return "draft";
  return undefined;
}

function taskStatusRank(status: ConversationRowModel["status"]): number {
  return status === "waiting" ? 0 : status === "running" ? 1 : status === "draft" ? 2 : 3;
}

function sessionMeta(session: SessionSummary): string {
  return `${session.messageCount} 条消息 · ${formatSessionRelativeTime(session.modifiedAt)}`;
}

function sessionSearchText(session: SessionSummary, title: string, meta: string): string {
  return `${title} ${meta} ${session.name} ${session.cwd} ${session.path} ${session.id}`;
}
