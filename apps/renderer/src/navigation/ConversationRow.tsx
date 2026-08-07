import { conversationArchiveBlocker, taskCanBeStopped } from "@pi67/domain";
import {
  Archive,
  Circle,
  Clock3,
  Ellipsis,
  LoaderCircle,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Square
} from "lucide-react";
import type { MutableRefObject } from "react";
import { Button, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
import { activateRendererTask } from "../workbench/task-activation-controller.js";
import { stopRendererTask } from "../workbench/task-stop-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import styles from "./NavigationRail.module.css";
import {
  archiveRendererConversation,
  renameRendererConversation,
  setRendererConversationPinned
} from "./conversation-organization-controller.js";
import { useConversationDialogStore } from "./conversation-dialog-store.js";
import { statusLabel, type ConversationRowModel } from "./workspace-conversation-model.js";

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
  const StatusIcon = row.status === "running" ? LoaderCircle : row.status === "waiting" ? Clock3 : Circle;
  const task = row.task;
  const sessionConversation = row.conversation.kind === "session" ? row.conversation : undefined;
  return (
    <div className={styles.conversationRow}>
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
        <span className={styles.conversationMarker} data-status={row.status ?? "idle"}>
          <StatusIcon aria-hidden="true" className={row.status === "running" ? styles.spinning : undefined} size={11} />
        </span>
        <span className={styles.conversationCopy}>
          <strong>{row.title}</strong>
          <small>{row.meta}</small>
        </span>
        {row.pinned ? <Pin aria-label="已置顶" className={styles.pinnedIcon} size={11} /> : null}
        {row.status ? <span className={styles.conversationState}>{statusLabel(row.status)}</span> : null}
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
              <MenuItem
                className={styles.menuItem!}
                isDisabled={Boolean(conversationArchiveBlocker({
                  kind: "session",
                  ...(task ? { lifecycle: task.lifecycle, hasDraft: task.hasDraft || task.attachmentCount > 0 } : {})
                }))}
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

async function openConversation(row: ConversationRowModel): Promise<void> {
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
