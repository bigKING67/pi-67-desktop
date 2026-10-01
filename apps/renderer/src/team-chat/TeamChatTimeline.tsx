import { RotateCw } from "lucide-react";
import { forwardRef, useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { TeamChatDirectory } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { memberById } from "./team-chat-model.js";
import { teamChat } from "./team-chat-instance.js";
import { useTeamChatDialogStore } from "./team-chat-dialog-store.js";
import { formatTeamChatTime, teamChatMentionSegments, type TeamChatTimelineEntry } from "./team-chat-presentation.js";
import { chatMessageWorkBrief } from "./team-chat-work-bridge.js";
import { TeamChatWorkCard } from "./TeamChatWorkCard.js";
import styles from "./TeamChat.module.css";
import governance from "./TeamChatGovernance.module.css";

/** Large base so prepending older pages keeps indices positive (Virtuoso prepend contract). */
const FIRST_ITEM_BASE = 1_000_000_000;

/**
 * Virtualized conversation timeline. Each entry is one message (day labels ride on
 * the first message of a day), so loading older history is a pure prepend.
 */
export function TeamChatTimeline({ conversationId, directory, entries, target, header, hasMore, loadingOlder, scrollRequest }: {
  conversationId: string;
  directory: TeamChatDirectory;
  entries: TeamChatTimelineEntry[];
  target: string;
  header: ReactNode;
  hasMore: boolean;
  loadingOlder: boolean;
  /** Increments when the reader sends, forcing the view to the newest message. */
  scrollRequest: number;
}) {
  const virtuoso = useRef<VirtuosoHandle>(null);
  const firstKey = useRef<string | undefined>(undefined);
  const firstItemIndex = useRef(FIRST_ITEM_BASE);

  // Count entries added before the previous first entry: that is the prepend size.
  const previousFirst = firstKey.current;
  if (previousFirst !== undefined && entries[0]?.key !== previousFirst) {
    const position = entries.findIndex((entry) => entry.key === previousFirst);
    if (position > 0) firstItemIndex.current -= position;
  }
  firstKey.current = entries[0]?.key;

  useEffect(() => {
    if (scrollRequest > 0) virtuoso.current?.scrollToIndex({ index: "LAST", behavior: "auto" });
  }, [scrollRequest]);

  return (
    <Virtuoso<TeamChatTimelineEntry, TimelineContext>
      alignToBottom
      aria-label={target}
      className={styles.timeline}
      components={TIMELINE_COMPONENTS}
      context={{ header }}
      computeItemKey={(_, entry) => entry.key}
      data={entries}
      firstItemIndex={firstItemIndex.current}
      followOutput={(atBottom) => atBottom ? "auto" : false}
      increaseViewportBy={{ top: 400, bottom: 200 }}
      initialTopMostItemIndex={Math.max(0, entries.length - 1)}
      itemContent={(_, entry) => (
        <div className={styles.timelineColumn}>
          <TimelineMessage directory={directory} entry={entry} target={target} />
        </div>
      )}
      key={conversationId}
      ref={virtuoso}
      startReached={() => { if (hasMore && !loadingOlder) void teamChat.loadOlder(conversationId); }}
    />
  );
}

interface TimelineContext {
  header: ReactNode;
}

const TimelineScroller = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function TimelineScroller(props, ref) {
  return <div {...props} ref={ref} role="log" tabIndex={0} />;
});

/** Stable component identities so Virtuoso never remounts the header or scroller. */
const TIMELINE_COMPONENTS = {
  Header: ({ context }: { context: TimelineContext }) => <div className={styles.timelineColumn}>{context.header}</div>,
  Scroller: TimelineScroller
};

function TimelineMessage({ directory, entry, target }: { directory: TeamChatDirectory; entry: TeamChatTimelineEntry; target: string }) {
  const copy = messages.teamChat;
  const sender = entry.senderUserId === directory.selfUserId
    ? copy.you
    : memberById(directory, entry.senderUserId)?.displayName ?? copy.unknownTeammate;
  const mentionsSelf = entry.senderUserId !== directory.selfUserId && (entry.mentionUserIds?.includes(directory.selfUserId) ?? false);
  return (
    <>
      {entry.dayLabel ? <div className={styles.daySeparator}><span>{entry.dayLabel}</span></div> : null}
      <article className={`${styles.message} ${entry.showHeader ? styles.messageGroupStart : ""} ${entry.pending ? styles.messagePending : ""} ${mentionsSelf ? governance.messageMentionsSelf : ""}`}>
        {entry.showHeader ? (
          <header>
            <strong>{sender}</strong>
            <time dateTime={new Date(entry.createdAt).toISOString()}>{formatTeamChatTime(entry.createdAt)}</time>
          </header>
        ) : null}
        {entry.workCard ? <TeamChatWorkCard card={entry.workCard} directory={directory} /> : <MessageBody directory={directory} entry={entry} />}
        {!entry.pending && !entry.workCard ? (
          <Button
            className={styles.messageAction!}
            onPress={() => useTeamChatDialogStore.getState().openStartWork({
              text: chatMessageWorkBrief({ conversationLabel: target, senderName: sender, body: entry.body })
            })}
          >{copy.handleInWork}</Button>
        ) : null}
        {entry.pending?.status === "sending" ? <small role="status">{copy.sending}</small> : null}
        {entry.pending?.status === "failed" ? (
          <div className={styles.pendingFailure} role="alert">
            <span>{`${copy.sendFailed}：${entry.pending.error ?? copy.genericError}`}</span>
            <Button className={styles.textAction!} onPress={() => void teamChat.retrySend(entry.pending!.clientKey)}>
              <RotateCw aria-hidden="true" size={13} />{copy.retrySend}
            </Button>
            <Button className={styles.textAction!} onPress={() => teamChat.discardPending(entry.pending!.clientKey)}>{copy.discard}</Button>
          </div>
        ) : null}
      </article>
    </>
  );
}

/** Message text with `@name` runs styled for mentioned members; the reader's own mention stands out. */
function MessageBody({ directory, entry }: { directory: TeamChatDirectory; entry: TeamChatTimelineEntry }) {
  const mentioned = (entry.mentionUserIds ?? []).flatMap((userId) => {
    const member = memberById(directory, userId);
    return member ? [{ userId, displayName: member.displayName }] : [];
  });
  if (mentioned.length === 0) return <p>{entry.body}</p>;
  return (
    <p>
      {teamChatMentionSegments(entry.body, mentioned).map((segment, index) => segment.userId === undefined ? segment.text : (
        <span className={`${governance.mention} ${segment.userId === directory.selfUserId ? governance.mentionSelf : ""}`} key={index}>
          {segment.text}
        </span>
      ))}
    </p>
  );
}
