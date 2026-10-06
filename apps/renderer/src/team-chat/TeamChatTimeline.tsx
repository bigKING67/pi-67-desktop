import { RotateCw } from "lucide-react";
import { forwardRef, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { teamChatCanPost, teamChatMessagePermissions, type TeamChatConversation, type TeamChatDirectory } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { memberById } from "./team-chat-model.js";
import { teamChat } from "./team-chat-instance.js";
import { useTeamChatDialogStore } from "./team-chat-dialog-store.js";
import { formatTeamChatTime, teamChatInvocationText, teamChatMentionSegments, type TeamChatTimelineEntry } from "./team-chat-presentation.js";
import { TeamChatAgentBadge, TeamChatBotBadge } from "./TeamChatParts.js";
import agentStyles from "./TeamChatAgents.module.css";
import { chatMessageWorkBrief } from "./team-chat-work-bridge.js";
import { TeamChatMessageAttachments } from "./TeamChatAttachments.js";
import { TeamChatWorkCard } from "./TeamChatWorkCard.js";
import styles from "./TeamChat.module.css";
import governance from "./TeamChatGovernance.module.css";

/** Large base so prepending older pages keeps indices positive (Virtuoso prepend contract). */
const FIRST_ITEM_BASE = 1_000_000_000;

/**
 * Virtualized conversation timeline. Each entry is one message (day labels ride on
 * the first message of a day), so loading older history is a pure prepend.
 */
export function TeamChatTimeline({ conversation, directory, entries, target, header, hasMore, hasNewer, windowStart, loadingOlder, scrollRequest, focus }: {
  conversation: TeamChatConversation;
  directory: TeamChatDirectory;
  entries: TeamChatTimelineEntry[];
  target: string;
  header: ReactNode;
  hasMore: boolean;
  /** A window at older history: reaching the bottom loads newer messages. */
  hasNewer: boolean;
  /** Changes when a window replaces the history; the list remounts centred on the focus. */
  windowStart: number | undefined;
  loadingOlder: boolean;
  /** Increments when the reader sends, forcing the view to the newest message. */
  scrollRequest: number;
  /** A message opened from activity or a notification: centered and briefly highlighted. */
  focus?: { seq: number; revision: number } | undefined;
}) {
  const conversationId = conversation.id;
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
    if (scrollRequest > 0) virtuoso.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, [scrollRequest]);

  const [highlighted, setHighlighted] = useState<number>();
  const handledFocus = useRef<number | undefined>(undefined);
  const focusIndex = focus === undefined ? -1 : entries.findIndex((entry) => entry.seq === focus.seq);
  // Once per focus request: later entries must not re-center the view.
  useEffect(() => {
    if (focus === undefined || focusIndex < 0 || handledFocus.current === focus.revision) return;
    handledFocus.current = focus.revision;
    virtuoso.current?.scrollToIndex({ index: focusIndex, align: "center", behavior: "auto" });
    setHighlighted(focus.seq);
  }, [focus, focusIndex]);
  useEffect(() => {
    if (highlighted === undefined) return;
    const timer = window.setTimeout(() => setHighlighted(undefined), 2_400);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

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
      followOutput={(atBottom) => atBottom && !hasNewer ? "auto" : false}
      increaseViewportBy={{ top: 400, bottom: 200 }}
      // Body line-height is fractional; rounding each row accumulates scroll drift.
      itemSize={(element) => element.getBoundingClientRect().height}
      initialTopMostItemIndex={focusIndex >= 0 && windowStart !== undefined
        ? { index: focusIndex, align: "center" }
        : { index: "LAST", align: "end" }}
      itemContent={(_, entry) => (
        // The newest row keeps its end, often a bordered file card, off the composer's edge.
        <div className={`${styles.timelineColumn} ${entry === entries.at(-1) ? styles.timelineLast : ""}`}>
          <TimelineMessage conversation={conversation} directory={directory} entry={entry} focused={entry.seq !== undefined && entry.seq === highlighted} target={target} />
        </div>
      )}
      key={`${conversationId}:${windowStart ?? "latest"}`}
      ref={virtuoso}
      endReached={() => { if (hasNewer) void teamChat.loadNewer(conversationId); }}
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

function TimelineMessage({ conversation, directory, entry, focused, target }: {
  conversation: TeamChatConversation;
  directory: TeamChatDirectory;
  entry: TeamChatTimelineEntry;
  focused: boolean;
  target: string;
}) {
  const copy = messages.teamChat;
  const participant = memberById(directory, entry.senderUserId);
  const own = entry.senderUserId === directory.selfUserId;
  const sender = own ? copy.you : participant?.displayName ?? copy.unknownTeammate;
  const mentionsSelf = !own && (entry.mentionUserIds?.includes(directory.selfUserId) ?? false);
  const recalled = entry.recalledAt !== undefined;
  return (
    <>
      {entry.dayLabel ? <div className={styles.daySeparator}><span>{entry.dayLabel}</span></div> : null}
      <article className={`${styles.message} ${entry.showHeader ? styles.messageGroupStart : ""} ${entry.pending ? styles.messagePending : ""} ${mentionsSelf ? governance.messageMentionsSelf : ""} ${focused ? governance.messageFocused : ""}`}
        data-focused={focused || undefined}>
        {entry.showHeader ? (
          <header>
            <strong>{sender}</strong>
            {participant?.agent ? <TeamChatAgentBadge /> : participant?.bot ? <TeamChatBotBadge /> : null}
            <time dateTime={new Date(entry.createdAt).toISOString()}>{formatTeamChatTime(entry.createdAt)}</time>
          </header>
        ) : null}
        {recalled ? (
          <p className={styles.messageRecalled}>
            {entry.recalledBy !== undefined && entry.recalledBy !== entry.senderUserId ? copy.removedByManager
              : own ? copy.recalledOwn : copy.recalledBy(sender)}
          </p>
        ) : entry.workCard ? <TeamChatWorkCard card={entry.workCard} directory={directory} /> : (
          <MessageBody directory={directory} entry={entry} />
        )}
        {!recalled && entry.attachments ? <TeamChatMessageAttachments attachments={entry.attachments} pending={entry.pending !== undefined} /> : null}
        {recalled ? null : <InvocationStates directory={directory} entry={entry} />}
        {!entry.pending && !recalled ? (
          <MessageActions conversation={conversation} directory={directory} entry={entry} sender={sender} target={target} />
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

/** Hover actions: edit and recall own messages, remove others' as a channel manager, hand off to Work. */
function MessageActions({ conversation, directory, entry, sender, target }: {
  conversation: TeamChatConversation;
  directory: TeamChatDirectory;
  entry: TeamChatTimelineEntry;
  sender: string;
  target: string;
}) {
  const copy = messages.teamChat;
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const role = directory.members.find((member) => member.userId === directory.selfUserId)?.role;
  const allowed = teamChatMessagePermissions(entry, conversation, {
    userId: directory.selfUserId, role, canPost: teamChatCanPost(directory)
  });
  const removing = allowed.remove;
  const recall = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    void teamChat.recallMessage(conversation.id, entry.key)
      .catch((error: unknown) => publishNotification({ level: "warning", title: copy.recallFailed, message: teamChatErrorMessage(error) }))
      .finally(() => { setBusy(false); setArmed(false); });
  };
  return (
    <div className={`${styles.messageActions} ${armed ? styles.messageActionsArmed : ""}`}
      onKeyDown={(event) => { if (event.key === "Escape" && armed) { event.stopPropagation(); setArmed(false); } }}
      onMouseLeave={() => setArmed(false)}>
      {allowed.edit ? (
        <Button className={styles.messageAction!} onPress={() => teamChat.startEditing(conversation.id, entry.key)}>{copy.editMessage}</Button>
      ) : null}
      {allowed.recall || removing ? (
        <Button className={`${styles.messageAction} ${armed ? styles.messageActionArmed : ""}`} isDisabled={busy}
          onBlur={() => setArmed(false)} onPress={recall}>
          {armed ? removing ? copy.confirmRemove : copy.confirmRecall : removing ? copy.removeMessage : copy.recallMessage}
        </Button>
      ) : null}
      {entry.workCard ? null : (
        <Button
          className={styles.messageAction!}
          onPress={() => useTeamChatDialogStore.getState().openStartWork({
            text: chatMessageWorkBrief({ conversationLabel: target, senderName: sender, body: entry.body })
          })}
        >{copy.handleInWork}</Button>
      )}
    </div>
  );
}

/** Message text with `@name` runs styled for mentioned members; the reader's own mention stands out. */
function MessageBody({ directory, entry }: { directory: TeamChatDirectory; entry: TeamChatTimelineEntry }) {
  const mentioned = (entry.mentionUserIds ?? []).flatMap((userId) => {
    const member = memberById(directory, userId);
    return member ? [{ userId, displayName: member.displayName }] : [];
  });
  const edited = entry.editedAt === undefined ? null : <span className={styles.messageEdited}>{messages.teamChat.edited}</span>;
  // A message of files alone has no text line.
  if (!entry.body && !edited) return null;
  if (mentioned.length === 0) return <p>{entry.body}{edited}</p>;
  return (
    <p>
      {teamChatMentionSegments(entry.body, mentioned).map((segment, index) => segment.userId === undefined ? segment.text : (
        <span className={`${governance.mention} ${segment.userId === directory.selfUserId ? governance.mentionSelf : ""}`} key={index}>
          {segment.text}
        </span>
      ))}
      {edited}
    </p>
  );
}

/** One line per Agent this message asked, until its reply arrives. */
function InvocationStates({ directory, entry }: { directory: TeamChatDirectory; entry: TeamChatTimelineEntry }) {
  const lines = (entry.agentInvocations ?? []).flatMap((invocation) => {
    const agent = directory.agents.find((item) => item.userId === invocation.agentUserId);
    const text = teamChatInvocationText(invocation, agent?.name ?? messages.teamChat.agentBadge, agent?.online ?? false);
    return text === undefined ? [] : [{ id: invocation.id, text, problem: invocation.status !== "queued" && invocation.status !== "running" }];
  });
  if (lines.length === 0) return null;
  return (
    <div className={agentStyles.invocations}>
      {lines.map((line) => (
        <small className={`${agentStyles.invocation} ${line.problem ? agentStyles.invocationProblem : ""}`} key={line.id} role="status">
          {line.text}
        </small>
      ))}
    </div>
  );
}
