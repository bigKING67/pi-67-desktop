import type { PromptStashItem } from "@pi67/domain";
import { Archive, ArchiveRestore, LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { publishNotification } from "../notifications/notification-store.js";
import {
  deleteComposerPromptStash,
  restoreComposerPromptStash,
  stashComposerPrompt,
  type PromptStashResult
} from "./prompt-stash-controller.js";
import type { DraftAttachment } from "./composer-attachments.js";
import styles from "./PromptStashControl.module.css";

type BusyAction =
  | { type: "store" }
  | { type: "restore" | "delete"; itemId: string };

export function PromptStashControl({
  disabled,
  attachments,
  items,
  taskId,
  text,
  workspaceFileCount,
  workspaceId,
  onRestored
}: {
  disabled: boolean;
  attachments: readonly DraftAttachment[];
  items: readonly PromptStashItem[];
  taskId: string;
  text: string;
  workspaceFileCount: number;
  workspaceId: string | undefined;
  onRestored: (text: string) => void;
}) {
  const [busyAction, setBusyAction] = useState<BusyAction>();
  const [open, setOpen] = useState(false);
  const busy = busyAction !== undefined;
  const canRestore = text.trim().length === 0 && attachments.length === 0 && workspaceFileCount === 0;
  const canStash = Boolean(workspaceId) && (text.trim().length > 0 || attachments.length > 0);

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button
        aria-label={`Prompt 暂存，${items.length} 条`}
        className={styles.promptStashButton!}
        isDisabled={disabled || busy}
      >
        <Archive aria-hidden="true" size={14} />
        {items.length > 0 ? <span>{items.length}</span> : null}
      </Button>
      <Popover className={styles.promptStashPopover!} placement="top start" offset={7}>
        <Dialog aria-label="Prompt 暂存" className={styles.promptStashDialog!}>
          <header>
            <span><strong>Prompt 暂存</strong><small>安全保存文字与图片，最多 20 条</small></span>
            <Button
              className={styles.promptStashSave!}
              isDisabled={busy || !canStash}
              onPress={() => void stash()}
            >
              {busyAction?.type === "store"
                ? <LoaderCircle aria-hidden="true" className={styles.busySpin} size={13} />
                : <Archive aria-hidden="true" size={13} />}
              暂存当前输入
            </Button>
          </header>
          <div className={styles.promptStashList}>
            {items.length === 0 ? <p>还没有暂存的 Prompt。</p> : items.toReversed().map((item) => (
              <div className={styles.promptStashRow} key={item.id}>
                <Button
                  className={styles.promptStashItem!}
                  isDisabled={busy || !canRestore}
                  onPress={() => void restore(item)}
                >
                  {busyAction?.type === "restore" && busyAction.itemId === item.id
                    ? <LoaderCircle aria-hidden="true" className={styles.busySpin} size={14} />
                    : <ArchiveRestore aria-hidden="true" size={14} />}
                  <span>
                    <strong>{preview(item.text)}</strong>
                    <small>{stashMetadata(item)}</small>
                  </span>
                </Button>
                <Button
                  aria-label={`删除暂存：${preview(item.text)}`}
                  className={styles.promptStashDelete!}
                  isDisabled={busy}
                  onPress={() => void remove(item)}
                >
                  {busyAction?.type === "delete" && busyAction.itemId === item.id
                    ? <LoaderCircle aria-hidden="true" className={styles.busySpin} size={13} />
                    : <Trash2 aria-hidden="true" size={13} />}
                </Button>
              </div>
            ))}
          </div>
          {!canRestore && items.length > 0
            ? <footer>先发送或暂存当前文字、图片与 @file 上下文，再恢复另一条 Prompt。</footer>
            : attachments.some((attachment) => attachment.kind !== "image")
              ? <footer>Prompt 暂存目前支持文字和图片；其他附件不会被静默丢弃。</footer>
              : null}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );

  async function stash(): Promise<void> {
    if (busy || !workspaceId) return;
    setBusyAction({ type: "store" });
    try {
      publishStashFailure(await stashComposerPrompt(taskId, workspaceId));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function restore(item: PromptStashItem): Promise<void> {
    if (busy || !canRestore) return;
    setBusyAction({ type: "restore", itemId: item.id });
    try {
      const result = await restoreComposerPromptStash(taskId, item.id);
      if (result.status === "restored" || (result.status === "cleanup-failed" && result.completed === "restored")) {
        setOpen(false);
        onRestored(result.text ?? item.text);
        if (result.status === "cleanup-failed") publishStashFailure(result);
      }
      else publishStashFailure(result);
    } finally {
      setBusyAction(undefined);
    }
  }

  async function remove(item: PromptStashItem): Promise<void> {
    if (busy) return;
    setBusyAction({ type: "delete", itemId: item.id });
    try {
      publishStashFailure(await deleteComposerPromptStash(taskId, item.id));
    } finally {
      setBusyAction(undefined);
    }
  }
}

function publishStashFailure(result: PromptStashResult): void {
  if (result.status === "stashed" || result.status === "restored") return;
  const message = result.status === "full"
    ? "已达到 20 条上限，请先恢复一条再继续暂存。"
    : result.status === "too-large"
      ? "当前 Prompt、图片或暂存总量超过安全存储上限，请缩短后重试。"
    : result.status === "file-references"
      ? "包含 @file 引用的输入不能暂存；引用仍完整保留在当前输入中。"
      : result.status === "unsupported-attachments"
        ? "Prompt 暂存目前只支持图片附件；其他附件仍完整保留在当前输入中。"
      : result.status === "conflict"
        ? "当前文字、图片或 @file 上下文不为空，未覆盖或合并任何内容。"
        : result.status === "cleanup-failed"
          ? result.completed === "restored"
            ? "Prompt 已恢复，但旧的加密图片副本暂未清理；应用下次启动会重新协调。"
            : "暂存记录已删除，但旧的加密图片副本暂未清理；应用下次启动会重新协调。"
        : result.status === "persistence-failed"
          ? "安全存储未确认最终状态，内容仍保留在当前输入或暂存中。"
          : "没有可暂存或恢复的 Prompt。";
  publishNotification({ level: "warning", title: "Prompt 暂存未完成", message });
}

function preview(text: string): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (!compact) return "仅图片 Prompt";
  return compact.length <= 90 ? compact : `${compact.slice(0, 89)}…`;
}

function stashMetadata(item: PromptStashItem): string {
  const attachments = item.attachments ?? [];
  if (attachments.length === 0) return formatStashTime(item.createdAt);
  const bytes = attachments.reduce((total, attachment) => total + attachment.byteLength, 0);
  return `${attachments.length} 张图片 · ${formatBytes(bytes)} · ${formatStashTime(item.createdAt)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatStashTime(createdAt: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(createdAt);
}
