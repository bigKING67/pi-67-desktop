import {
  taskConsumesRunSlot,
  type ConversationKey,
  type SessionSummary
} from "@pi67/domain";
import {
  rendererConversationIdentity,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import {
  conversationPrimaryTitle,
  conversationStableTitle
} from "../workbench/conversation-title.js";
import { formatSessionRelativeTime } from "./session-navigation.js";

export interface ConversationRowModel {
  identity: string;
  conversation: ConversationKey;
  task?: RendererWorkbenchTask;
  session?: SessionSummary;
  title: string;
  meta: string;
  status?: "running" | "waiting" | "draft";
  priority: boolean;
  pinned: boolean;
  snoozed: boolean;
  snoozedUntil?: number;
  canMovePinnedUp: boolean;
  canMovePinnedDown: boolean;
  titleSource: SessionSummary["nameSource"];
  modifiedAt: number;
}

export function conversationRows(
  workspaceId: string,
  tasks: RendererWorkbenchTask[],
  sessions: SessionSummary[],
  query: string,
  now = Date.now()
): ConversationRowModel[] {
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
  const sessionByIdentity = new Map(sessions.map((session) => [session.fileIdentity, session]));
  const rows = tasks.map((task): SearchableConversationRow => {
    const session = task.sessionFileIdentity
      ? sessionByIdentity.get(task.sessionFileIdentity)
      : undefined;
    if (task.sessionFileIdentity) sessionByIdentity.delete(task.sessionFileIdentity);
    const status = taskStatus(task);
    const snoozed = status === undefined
      && session?.snoozedUntil !== undefined
      && session.snoozedUntil > now;
    const stableTitle = conversationStableTitle(task, session);
    const title = conversationPrimaryTitle(task, session);
    const meta = session
      ? task.recentUserMessagePreview
        ? `${task.recentUserMessagePreview} · ${sessionMeta(session, snoozed)}`
        : sessionMeta(session, snoozed)
      : task.conversation.kind === "provisional" ? "尚未保存 · 当前草稿" : stableTitle;
    return {
      identity: rendererConversationIdentity(task.conversation),
      conversation: task.conversation,
      task,
      ...(session ? { session } : {}),
      title,
      meta,
      ...(status ? { status } : {}),
      priority: status !== undefined,
      pinned: !snoozed && session?.pinnedAt !== undefined,
      snoozed,
      ...(snoozed ? { snoozedUntil: session.snoozedUntil } : {}),
      titleSource: task.titleSource === "explicit" ? "explicit" : session?.nameSource ?? "fallback",
      modifiedAt: session?.modifiedAt ?? 0,
      searchText: session
        ? sessionSearchText(session, `${title} ${stableTitle}`, meta)
        : `${title} ${stableTitle} ${meta}`
    };
  });
  rows.push(...[...sessionByIdentity.values()].map((session): SearchableConversationRow => {
    const conversation = {
      kind: "session" as const,
      workspaceId,
      sessionFileIdentity: session.fileIdentity,
      sessionPath: session.path
    };
    const snoozed = session.snoozedUntil !== undefined && session.snoozedUntil > now;
    const meta = sessionMeta(session, snoozed);
    return {
      identity: rendererConversationIdentity(conversation),
      conversation,
      session,
      title: session.name,
      meta,
      priority: false,
      pinned: !snoozed && session.pinnedAt !== undefined,
      snoozed,
      ...(snoozed ? { snoozedUntil: session.snoozedUntil } : {}),
      titleSource: session.nameSource,
      modifiedAt: session.modifiedAt,
      searchText: sessionSearchText(session, session.name, meta)
    };
  }));
  const ordered = rows
    .filter((row) => !normalizedQuery || row.searchText.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => Number(right.priority) - Number(left.priority)
      || taskStatusRank(left.status) - taskStatusRank(right.status)
      || Number(right.pinned) - Number(left.pinned)
      || (right.session?.pinnedAt ?? 0) - (left.session?.pinnedAt ?? 0)
      || right.modifiedAt - left.modifiedAt)
  const pinnedIdentities = ordered.filter((row) => row.pinned).map((row) => row.identity);
  return ordered.map(({ searchText: _searchText, ...row }) => {
    const pinnedIndex = pinnedIdentities.indexOf(row.identity);
    return {
      ...row,
      canMovePinnedUp: pinnedIndex > 0,
      canMovePinnedDown: pinnedIndex >= 0 && pinnedIndex < pinnedIdentities.length - 1
    };
  });
}

interface SearchableConversationRow extends Omit<
  ConversationRowModel,
  "canMovePinnedUp" | "canMovePinnedDown"
> {
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
  availability: "available" | "missing" | "identity-changed" | "needs-confirmation" | "unavailable";
  trust: "unknown" | "trusted" | "untrusted";
}): string {
  if (workspace.availability === "missing") return "目录已移动或删除";
  if (workspace.availability === "identity-changed") return "目录身份已变化";
  if (workspace.availability === "needs-confirmation") return "需要重新确认";
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

function sessionMeta(session: SessionSummary, snoozed: boolean): string {
  return snoozed
    ? `${session.messageCount} 条消息 · ${formatSnoozeTimestamp(session.snoozedUntil!)}唤醒`
    : `${session.messageCount} 条消息 · ${formatSessionRelativeTime(session.modifiedAt)}`;
}

export function formatSnoozeTimestamp(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function sessionSearchText(session: SessionSummary, title: string, meta: string): string {
  return `${title} ${meta} ${session.name} ${session.cwd} ${session.path} ${session.id}`;
}
