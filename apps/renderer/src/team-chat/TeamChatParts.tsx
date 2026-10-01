import { messages } from "../localization/message-catalog.js";
import styles from "./TeamChat.module.css";
import governance from "./TeamChatGovernance.module.css";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function TeamChatAvatar({ name }: { name: string }) {
  const first = graphemes.segment(name.trim()).containing(0)?.segment ?? "?";
  return <span aria-hidden="true" className={styles.avatar}>{first.toUpperCase()}</span>;
}

function UnreadCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className={styles.unread} title={messages.teamChat.unread(count)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Mention and unread counts in one trailing cell of a rail row. */
export function RowCounts({ mentions, unread }: { mentions: number; unread: number }) {
  if (mentions <= 0 && unread <= 0) return null;
  return <span className={governance.rowCounts}><MentionCount count={mentions} /><UnreadCount count={unread} /></span>;
}

function MentionCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className={governance.mentionBadge} title={messages.teamChat.mentions(count)}>
      @{count > 99 ? "99+" : count}
    </span>
  );
}
