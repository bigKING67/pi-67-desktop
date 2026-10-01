import { ArrowUp, Hash, Lock, MessagesSquare } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { TEAM_CHAT_MESSAGE_MAX_CHARS, type TeamChatConversation, type TeamChatDirectory } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { canSendTo, conversationTitle } from "./team-chat-model.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { teamChatRemainingCharacters, teamChatTimeline } from "./team-chat-presentation.js";
import { TeamChatAvatar } from "./TeamChatParts.js";
import { TeamChatTimeline } from "./TeamChatTimeline.js";
import styles from "./TeamChat.module.css";

const EMPTY: readonly never[] = [];

export function TeamChatWorkbench() {
  const copy = messages.teamChat;
  const connection = useTeamChat((state) => state.connection);
  const directory = useTeamChat((state) => state.directory);
  const conversation = useTeamChat((state) => state.directory?.conversations
    .find((item) => item.id === state.selectedConversationId));

  let body;
  if (connection?.status === "signed-out") {
    body = <ChatState icon={<MessagesSquare size={22} />} title={copy.signedOutTitle} detail={copy.signedOutBody} />;
  } else if (!directory || !conversation) {
    body = <ChatState icon={<MessagesSquare size={22} />} title={copy.selectConversation} detail={copy.selectConversationBody} />;
  } else {
    body = <ConversationView conversation={conversation} directory={directory} key={conversation.id} />;
  }
  return (
    <section aria-label={copy.workbench} className={`workbench ${styles.workbench}`} data-testid="team-chat-workbench">
      <ConnectionBanner />
      {body}
    </section>
  );
}

function ConnectionBanner() {
  const copy = messages.teamChat;
  const connection = useTeamChat((state) => state.connection);
  const text = connection?.status === "reconnecting" ? copy.reconnecting
    : connection?.status === "connecting" ? copy.connecting
      : connection?.status === "unavailable"
        ? connection.reason === "entitlement-inactive" ? copy.unavailableEntitlement : copy.unavailableMember
        : undefined;
  if (!text) return null;
  return (
    <p className={`${styles.banner} ${connection?.status === "unavailable" ? styles.bannerWarning : ""}`}
      data-testid="team-chat-connection" role="status">{text}</p>
  );
}

function ChatState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className={styles.state}>
      <span aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function ConversationView({ conversation, directory }: { conversation: TeamChatConversation; directory: TeamChatDirectory }) {
  const copy = messages.teamChat;
  const thread = useTeamChat((state) => state.threads[conversation.id]);
  const pending = useTeamChat((state) => state.pending);
  const title = conversationTitle(directory, conversation, copy.unknownTeammate);
  const target = conversation.kind === "channel" ? `#${title}` : title;
  const conversationPending = useMemo(() => pending.filter((item) => item.conversationId === conversation.id), [pending, conversation.id]);
  const timeline = useMemo(() => teamChatTimeline(thread?.messages ?? EMPTY, conversationPending, directory.selfUserId, Date.now()),
    [thread?.messages, conversationPending, directory.selfUserId]);
  const [scrollRequest, setScrollRequest] = useState(0);

  // Mark read while this conversation is visible and focused.
  useEffect(() => {
    const read = () => { if (document.visibilityState === "visible" && document.hasFocus()) void teamChat.markRead(conversation.id); };
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [conversation.id, conversation.lastSeq]);

  const Icon = conversation.visibility === "private" ? Lock : Hash;
  const header = (
    <>
      <header className={styles.conversationIntro}>
        {conversation.kind === "channel"
          ? <><Icon aria-hidden="true" size={16} /><strong>{title}</strong>
            <span>{`${conversation.visibility === "private" ? copy.privateChannel : copy.publicChannel} · ${conversation.memberCount} 位成员`}</span></>
          : <><TeamChatAvatar name={title} /><strong>{title}</strong><span>{copy.directMessages}</span></>}
      </header>
      {!thread || thread.status === "loading" ? <p className={styles.timelineStatus} role="status">{copy.loadingMessages}</p> : null}
      {thread?.status === "error" ? (
        <div className={styles.timelineStatus} role="alert">
          <span>{copy.messagesFailed}</span>
          <Button className="secondary-button" onPress={() => void teamChat.reloadThread(conversation.id)}>{copy.retry}</Button>
        </div>
      ) : null}
      {thread?.status === "ready" && thread.hasMore ? (
        <Button className={styles.loadOlder!} isDisabled={thread.loadingOlder} onPress={() => void teamChat.loadOlder(conversation.id)}>
          {copy.loadOlder}
        </Button>
      ) : null}
      {thread?.status === "ready" && timeline.length === 0 ? <p className={styles.timelineStatus}>{copy.emptyConversation}</p> : null}
    </>
  );
  return (
    <>
      {/* Mount Virtuoso only with data so it opens at the newest message. */}
      {thread?.status === "ready" ? (
        <TeamChatTimeline
          conversationId={conversation.id}
          directory={directory}
          entries={timeline}
          hasMore={thread.hasMore}
          header={header}
          loadingOlder={thread.loadingOlder}
          scrollRequest={scrollRequest}
          target={target}
        />
      ) : (
        <div className={styles.timelinePending}><div className={styles.timelineColumn}>{header}</div></div>
      )}
      {conversation.joined
        ? <Composer conversation={conversation} directory={directory} onSent={() => setScrollRequest((value) => value + 1)} target={target} />
        : <JoinCard conversation={conversation} title={title} />}
    </>
  );
}

function JoinCard({ conversation, title }: { conversation: TeamChatConversation; title: string }) {
  const copy = messages.teamChat;
  const [joining, setJoining] = useState(false);
  return (
    <div className={styles.joinCard}>
      <div>
        <strong>{copy.joinTitle(title)}</strong>
        <p>{copy.joinBody}</p>
      </div>
      <Button className="primary-button" isDisabled={joining} onPress={() => {
        setJoining(true);
        void teamChat.joinChannel(conversation.id)
          .catch((error: unknown) => publishNotification({ level: "warning", title: copy.join, message: teamChatErrorMessage(error) }))
          .finally(() => setJoining(false));
      }}>{copy.join}</Button>
    </div>
  );
}

function Composer({ conversation, directory, target, onSent }: {
  conversation: TeamChatConversation;
  directory: TeamChatDirectory;
  target: string;
  onSent: () => void;
}) {
  const copy = messages.teamChat;
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const writable = canSendTo(directory, conversation);
  const remaining = teamChatRemainingCharacters(draft, TEAM_CHAT_MESSAGE_MAX_CHARS);
  const sendable = writable && draft.trim().length > 0 && (remaining === undefined || remaining >= 0);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [draft]);

  const send = () => {
    if (!sendable) return;
    const body = draft;
    setDraft("");
    onSent();
    void teamChat.send(conversation.id, body);
  };

  return (
    <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); send(); }}>
      {!writable ? <p className={styles.composerNotice} role="status">{copy.peerLeft}</p> : null}
      <div className={styles.composerField}>
        <textarea
          aria-label={copy.composerLabel(target)}
          disabled={!writable}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={copy.composerPlaceholder(target)}
          ref={input}
          rows={1}
          value={draft}
        />
        <Button aria-label={copy.send} className={styles.sendButton!} isDisabled={!sendable} type="submit">
          <ArrowUp aria-hidden="true" size={16} />
        </Button>
      </div>
      {remaining !== undefined ? (
        <small className={remaining < 0 ? styles.overLimit : undefined} role="status">
          {remaining < 0 ? copy.overLimit(-remaining) : copy.charactersLeft(remaining)}
        </small>
      ) : null}
    </form>
  );
}
