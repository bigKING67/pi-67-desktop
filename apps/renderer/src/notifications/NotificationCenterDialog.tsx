import {
  Bell,
  CircleAlert,
  CircleCheck,
  Info,
  Trash2,
  TriangleAlert
} from "lucide-react";
import type { RefObject } from "react";
import {
  Button,
  Dialog,
  Heading,
  Popover
} from "react-aria-components";
import { formatNotificationDateTime } from "../localization/date-time.js";
import {
  type NotificationItem,
  type NotificationLevel,
  useNotificationStore
} from "./notification-store.js";
import styles from "./NotificationCenter.module.css";

export function NotificationCenterDialog({
  onOpenChange,
  triggerRef
}: {
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const items = useNotificationStore((state) => state.items);
  const clear = useNotificationStore((state) => state.clear);

  return (
    <Popover
      className={styles.popover!}
      isOpen
      offset={6}
      onOpenChange={onOpenChange}
      placement="bottom end"
      triggerRef={triggerRef}
    >
      <Dialog aria-label="通知中心" className={styles.dialog!}>
        <header className={styles.header}>
          <span>
            <Heading className={styles.heading!} slot="title">通知</Heading>
            <small>仅保留本次运行内的最近记录</small>
          </span>
          <Button
            aria-label="清空通知历史"
            className={styles.clear!}
            isDisabled={items.length === 0}
            onPress={clear}
          >
            <Trash2 aria-hidden="true" size={14} />
            清空
          </Button>
        </header>
        {items.length === 0 ? (
          <div className={styles.empty}>
            <Bell aria-hidden="true" size={20} />
            <strong>暂无通知</strong>
            <span>任务终态和系统反馈会显示在这里。</span>
          </div>
        ) : (
          <ul className={styles.list}>
            {[...items].reverse().map((item) => (
              <NotificationHistoryItem item={item} key={item.id} />
            ))}
          </ul>
        )}
      </Dialog>
    </Popover>
  );
}

function NotificationHistoryItem({ item }: { item: NotificationItem }) {
  return (
    <li className={styles.item} data-level={item.level}>
      <NotificationIcon level={item.level} />
      <span className={styles.copy}>
        <span className={styles.itemHeader}>
          <strong>{item.title}</strong>
          <time dateTime={new Date(item.createdAt).toISOString()}>{formatNotificationDateTime(item.createdAt)}</time>
        </span>
        {item.message ? <span>{item.message}</span> : null}
        {item.operation ? (
          <small>{operationKindLabel(item.operation.operationKind)} · Host {item.operation.hostEpoch}</small>
        ) : null}
      </span>
    </li>
  );
}

function NotificationIcon({ level }: { level: NotificationLevel }) {
  if (level === "success") return <CircleCheck aria-hidden="true" size={16} />;
  if (level === "warning") return <CircleAlert aria-hidden="true" size={16} />;
  if (level === "error") return <TriangleAlert aria-hidden="true" size={16} />;
  return <Info aria-hidden="true" size={16} />;
}

function operationKindLabel(kind: NonNullable<NotificationItem["operation"]>["operationKind"]): string {
  if (kind === "prompt") return "Pi 任务";
  if (kind === "command") return "Pi 命令";
  if (kind === "compaction") return "上下文压缩";
  return "会话导入";
}
