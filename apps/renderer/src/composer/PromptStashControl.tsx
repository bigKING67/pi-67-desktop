import type { PromptStashItem } from "@pi67/domain";
import { Archive, ArchiveRestore, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { publishNotification } from "../notifications/notification-store.js";
import {
  restoreComposerPromptStash,
  stashComposerPrompt,
  type PromptStashResult
} from "./prompt-stash-controller.js";
import styles from "./Composer.module.css";

export function PromptStashControl({
  disabled,
  items,
  taskId,
  text,
  onRestored
}: {
  disabled: boolean;
  items: readonly PromptStashItem[];
  taskId: string;
  text: string;
  onRestored: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const canRestore = text.trim().length === 0;

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
            <span><strong>Prompt 暂存</strong><small>仅保存文字，最多 20 条</small></span>
            <Button
              className={styles.promptStashSave!}
              isDisabled={busy || !text.trim()}
              onPress={() => void stash()}
            >
              {busy
                ? <LoaderCircle aria-hidden="true" className={styles.contextPressureSpin} size={13} />
                : <Archive aria-hidden="true" size={13} />}
              暂存当前输入
            </Button>
          </header>
          <div className={styles.promptStashList}>
            {items.length === 0 ? <p>还没有暂存的 Prompt。</p> : items.toReversed().map((item) => (
              <Button
                className={styles.promptStashItem!}
                isDisabled={busy || !canRestore}
                key={item.id}
                onPress={() => void restore(item)}
              >
                <ArchiveRestore aria-hidden="true" size={14} />
                <span><strong>{preview(item.text)}</strong><small>{formatStashTime(item.createdAt)}</small></span>
              </Button>
            ))}
          </div>
          {!canRestore && items.length > 0 ? <footer>先发送或暂存当前输入，再恢复另一条 Prompt。</footer> : null}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );

  async function stash(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      publishStashFailure(await stashComposerPrompt(taskId));
    } finally {
      setBusy(false);
    }
  }

  async function restore(item: PromptStashItem): Promise<void> {
    if (busy || !canRestore) return;
    setBusy(true);
    try {
      const result = await restoreComposerPromptStash(taskId, item.id);
      if (result.status === "restored") {
        setOpen(false);
        onRestored(result.text);
      }
      else publishStashFailure(result);
    } finally {
      setBusy(false);
    }
  }
}

function publishStashFailure(result: PromptStashResult): void {
  if (result.status === "stashed" || result.status === "restored") return;
  const message = result.status === "full"
    ? "已达到 20 条上限，请先恢复一条再继续暂存。"
    : result.status === "too-large"
      ? "当前 Prompt 或暂存总量超过安全存储上限，请缩短后重试。"
    : result.status === "file-references"
      ? "包含 @file 引用的输入不能作为纯文字 Prompt 暂存。"
      : result.status === "conflict"
        ? "当前输入不为空，未覆盖或合并任何文字。"
        : result.status === "persistence-failed"
          ? "安全存储未确认最终状态，内容仍保留在当前输入或暂存中。"
          : "没有可暂存或恢复的 Prompt。";
  publishNotification({ level: "warning", title: "Prompt 暂存未完成", message });
}

function preview(text: string): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  return compact.length <= 90 ? compact : `${compact.slice(0, 89)}…`;
}

function formatStashTime(createdAt: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(createdAt);
}
