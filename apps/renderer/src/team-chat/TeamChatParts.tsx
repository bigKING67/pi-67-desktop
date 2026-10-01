import { Bot } from "lucide-react";
import type { TeamChatAgent } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import agentStyles from "./TeamChatAgents.module.css";
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

/** Agent tile with a presence dot; the label carries the state for assistive tech. */
/** Without `agent` (for example in the mention list) the tile shows no presence dot. */
export function TeamChatAgentAvatar({ agent }: { agent?: Pick<TeamChatAgent, "online" | "status"> }) {
  const online = agent !== undefined && agent.online && agent.status === "active";
  return (
    <span aria-hidden="true" className={agentStyles.agentAvatar}>
      <Bot size={13} />
      {agent ? <span className={`${agentStyles.presence} ${online ? agentStyles.presenceOnline : ""}`} /> : null}
    </span>
  );
}

export function agentPresenceLabel(agent: Pick<TeamChatAgent, "online" | "status">): string {
  const copy = messages.teamChat;
  return agent.status === "disabled" ? copy.agentDisabled : agent.online ? copy.agentOnline : copy.agentOffline;
}

export function TeamChatAgentBadge() {
  return <span className={agentStyles.badge}>{messages.teamChat.agentBadge}</span>;
}
