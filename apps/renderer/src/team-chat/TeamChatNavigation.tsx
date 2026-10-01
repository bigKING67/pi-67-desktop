import { Hash, Lock, Plus } from "lucide-react";
import { Button } from "react-aria-components";
import { teamChatDirectPeer, type TeamChatConversation, type TeamChatMember } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { conversationTitle, directMessageWith } from "./team-chat-model.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { TeamChatAvatar, UnreadCount } from "./TeamChatParts.js";
import styles from "./TeamChat.module.css";

export function TeamChatNavigation({ onCreateChannel }: { onCreateChannel: () => void }) {
  const copy = messages.teamChat;
  const connection = useTeamChat((state) => state.connection);
  const directory = useTeamChat((state) => state.directory);
  const directoryStatus = useTeamChat((state) => state.directoryStatus);
  const selectedId = useTeamChat((state) => state.selectedConversationId);

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
    return conversation.kind === "dm" && !directory.members.some((member) => member.userId === peer);
  });

  return (
    <nav aria-label={copy.region} className={styles.railLists} data-testid="team-chat-navigation">
      <section aria-labelledby="team-chat-channels" className={styles.railSection}>
        <header>
          <h2 id="team-chat-channels">{copy.channels}</h2>
          <Button aria-label={copy.newChannel} className={styles.railIconButton!} onPress={onCreateChannel}>
            <Plus aria-hidden="true" size={14} />
          </Button>
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
    </nav>
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
        conversation.unreadCount > 0 ? copy.unread(conversation.unreadCount) : undefined].filter(Boolean).join("，")}
      className={`${styles.railRow} ${selected ? styles.railRowSelected : ""} ${conversation.joined ? "" : styles.railRowMuted}`}
      onPress={() => void teamChat.selectConversation(conversation.id)}
    >
      {conversation.kind === "channel"
        ? <Icon aria-hidden="true" className={styles.railRowIcon} size={15} />
        : <TeamChatAvatar name={title} />}
      <span className={styles.railRowTitle}>{title}</span>
      {conversation.joined ? <UnreadCount count={conversation.unreadCount} /> : <small>{copy.joinableChannel}</small>}
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
  return (
    <Button
      aria-current={selected ? "page" : false}
      aria-label={unread > 0 ? `${member.displayName}，${copy.unread(unread)}` : member.displayName}
      className={`${styles.railRow} ${selected ? styles.railRowSelected : ""}`}
      data-testid="team-chat-teammate"
      onPress={() => void teamChat.openDirectMessage(member.userId).catch((error: unknown) => publishNotification({
        level: "warning", title: copy.openDirectMessageFailed, message: teamChatErrorMessage(error)
      }))}
    >
      <TeamChatAvatar name={member.displayName} />
      <span className={styles.railRowTitle}>{member.displayName}</span>
      <UnreadCount count={unread} />
    </Button>
  );
}
