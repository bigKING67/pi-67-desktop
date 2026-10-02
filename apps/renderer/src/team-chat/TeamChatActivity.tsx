import { AtSign, Bell, Bot, Check, ClipboardCheck, MessageCircle, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { teamChatActivityIsUnread, type TeamChatActivityItem, type TeamChatDirectory } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { activityDetail, activityTitle, activityWhere } from "./team-chat-activity-presentation.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { formatTeamChatMoment } from "./team-chat-presentation.js";
import styles from "./TeamChatActivity.module.css";

const ICONS = {
  mention: AtSign,
  dm: MessageCircle,
  agent_reply: Bot,
  agent_failed: Bot,
  card_assigned: ClipboardCheck,
  card_review: ClipboardCheck,
  card_changes_requested: ClipboardCheck
} as const;

/** The activity inbox (ADR 0006): what asks for the reader, open or handled. */
export function TeamChatActivity({ directory }: { directory: TeamChatDirectory }) {
  const copy = messages.teamChat;
  const activity = useTeamChat((state) => state.activity);
  const status = useTeamChat((state) => state.activityStatus);
  const [view, setView] = useState<"open" | "done">("open");
  const list = useRef<HTMLUListElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(directory.conversations.map((item) => [item.id, item])), [directory.conversations]);
  const items = (activity ?? []).filter((item) => (view === "done") === (item.doneAt !== undefined));
  const unread = (activity ?? []).filter((item) => teamChatActivityIsUnread(item, byId.get(item.conversationId))).length;

  const act = (action: () => Promise<void>) => {
    void action().catch((error: unknown) => publishNotification({
      level: "warning", title: copy.activity, message: teamChatErrorMessage(error)
    }));
  };

  /** The toggled row leaves this list: focus its successor's toggle, else the tabs. */
  const keepFocus = (index: number) => {
    requestAnimationFrame(() => {
      const toggles = list.current?.querySelectorAll<HTMLElement>("[data-activity-toggle]") ?? [];
      const next = toggles[Math.min(index, toggles.length - 1)];
      (next ?? tabs.current?.querySelector<HTMLElement>("button"))?.focus();
    });
  };

  let body;
  if (!activity) {
    body = status === "error" ? (
      <div className={styles.status} role="alert">
        <span>{copy.activityFailed}</span>
        <Button className="secondary-button" onPress={() => void teamChat.retryActivity()}>{copy.retry}</Button>
      </div>
    ) : <p className={styles.status} role="status">{copy.activityLoading}</p>;
  } else if (items.length === 0) {
    body = <p className={styles.status}>{view === "open" ? copy.activityEmptyOpen : copy.activityEmptyDone}</p>;
  } else {
    body = (
      <ul className={styles.list} data-testid="team-chat-activity-list" ref={list}>
        {items.map((item, index) => (
          <ActivityRow directory={directory} item={item} key={item.key}
            onToggle={() => {
              act(() => teamChat.setActivityDone([item.key], item.doneAt === undefined));
              keepFocus(index);
            }}
            unread={teamChatActivityIsUnread(item, byId.get(item.conversationId))} />
        ))}
      </ul>
    );
  }

  return (
    <div className={styles.panel} data-testid="team-chat-activity">
      <div className={styles.column}>
        <header className={styles.header}>
          <span className={styles.heading}>
            <Bell aria-hidden="true" size={16} />
            <h2>{copy.activity}</h2>
          </span>
          <p>{copy.activityIntro}</p>
          <div className={styles.toolbar}>
            <div aria-label={copy.activity} className={styles.segmented} ref={tabs} role="group">
              {(["open", "done"] as const).map((option) => (
                <Button aria-pressed={view === option} className={view === option ? styles.segmentSelected! : ""}
                  key={option} onPress={() => setView(option)}>
                  {option === "open" ? copy.activityOpen : copy.activityDone}
                </Button>
              ))}
            </div>
            <Button className="secondary-button" isDisabled={unread === 0} onPress={() => act(() => teamChat.markAllActivityRead())}>
              {copy.activityMarkAllRead}
            </Button>
            <Button className={styles.textButton!} onPress={() => rendererWorkbenchStore.getState().openSettings("general")}>
              {copy.activityNotificationSettings}
            </Button>
          </div>
        </header>
        {body}
      </div>
    </div>
  );
}

function ActivityRow({ directory, item, unread, onToggle }: {
  directory: TeamChatDirectory;
  item: TeamChatActivityItem;
  unread: boolean;
  onToggle: () => void;
}) {
  const copy = messages.teamChat;
  const Icon = ICONS[item.kind];
  const title = activityTitle(item, directory);
  const detail = activityDetail(item);
  const where = activityWhere(directory, item.conversationId);
  const done = item.doneAt !== undefined;
  const time = formatTeamChatMoment(item.createdAt, Date.now());
  const label = [unread ? copy.activityUnreadLabel : undefined, title, detail, item.kind === "mention" ? undefined : where, time]
    .filter(Boolean).join("，");
  return (
    <li className={`${styles.row} ${unread ? styles.rowUnread : ""} ${item.kind === "agent_failed" ? styles.rowProblem : ""}`}>
      <Button aria-label={label} className={styles.rowMain!} data-testid="team-chat-activity-item"
        onPress={() => void teamChat.openMessage(item.conversationId, item.messageSeq)}>
        <span aria-hidden="true" className={styles.rowIcon}>
          <Icon size={14} />
          {unread ? <span className={styles.unreadDot} /> : null}
        </span>
        <span className={styles.rowText}>
          <strong>{title}</strong>
          {detail ? <span className={styles.rowDetail}>{detail}</span> : null}
        </span>
        <span className={styles.rowMeta}>
          <time dateTime={new Date(item.createdAt).toISOString()}>{time}</time>
          {item.kind === "mention" ? null : <span>{where}</span>}
        </span>
      </Button>
      <Button aria-label={`${done ? copy.activityMarkOpen : copy.activityMarkDone}：${title}`} className={styles.rowAction!}
        data-activity-toggle onPress={onToggle}>
        {done ? <Undo2 aria-hidden="true" size={14} /> : <Check aria-hidden="true" size={14} />}
      </Button>
    </li>
  );
}
