import type { SessionNavigationStatus } from "./session-navigation.js";
import {
  CircleDot,
  Clock3,
  LoaderCircle
} from "lucide-react";
import { Button } from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import styles from "./NavigationRail.module.css";
import {
  formatSessionRelativeTime,
  type SessionNavigationItem,
  type SessionNavigationRow
} from "./session-navigation.js";

const STATUS_PRESENTATION = {
  active: { label: messages.navigation.statusCurrent, Icon: CircleDot },
  running: { label: messages.navigation.statusRunning, Icon: LoaderCircle },
  waiting: { label: messages.navigation.statusWaiting, Icon: Clock3 }
} satisfies Record<SessionNavigationStatus, { label: string; Icon: typeof CircleDot }>;

export function SessionNavigationRowView({
  row,
  disabled,
  onOpen
}: {
  row: SessionNavigationRow;
  disabled: boolean;
  onOpen: (path: string) => void;
}) {
  if (row.kind === "group") {
    return (
      <h2 className={styles.groupHeading}>
        <span>{row.label}</span>
        <span>{row.count}</span>
      </h2>
    );
  }
  return <SessionButton item={row.item} disabled={disabled} onOpen={onOpen} />;
}

function SessionButton({
  item,
  disabled,
  onOpen
}: {
  item: SessionNavigationItem;
  disabled: boolean;
  onOpen: (path: string) => void;
}) {
  const status = item.status ? STATUS_PRESENTATION[item.status] : undefined;
  const StatusIcon = status?.Icon;
  const statusClass = item.status === "running"
    ? styles.running
    : item.status === "waiting"
      ? styles.waiting
      : styles.activeStatus;
  const className = `${styles.sessionItem} ${item.active ? styles.active : ""}`;

  return (
    <Button
      {...(item.active ? { "aria-current": "page" as const } : {})}
      aria-label={messages.navigation.rowLabel(
        item.session.name,
        status?.label ?? messages.navigation.statusInactive,
        item.session.messageCount
      )}
      className={className}
      isDisabled={disabled}
      onPress={() => onOpen(item.session.path)}
    >
      <span className={styles.itemHeading}>
        <span className={styles.sessionName}>{item.session.name}</span>
        {status && StatusIcon ? (
          <span className={`${styles.sessionStatus} ${statusClass}`}>
            <StatusIcon
              aria-hidden="true"
              className={item.status === "running" ? styles.spinning : undefined}
              size={12}
            />
            {status.label}
          </span>
        ) : null}
      </span>
      <span className={styles.itemMeta}>
        <span>{messages.navigation.shortMessageCount(item.session.messageCount)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatSessionRelativeTime(item.session.modifiedAt)}</span>
      </span>
    </Button>
  );
}
