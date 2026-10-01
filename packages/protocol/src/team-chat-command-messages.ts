import type {
  TeamChatConnectionState,
  TeamChatConversation,
  TeamChatDirectory,
  TeamChatMessage,
  TeamChatMessagePage,
  TeamChatPushEvent,
  TeamChatVisibility
} from "@pi67/domain";

export interface TeamChatCommandPayloads {
  "teamChat.connection.get": Record<string, never>;
  "teamChat.directory.get": Record<string, never>;
  "teamChat.messages.list": { conversationId: string; before?: number; after?: number; limit?: number };
  "teamChat.message.send": { conversationId: string; clientKey: string; body: string };
  "teamChat.read.mark": { conversationId: string; lastReadSeq: number };
  "teamChat.channel.create": { name: string; visibility: TeamChatVisibility; memberUserIds: string[] };
  "teamChat.channel.join": { conversationId: string };
  "teamChat.dm.open": { userId: string };
}

export interface TeamChatCommandResults {
  "teamChat.connection.get": TeamChatConnectionState;
  "teamChat.directory.get": TeamChatDirectory;
  "teamChat.messages.list": TeamChatMessagePage;
  "teamChat.message.send": TeamChatMessage;
  "teamChat.read.mark": { lastReadSeq: number };
  "teamChat.channel.create": TeamChatConversation;
  "teamChat.channel.join": TeamChatConversation;
  "teamChat.dm.open": TeamChatConversation;
}

export interface TeamChatEventPayloads {
  "teamChat.pushed": TeamChatPushEvent;
  "teamChat.connectionChanged": TeamChatConnectionState;
}
