import type { OperationKind } from "@pi67/domain";
import type { OperationSettled } from "@pi67/protocol";
import { create } from "zustand";

export const MAX_NOTIFICATION_HISTORY = 50;
export const MAX_VISIBLE_TOASTS = 4;
export const MAX_OPERATION_DEDUPE_KEYS = 512;
export const GENERIC_NOTIFICATION_DEDUPE_WINDOW_MS = 5_000;

export type NotificationLevel = "info" | "success" | "warning" | "error";
type NotificationCategory = "system" | "operation";

interface OperationNotificationMetadata {
  hostEpoch: number;
  operationId: string;
  operationKind: OperationKind;
  lifecycle: OperationSettled["lifecycle"];
  sessionId: string;
  sessionGeneration: number;
  startedAt: number;
  settledAt: number;
  errorCode?: string;
}

export interface NotificationItem {
  id: string;
  dedupeKey: string;
  category: NotificationCategory;
  level: NotificationLevel;
  title: string;
  message?: string;
  createdAt: number;
  read: boolean;
  operation?: OperationNotificationMetadata;
  action?: NotificationAction;
}

interface NotificationAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface PublishNotificationInput {
  level: NotificationLevel;
  title: string;
  message?: string;
  toast?: boolean;
  action?: NotificationAction;
}

interface NotificationState {
  items: NotificationItem[];
  toastIds: string[];
  terminalDedupeKeys: string[];
  publish: (input: PublishNotificationInput) => void;
  recordOperationTerminal: (receipt: OperationSettled) => void;
  dismissToast: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

let notificationSequence = 0;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  toastIds: [],
  terminalDedupeKeys: [],

  publish(input) {
    const createdAt = Date.now();
    const prepared = systemNotification(input, createdAt);
    const duplicate = get().items.some((item) => (
      item.dedupeKey === prepared.dedupeKey
      && createdAt - item.createdAt < GENERIC_NOTIFICATION_DEDUPE_WINDOW_MS
    ));
    if (duplicate) return;
    set((state) => appendNotification(state, prepared, input.toast !== false));
  },

  recordOperationTerminal(receipt) {
    const prepared = operationNotification(receipt);
    if (get().terminalDedupeKeys.includes(prepared.dedupeKey)) return;
    set((state) => ({
      ...appendNotification(state, prepared),
      terminalDedupeKeys: [...state.terminalDedupeKeys, prepared.dedupeKey]
        .slice(-MAX_OPERATION_DEDUPE_KEYS)
    }));
  },

  dismissToast(id) {
    set((state) => ({ toastIds: state.toastIds.filter((toastId) => toastId !== id) }));
  },

  markAllRead() {
    set((state) => state.items.some((item) => !item.read)
      ? { items: state.items.map((item) => item.read ? item : { ...item, read: true }) }
      : {});
  },

  clear() {
    set({ items: [], toastIds: [], terminalDedupeKeys: [] });
  }
}));

export function publishNotification(input: PublishNotificationInput): void {
  useNotificationStore.getState().publish(input);
}

export function recordOperationTerminal(receipt: OperationSettled): void {
  useNotificationStore.getState().recordOperationTerminal(receipt);
}

function appendNotification(
  state: Pick<NotificationState, "items" | "toastIds">,
  item: NotificationItem,
  showToast = true
): Pick<NotificationState, "items" | "toastIds"> {
  const items = [...state.items, item].slice(-MAX_NOTIFICATION_HISTORY);
  const retainedIds = new Set(items.map((candidate) => candidate.id));
  const retainedToastIds = state.toastIds.filter((id) => retainedIds.has(id));
  const toastIds = showToast
    ? [...retainedToastIds, item.id].slice(-MAX_VISIBLE_TOASTS)
    : retainedToastIds;
  return { items, toastIds };
}

function systemNotification(input: PublishNotificationInput, createdAt: number): NotificationItem {
  const title = sanitizeNotificationText(input.title, 160) || "系统通知";
  const message = input.message === undefined
    ? undefined
    : sanitizeNotificationText(input.message, 320) || undefined;
  const normalized = `${input.level}:${title}:${message ?? ""}`.toLocaleLowerCase();
  return {
    id: createNotificationId(createdAt),
    dedupeKey: `system:${normalized}`,
    category: "system",
    level: input.level,
    title,
    ...(message === undefined ? {} : { message }),
    ...(input.action === undefined ? {} : { action: input.action }),
    createdAt,
    read: false
  };
}

function operationNotification(receipt: OperationSettled): NotificationItem {
  const presentation = operationTerminalPresentation(receipt);
  const errorCode = receipt.lifecycle === "failed"
    ? sanitizeIdentifier(receipt.error.code)
    : undefined;
  return {
    id: createNotificationId(receipt.settledAt),
    dedupeKey: `operation:${receipt.hostEpoch}:${receipt.operationId}`,
    category: "operation",
    level: presentation.level,
    title: presentation.title,
    message: presentation.message,
    createdAt: receipt.settledAt,
    read: false,
    operation: {
      hostEpoch: receipt.hostEpoch,
      operationId: receipt.operationId,
      operationKind: receipt.operationKind,
      lifecycle: receipt.lifecycle,
      sessionId: receipt.sessionId,
      sessionGeneration: receipt.sessionGeneration,
      startedAt: receipt.startedAt,
      settledAt: receipt.settledAt,
      ...(errorCode === undefined ? {} : { errorCode })
    }
  };
}

function operationTerminalPresentation(receipt: OperationSettled): {
  level: NotificationLevel;
  title: string;
  message: string;
} {
  const kind = operationKindLabel(receipt.operationKind);
  const duration = formatDuration(receipt.settledAt - receipt.startedAt);
  switch (receipt.lifecycle) {
    case "completed":
      return { level: "success", title: "任务已完成", message: `${kind} · 用时 ${duration}` };
    case "failed":
      return {
        level: "error",
        title: "任务失败",
        message: `${kind} · 错误代码 ${sanitizeIdentifier(receipt.error.code)}`
      };
    case "cancelled":
      return { level: "info", title: "任务已停止", message: `${kind} · 用时 ${duration}` };
    case "lost":
      return {
        level: "warning",
        title: "任务已中断",
        message: `${kind} · Pi 运行服务未能确认任务终态`
      };
  }
}

function operationKindLabel(kind: OperationKind): string {
  switch (kind) {
    case "prompt":
      return "Pi 任务";
    case "command":
      return "Pi 命令";
    case "compaction":
      return "上下文压缩";
    case "session-import":
      return "会话导入";
  }
}

function formatDuration(durationMs: number): string {
  const safeDuration = Math.max(0, durationMs);
  if (safeDuration < 1_000) return "不足 1 秒";
  if (safeDuration < 60_000) return `${(safeDuration / 1_000).toFixed(safeDuration < 10_000 ? 1 : 0)} 秒`;
  const minutes = Math.floor(safeDuration / 60_000);
  const seconds = Math.floor((safeDuration % 60_000) / 1_000);
  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`;
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return sanitized || "UNKNOWN";
}

function sanitizeNotificationText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const redacted = compact
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[凭据已隐藏]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[凭据已隐藏]")
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/g, "[凭据已隐藏]")
    .replace(/https?:\/\/\S+/gi, "[链接已隐藏]")
    .replace(/file:\/\/\/?\S+/gi, "[路径已隐藏]")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)\S+(?:\s+[^。；，,;]*)?/g, "[路径已隐藏]")
    .replace(/(^|[\s(])\/(?:Users|home|private|tmp|var|etc|opt|Volumes|mnt|workspace|sessions)(?:\/[^\s),;:]+)+/g, "$1[路径已隐藏]")
    .replace(/`[^`]{1,240}`/g, "[详情已隐藏]");
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}…`;
}

function createNotificationId(createdAt: number): string {
  notificationSequence = (notificationSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `notification-${createdAt}-${notificationSequence}`;
}
