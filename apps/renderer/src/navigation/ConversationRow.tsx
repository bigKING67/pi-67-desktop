import { conversationArchiveBlocker, taskCanBeStopped } from "@pi67/domain";
import {
  Archive,
  Calendar1,
  CalendarDays,
  Clock3,
  ArrowDown,
  ArrowUp,
  Ellipsis,
  LoaderCircle,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Sparkles,
  Square
} from "lucide-react";
import type { MutableRefObject } from "react";
import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
import { activateRendererTask } from "../workbench/task-activation-controller.js";
import { stopRendererTask } from "../workbench/task-stop-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import {
  conversationNeedsAttention,
  useConversationAttentionStore
} from "./conversation-attention-store.js";
import styles from "./NavigationRail.module.css";
import {
  archiveRendererConversation,
  moveRendererPinnedConversation,
  placeRendererPinnedConversationBefore,
  regenerateRendererConversationTitle,
  renameRendererConversation,
  setRendererConversationPinned,
  snoozeRendererConversation,
  wakeRendererConversation
} from "./conversation-organization-controller.js";
import { useConversationDialogStore } from "./conversation-dialog-store.js";
import { statusLabel, type ConversationRowModel } from "./workspace-conversation-model.js";

const PINNED_CONVERSATION_DRAG_TYPE = "application/x-pi67-pinned-conversation";

export function ConversationRow({
  row,
  selected,
  selectedRow,
  disabled
}: {
  row: ConversationRowModel;
  selected: boolean;
  selectedRow: MutableRefObject<HTMLElement | null>;
  disabled: boolean;
}) {
  const task = row.task;
  const sessionConversation = row.conversation.kind === "session" ? row.conversation : undefined;
  const needsAttention = useConversationAttentionStore((state) => (
    sessionConversation
      ? conversationNeedsAttention(
          state,
          sessionConversation.workspaceId,
          sessionConversation.sessionFileIdentity
        )
      : false
  ));
  const organizationBlocked = Boolean(conversationArchiveBlocker({
    kind: "session",
    ...(task ? { lifecycle: task.lifecycle, hasDraft: task.hasDraft || task.attachmentCount > 0 } : {})
  }));
  return (
    <div
      className={styles.conversationRow}
      draggable={row.pinned && Boolean(sessionConversation)}
      onDragStart={(event) => {
        if (!row.pinned || !sessionConversation) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(PINNED_CONVERSATION_DRAG_TYPE, JSON.stringify({
          workspaceId: sessionConversation.workspaceId,
          fileIdentity: sessionConversation.sessionFileIdentity
        }));
      }}
      onDragOver={(event) => {
        if (!row.pinned || !sessionConversation || !event.dataTransfer.types.includes(PINNED_CONVERSATION_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        if (!row.pinned || !sessionConversation) return;
        const source = parsePinnedDrag(event.dataTransfer.getData(PINNED_CONVERSATION_DRAG_TYPE));
        if (!source || source.workspaceId !== sessionConversation.workspaceId) return;
        event.preventDefault();
        void placeRendererPinnedConversationBefore(
          sessionConversation.workspaceId,
          source.fileIdentity,
          sessionConversation.sessionFileIdentity
        );
      }}
    >
      <button
        {...(selected ? { "aria-current": "page" as const } : {})}
        className={`${styles.conversationItem} ${selected ? styles.activeConversation : ""}`}
        data-conversation-id={row.identity}
        data-testid="conversation-row"
        disabled={disabled}
        onClick={() => void openConversation(row)}
        ref={(element) => {
          if (selected) selectedRow.current = element;
        }}
        type="button"
      >
        <span className={styles.conversationCopy} data-testid="conversation-copy">
          <strong>{row.title}</strong>
          <small>{row.meta}</small>
        </span>
        <span className={styles.conversationIndicators}>
          {row.status === "running" ? (
            <LoaderCircle aria-hidden="true" className={styles.spinning} size={11} />
          ) : null}
          {row.pinned ? <Pin aria-label="已置顶" className={styles.pinnedIcon} size={11} /> : null}
          {row.snoozed ? <span className={styles.conversationState}>稍后</span> : null}
          {needsAttention ? <span className={styles.conversationAttention}>待查看</span> : null}
          {row.status ? <span className={styles.conversationState}>{statusLabel(row.status)}</span> : null}
        </span>
      </button>
      {sessionConversation ? (
        <MenuTrigger>
          <Button
            className={styles.conversationMenuButton!}
            aria-label={`${row.title} 对话菜单`}
            isDisabled={disabled || task?.lifecycle === "initializing"}
          >
            <Ellipsis aria-hidden="true" size={13} />
          </Button>
          <Popover className={styles.menuPopover!} placement="bottom end" offset={4}>
            <Menu aria-label={`${row.title} 对话菜单`} className={styles.menu!}>
              <MenuItem className={styles.menuItem!} onAction={() => void setRendererConversationPinned(
                sessionConversation.workspaceId,
                {
                  fileIdentity: sessionConversation.sessionFileIdentity,
                  path: sessionConversation.sessionPath,
                  ...(row.session?.pinnedAt === undefined ? {} : { pinnedAt: row.session.pinnedAt })
                }
              )} textValue={row.pinned ? "取消置顶" : "置顶对话"}>
                {row.pinned ? <PinOff aria-hidden="true" size={13} /> : <Pin aria-hidden="true" size={13} />}
                {row.pinned ? "取消置顶" : "置顶对话"}
              </MenuItem>
              {row.pinned ? (
                <>
                  <MenuItem
                    className={styles.menuItem!}
                    isDisabled={!row.canMovePinnedUp}
                    onAction={() => void moveRendererPinnedConversation(
                      sessionConversation.workspaceId,
                      sessionConversation.sessionFileIdentity,
                      "up"
                    )}
                    textValue="上移置顶对话"
                  ><ArrowUp aria-hidden="true" size={13} />上移置顶对话</MenuItem>
                  <MenuItem
                    className={styles.menuItem!}
                    isDisabled={!row.canMovePinnedDown}
                    onAction={() => void moveRendererPinnedConversation(
                      sessionConversation.workspaceId,
                      sessionConversation.sessionFileIdentity,
                      "down"
                    )}
                    textValue="下移置顶对话"
                  ><ArrowDown aria-hidden="true" size={13} />下移置顶对话</MenuItem>
                </>
              ) : null}
              <MenuItem className={styles.menuItem!} onAction={() => useConversationDialogStore.getState().openRename({
                workspaceId: sessionConversation.workspaceId,
                fileIdentity: sessionConversation.sessionFileIdentity,
                path: sessionConversation.sessionPath,
                title: row.title,
                nameSource: row.titleSource
              })} textValue="重命名对话">
                <Pencil aria-hidden="true" size={13} />重命名对话
              </MenuItem>
              {row.titleSource === "explicit" ? (
                <MenuItem className={styles.menuItem!} onAction={() => void renameRendererConversation(
                  sessionConversation.workspaceId,
                  {
                    fileIdentity: sessionConversation.sessionFileIdentity,
                    path: sessionConversation.sessionPath
                  },
                  undefined
                )} textValue="恢复自动标题">
                  <RotateCcw aria-hidden="true" size={13} />恢复自动标题
                </MenuItem>
              ) : null}
              {task && task.sessionGeneration !== undefined && task.runtime.phase !== "stopped" ? (
                <MenuItem className={styles.menuItem!} onAction={() => void regenerateRendererConversationTitle(
                  sessionConversation.workspaceId,
                  {
                    fileIdentity: sessionConversation.sessionFileIdentity,
                    path: sessionConversation.sessionPath
                  }
                )} textValue="重新生成自动标题">
                  <Sparkles aria-hidden="true" size={13} />重新生成自动标题
                </MenuItem>
              ) : null}
              <Separator className={styles.menuSeparator!} />
              {row.snoozed ? (
                <MenuItem className={styles.menuItem!} onAction={() => void wakeRendererConversation(
                  sessionConversation.workspaceId,
                  {
                    fileIdentity: sessionConversation.sessionFileIdentity,
                    path: sessionConversation.sessionPath
                  }
                )} textValue="立即唤醒">
                  <Clock3 aria-hidden="true" size={13} />立即唤醒
                </MenuItem>
              ) : (
                <>
                  <MenuItem
                    className={styles.menuItem!}
                    isDisabled={organizationBlocked}
                    onAction={() => void snoozeRendererConversation(
                      sessionConversation.workspaceId,
                      { fileIdentity: sessionConversation.sessionFileIdentity, path: sessionConversation.sessionPath },
                      "later"
                    )}
                    textValue="稍后"
                  ><Clock3 aria-hidden="true" size={13} />稍后（1 小时）</MenuItem>
                  <MenuItem
                    className={styles.menuItem!}
                    isDisabled={organizationBlocked}
                    onAction={() => void snoozeRendererConversation(
                      sessionConversation.workspaceId,
                      { fileIdentity: sessionConversation.sessionFileIdentity, path: sessionConversation.sessionPath },
                      "tomorrow"
                    )}
                    textValue="明天"
                  ><Calendar1 aria-hidden="true" size={13} />明天 09:00</MenuItem>
                  <MenuItem
                    className={styles.menuItem!}
                    isDisabled={organizationBlocked}
                    onAction={() => void snoozeRendererConversation(
                      sessionConversation.workspaceId,
                      { fileIdentity: sessionConversation.sessionFileIdentity, path: sessionConversation.sessionPath },
                      "next-week"
                    )}
                    textValue="下周"
                  ><CalendarDays aria-hidden="true" size={13} />下周一 09:00</MenuItem>
                </>
              )}
              <MenuItem
                className={styles.menuItem!}
                isDisabled={organizationBlocked}
                onAction={() => void archiveRendererConversation(sessionConversation.workspaceId, {
                  fileIdentity: sessionConversation.sessionFileIdentity,
                  path: sessionConversation.sessionPath
                })}
                textValue="归档对话"
              ><Archive aria-hidden="true" size={13} />归档对话</MenuItem>
              {task && taskCanBeStopped(task.lifecycle) ? (
                <>
                  <Separator className={styles.menuSeparator!} />
                  <MenuItem
                    className={`${styles.menuItem} ${styles.dangerMenuItem}`}
                    onAction={() => void stopRendererTask(task.id)}
                    textValue="停止任务"
                  ><Square aria-hidden="true" size={12} />停止任务</MenuItem>
                </>
              ) : null}
            </Menu>
          </Popover>
        </MenuTrigger>
      ) : null}
    </div>
  );
}

function parsePinnedDrag(value: string): { workspaceId: string; fileIdentity: string } | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed !== "object"
      || parsed === null
      || typeof (parsed as { workspaceId?: unknown }).workspaceId !== "string"
      || typeof (parsed as { fileIdentity?: unknown }).fileIdentity !== "string"
    ) return undefined;
    return parsed as { workspaceId: string; fileIdentity: string };
  } catch {
    return undefined;
  }
}

async function openConversation(row: ConversationRowModel): Promise<void> {
  if (row.snoozed && row.conversation.kind === "session") {
    await wakeRendererConversation(row.conversation.workspaceId, {
      fileIdentity: row.conversation.sessionFileIdentity,
      path: row.conversation.sessionPath
    }, false);
  }
  if (row.task) {
    await activateRendererTask(row.task.id);
    return;
  }
  const workbench = rendererWorkbenchStore.getState();
  const workspace = workbench.workspaces[row.conversation.workspaceId];
  if (!workspace || row.conversation.kind !== "session") return;
  workbench.selectConversation(row.conversation);
  await openRendererWorkspaceDescriptor(
    workspace,
    row.conversation.sessionPath,
    row.conversation.sessionFileIdentity
  );
}
