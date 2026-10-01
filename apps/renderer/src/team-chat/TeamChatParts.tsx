import { messages } from "../localization/message-catalog.js";
import styles from "./TeamChat.module.css";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function TeamChatAvatar({ name }: { name: string }) {
  const first = graphemes.segment(name.trim()).containing(0)?.segment ?? "?";
  return <span aria-hidden="true" className={styles.avatar}>{first.toUpperCase()}</span>;
}

export function UnreadCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className={styles.unread} title={messages.teamChat.unread(count)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
