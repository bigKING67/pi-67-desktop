import { Hash, Lock, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";
import {
  teamChatCanCreateAgent,
  teamChatCanCreateChannel,
  teamChatDirectPeer,
  type TeamChatAgent,
  type TeamChatConversation,
  type TeamChatMember
} from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { conversationTitle, directMessageWith } from "./team-chat-model.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { agentPresenceLabel, RowCounts, TeamChatAgentAvatar, TeamChatAvatar } from "./TeamChatParts.js";
import { TeamChatAgentsDialog } from "./TeamChatAgentsDialog.js";
import agentStyles from "./TeamChatAgents.module.css";
import styles from "./TeamChat.module.css";

export function TeamChatNavigation({ onCreateChannel }: { onCreateChannel: () => void }) {
  const copy = messages.teamChat;
  const connection = useTeamChat((state) => state.connection);
  const directory = useTeamChat((state) => state.directory);
  const directoryStatus = useTeamChat((state) => state.directoryStatus);
  const selectedId = useTeamChat((state) => state.selectedConversationId);
  const [agentsOpen, setAgentsOpen] = useState(false);

  if (connection?.status === "signed-out") {
    return (
      <div className={styles.railNotice} data-testid="team-chat-signed-out">
        <strong>{copy.signedOutTitle}</strong>
        <p>{copy.signedOutBody}</p>
        <Button className="secondary-button" onPress={() => rendererWorkbenchStore.getState().openSettings("account")}>
          {copy.openAccount}
        </Button>
      </div>
    );
  }
  if (!directory) {
    return directoryStatus === "error" ? (
      <div className={styles.railNotice} role="alert">
        <p>{copy.directoryFailed}</p>
        <Button className="secondary-button" onPress={() => void teamChat.retryDirectory()}>{copy.retry}</Button>
      </div>
    ) : (
      <p className={styles.railStatus} role="status">{copy.loadingDirectory}</p>
    );
  }

  const channels = directory.conversations.filter((conversation) => conversation.kind === "channel");
  const teammates = directory.members.filter((member) => member.userId !== directory.selfUserId);
  const orphanDirectMessages = directory.conversations.filter((conversation) => {
    const peer = teamChatDirectPeer(conversation, directory.selfUserId);
    return conversation.kind === "dm" && !directory.members.some((member) => member.userId === peer)
      && !directory.agents.some((agent) => agent.userId === peer);
  });
  const canCreateAgent = teamChatCanCreateAgent(directory);
  const ownsAgents = directory.agents.some((agent) => agent.ownerUserId === directory.selfUserId);

  return (
    <nav aria-label={copy.region} className={styles.railLists} data-testid="team-chat-navigation">
      <section aria-labelledby="team-chat-channels" className={styles.railSection}>
        <header>
          <h2 id="team-chat-channels">{copy.channels}</h2>
          {teamChatCanCreateChannel(directory) ? (
            <Button aria-label={copy.newChannel} className={styles.railIconButton!} onPress={onCreateChannel}>
              <Plus aria-hidden="true" size={14} />
            </Button>
          ) : null}
        </header>
        {channels.length === 0 ? <p className={styles.railEmpty}>{copy.noChannels}</p> : (
          <ul>
            {channels.map((conversation) => (
              <li key={conversation.id}>
                <ConversationRow conversation={conversation} selected={conversation.id === selectedId}
                  title={conversation.name ?? ""} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="team-chat-teammates" className={styles.railSection}>
        <header><h2 id="team-chat-teammates">{copy.teammates}</h2></header>
        {teammates.length === 0 && orphanDirectMessages.length === 0 ? <p className={styles.railEmpty}>{copy.noTeammates}</p> : (
          <ul>
            {teammates.map((member) => {
              const conversation = directMessageWith(directory, member.userId);
              return (
                <li key={member.userId}>
                  <TeammateRow conversation={conversation} member={member}
                    selected={conversation !== undefined && conversation.id === selectedId} />
                </li>
              );
            })}
            {orphanDirectMessages.map((conversation) => (
              <li key={conversation.id}>
                <ConversationRow conversation={conversation} selected={conversation.id === selectedId}
                  title={conversationTitle(directory, conversation, copy.unknownTeammate)} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="team-chat-agents" className={styles.railSection}>
        <header>
          <h2 id="team-chat-agents">{copy.agents}</h2>
          {canCreateAgent || ownsAgents ? (
            <Button aria-label={copy.manageAgents} className={styles.railIconButton!} data-testid="team-chat-manage-agents"
              onPress={() => setAgentsOpen(true)}>
              <Settings2 aria-hidden="true" size={14} />
            </Button>
          ) : null}
        </header>
        {directory.agents.length === 0 ? (
          <p className={styles.railEmpty}>{canCreateAgent ? copy.noAgents : copy.noAgentsReadOnly}</p>
        ) : (
          <ul>
            {directory.agents.map((agent) => {
              const conversation = directMessageWith(directory, agent.userId);
              return (
                <li key={agent.userId}>
                  <AgentRow agent={agent} conversation={conversation} mine={agent.ownerUserId === directory.selfUserId}
                    selected={conversation !== undefined && conversation.id === selectedId} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {agentsOpen ? <TeamChatAgentsDialog onClose={() => setAgentsOpen(false)} /> : null}
    </nav>
  );
}

function AgentRow({ agent, conversation, mine, selected }: {
  agent: TeamChatAgent;
  conversation: TeamChatConversation | undefined;
  mine: boolean;
  selected: boolean;
}) {
  const copy = messages.teamChat;
  const unread = conversation?.unreadCount ?? 0;
  return (
    <Button
      aria-current={selected ? "page" : false}
      aria-label={[agent.name, copy.agentBadge, agentPresenceLabel(agent), mine ? copy.agentMine : undefined,
        unread > 0 ? copy.unread(unread) : undefined].filter(Boolean).join("，")}
      className={`${styles.railRow} ${selected ? styles.railRowSelected : ""} ${agent.status === "disabled" ? styles.railRowMuted : ""}`}
      data-testid="team-chat-agent"
      onPress={() => void teamChat.openDirectMessage(agent.userId).catch((error: unknown) => publishNotification({
        level: "warning", title: copy.openDirectMessageFailed, message: teamChatErrorMessage(error)
      }))}
    >
      <TeamChatAgentAvatar agent={agent} />
      <span className={styles.railRowTitle}>{agent.name}</span>
      {unread > 0 ? <RowCounts mentions={0} unread={unread} /> : mine ? <small className={agentStyles.rowMeta}>{copy.agentMine}</small> : null}
    </Button>
  );
}

function ConversationRow({ conversation, selected, title }: {
  conversation: TeamChatConversation;
  selected: boolean;
  title: string;
}) {
  const copy = messages.teamChat;
  const Icon = conversation.visibility === "private" ? Lock : Hash;
  return (
    <Button
      aria-current={selected ? "page" : false}
      aria-label={[title, conversation.visibility === "private" ? copy.privateChannel : undefined,
        conversation.joined ? undefined : copy.joinableChannel,
        conversation.unreadCount > 0 ? copy.unread(conversation.unreadCount) : undefined,
        conversation.mentionCount > 0 ? copy.mentions(conversation.mentionCount) : undefined].filter(Boolean).join("，")}
      className={`${styles.railRow} ${selected ? styles.railRowSelected : ""} ${conversation.joined ? "" : styles.railRowMuted}`}
      onPress={() => void teamChat.selectConversation(conversation.id)}
    >
      {conversation.kind === "channel"
        ? <Icon aria-hidden="true" className={styles.railRowIcon} size={15} />
        : <TeamChatAvatar name={title} />}
      <span className={styles.railRowTitle}>{title}</span>
      {conversation.joined
        ? <RowCounts mentions={conversation.mentionCount} unread={conversation.unreadCount} />
        : <small>{copy.joinableChannel}</small>}
    </Button>
  );
}

function TeammateRow({ conversation, member, selected }: {
  conversation: TeamChatConversation | undefined;
  member: TeamChatMember;
  selected: boolean;
}) {
  const copy = messages.teamChat;
  const unread = conversation?.unreadCount ?? 0;
  const mentioned = conversation?.mentionCount ?? 0;
  return (
    <Button
      aria-current={selected ? "page" : false}
      aria-label={[member.displayName, unread > 0 ? copy.unread(unread) : undefined,
        mentioned > 0 ? copy.mentions(mentioned) : undefined].filter(Boolean).join("，")}
      className={`${styles.railRow} ${selected ? styles.railRowSelected : ""}`}
      data-testid="team-chat-teammate"
      onPress={() => void teamChat.openDirectMessage(member.userId).catch((error: unknown) => publishNotification({
        level: "warning", title: copy.openDirectMessageFailed, message: teamChatErrorMessage(error)
      }))}
    >
      <TeamChatAvatar name={member.displayName} />
      <span className={styles.railRowTitle}>{member.displayName}</span>
      <RowCounts mentions={mentioned} unread={unread} />
    </Button>
  );
}
