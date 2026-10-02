import { Bell, BellOff, Hash, Lock, MessagesSquare, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { teamChatDirectPeer, type TeamChatConversation, type TeamChatDirectory } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { conversationTitle, memberById } from "./team-chat-model.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { teamChatTimeline } from "./team-chat-presentation.js";
import { TeamChatActivity } from "./TeamChatActivity.js";
import { TeamChatSearch } from "./TeamChatSearch.js";
import { agentPresenceLabel, TeamChatAgentAvatar, TeamChatAgentBadge, TeamChatAvatar } from "./TeamChatParts.js";
import agentStyles from "./TeamChatAgents.module.css";
import { TeamChatChannelSettings } from "./TeamChatChannelSettings.js";
import { TeamChatComposer } from "./TeamChatComposer.js";
import { TeamChatTimeline } from "./TeamChatTimeline.js";
import styles from "./TeamChat.module.css";
import governance from "./TeamChatGovernance.module.css";

const EMPTY: readonly never[] = [];

export function TeamChatWorkbench() {
  const copy = messages.teamChat;
  const connection = useTeamChat((state) => state.connection);
  const directory = useTeamChat((state) => state.directory);
  const conversation = useTeamChat((state) => state.directory?.conversations
    .find((item) => item.id === state.selectedConversationId));
  const panel = useTeamChat((state) => state.panel);

  let body;
  if (connection?.status === "signed-out") {
    body = <ChatState icon={<MessagesSquare size={22} />} title={copy.signedOutTitle} detail={copy.signedOutBody} />;
  } else if (directory && panel === "activity") {
    body = <TeamChatActivity directory={directory} />;
  } else if (directory && panel === "search") {
    body = <TeamChatSearch directory={directory} />;
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
        ? connection.reason === "entitlement-inactive" ? copy.unavailableEntitlement
          : connection.reason === "rejected" ? copy.unavailableRejected : copy.unavailableMember
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const focus = useTeamChat((state) => state.focus?.conversationId === conversation.id ? state.focus : undefined);

  // Mark read while this conversation is visible and focused.
  useEffect(() => {
    const read = () => { if (document.visibilityState === "visible" && document.hasFocus()) void teamChat.markRead(conversation.id); };
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [conversation.id, conversation.lastSeq]);

  const Icon = conversation.visibility === "private" ? Lock : Hash;
  const peerAgent = conversation.kind === "dm"
    ? directory.agents.find((agent) => agent.userId === teamChatDirectPeer(conversation, directory.selfUserId))
    : undefined;
  const header = (
    <>
      <header className={styles.conversationIntro}>
        {conversation.kind === "channel"
          ? <><Icon aria-hidden="true" size={16} /><strong>{title}</strong>
            <span>{`${conversation.visibility === "private" ? copy.privateChannel : copy.publicChannel} · ${conversation.memberCount} 位成员`}</span>
            {conversation.joined ? <MuteButton conversation={conversation} /> : null}
            {conversation.joined ? (
              <Button aria-label={copy.channelSettings} className="small-button"
                onPress={() => setSettingsOpen(true)}>
                <Settings2 aria-hidden="true" size={14} />{copy.channelSettings}
              </Button>
            ) : null}</>
          : <>{peerAgent ? <TeamChatAgentAvatar agent={peerAgent} /> : <TeamChatAvatar name={title} />}
            <strong>{title}</strong><span>{copy.directMessages}</span>
            <MuteButton conversation={conversation} /></>}
      </header>
      <AgentIntro conversation={conversation} directory={directory} />
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
          focus={focus}
          hasMore={thread.hasMore}
          hasNewer={thread.hasNewer === true}
          windowStart={thread.windowStart}
          header={header}
          loadingOlder={thread.loadingOlder}
          scrollRequest={scrollRequest}
          target={target}
        />
      ) : (
        <div className={styles.timelinePending}><div className={styles.timelineColumn}>{header}</div></div>
      )}
      {thread?.hasNewer ? (
        <Button className={`${styles.loadOlder} ${styles.jumpLatest}`} onPress={() => {
          void teamChat.reloadThread(conversation.id).then(() => setScrollRequest((value) => value + 1));
        }}>{copy.jumpToLatest}</Button>
      ) : null}
      {conversation.joined
        ? <TeamChatComposer conversation={conversation} directory={directory} onSent={() => setScrollRequest((value) => value + 1)} target={target} />
        : <JoinCard conversation={conversation} title={title} />}
      {settingsOpen ? <TeamChatChannelSettings conversation={conversation} directory={directory} onClose={() => setSettingsOpen(false)} /> : null}
    </>
  );
}

/** Mutes system notifications for this conversation; unread counts still apply. */
function MuteButton({ conversation }: { conversation: TeamChatConversation }) {
  const copy = messages.teamChat;
  const [busy, setBusy] = useState(false);
  const muted = conversation.muted === true;
  return (
    <Button className={`small-button ${governance.headerAction}`} data-testid="team-chat-mute" isDisabled={busy}
      onPress={() => {
        setBusy(true);
        void teamChat.muteConversation(conversation.id, !muted)
          .catch((error: unknown) => publishNotification({ level: "warning", title: copy.muteFailed, message: teamChatErrorMessage(error) }))
          .finally(() => setBusy(false));
      }}>
      {muted ? <Bell aria-hidden="true" size={14} /> : <BellOff aria-hidden="true" size={14} />}
      {muted ? copy.unmute : copy.mute}
    </Button>
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

/** For a direct message with an Agent: who runs it, with what model, and whether it is online. */
function AgentIntro({ conversation, directory }: { conversation: TeamChatConversation; directory: TeamChatDirectory }) {
  const copy = messages.teamChat;
  if (conversation.kind !== "dm") return null;
  const peer = teamChatDirectPeer(conversation, directory.selfUserId);
  const agent = directory.agents.find((item) => item.userId === peer);
  if (!agent) return null;
  const owner = memberById(directory, agent.ownerUserId)?.displayName ?? copy.unknownTeammate;
  return (
    <div className={agentStyles.intro} data-testid="team-chat-agent-intro">
      <div className={agentStyles.introTitle}>
        <TeamChatAgentBadge />
        <span className={agentStyles.rowMeta}>{`${copy.agentOwnedBy(owner)} · ${agentPresenceLabel(agent)}`}</span>
      </div>
      {agent.description ? <p className={agentStyles.disclosure}>{agent.description}</p> : null}
      <p className={agentStyles.disclosure}>{copy.agentDisclosure(owner, agent.modelLabel)}</p>
      {!agent.online && agent.status === "active" ? <p className={agentStyles.disclosure}>{copy.agentOfflineHint}</p> : null}
    </div>
  );
}
