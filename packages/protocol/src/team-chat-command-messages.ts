import type {
  TeamChatActivityItem,
  TeamChatAgent,
  TeamChatAgentActivity,
  TeamChatAgentBinding,
  TeamChatWebhook,
  TeamChatChannelAction,
  TeamChatChannelRoster,
  TeamChatConnectionState,
  TeamChatConversation,
  TeamChatDirectory,
  TeamChatMessage,
  TeamChatMessagePage,
  TeamChatPushEvent,
  TeamChatSearchPage,
  TeamChatVisibility,
  TeamChatWorkCard,
  TeamChatWorkCardAction,
  TeamChatWorkCardRef
} from "@pi67/domain";

export interface TeamChatCommandPayloads {
  "teamChat.connection.get": Record<string, never>;
  "teamChat.directory.get": Record<string, never>;
  "teamChat.messages.list": { conversationId: string; before?: number; after?: number; limit?: number };
  "teamChat.message.send": { conversationId: string; clientKey: string; body: string; mentionUserIds?: string[] };
  "teamChat.read.mark": { conversationId: string; lastReadSeq: number };
  "teamChat.channel.create": { name: string; visibility: TeamChatVisibility; memberUserIds: string[] };
  "teamChat.channel.join": { conversationId: string };
  "teamChat.channel.members": { conversationId: string };
  "teamChat.channel.manage": { conversationId: string; action: TeamChatChannelAction };
  "teamChat.dm.open": { userId: string };
  "teamChat.workCard.create": {
    conversationId: string;
    clientKey: string;
    title: string;
    goal: string;
    acceptance: string;
    summary: string;
    refs: TeamChatWorkCardRef[];
    assigneeUserId?: string;
  };
  "teamChat.workCard.act": { cardId: string; action: TeamChatWorkCardAction; expectedRevision: number };
  "teamChat.agent.create": { name: string; description: string };
  "teamChat.agent.update": { agentUserId: string; name?: string; description?: string; dailyLimit?: number };
  "teamChat.agent.setDisabled": { agentUserId: string; disabled: boolean };
  "teamChat.agent.remove": { agentUserId: string };
  "teamChat.agent.host.get": Record<string, never>;
  "teamChat.agent.host.bind": { binding: TeamChatAgentBinding };
  "teamChat.agent.host.unbind": { agentUserId: string };
  "teamChat.webhook.list": { conversationId: string };
  "teamChat.webhook.create": { conversationId: string; name: string };
  "teamChat.webhook.rotate": { conversationId: string; botUserId: string };
  "teamChat.webhook.remove": { conversationId: string; botUserId: string };
  "teamChat.activity.list": Record<string, never>;
  "teamChat.activity.setDone": { keys: string[]; done: boolean };
  "teamChat.activity.markAllRead": Record<string, never>;
  "teamChat.conversation.mute": { conversationId: string; muted: boolean };
  "teamChat.search": { query: string; conversationId?: string; senderUserId?: string; cursor?: string };
  "teamChat.message.edit": { conversationId: string; messageId: string; body: string; mentionUserIds?: string[] };
  "teamChat.message.recall": { conversationId: string; messageId: string };
}

/** The secret delivery URL appears only in this result, once; it is never stored by Desktop. */
export interface TeamChatWebhookSecret {
  webhook: TeamChatWebhook;
  url: string;
}

/** This Desktop's hosting state for the current team's Agents. */
export interface TeamChatAgentHostState {
  bindings: TeamChatAgentBinding[];
  activity: TeamChatAgentActivity[];
}

export interface TeamChatCommandResults {
  "teamChat.connection.get": TeamChatConnectionState;
  "teamChat.directory.get": TeamChatDirectory;
  "teamChat.messages.list": TeamChatMessagePage;
  "teamChat.message.send": TeamChatMessage;
  "teamChat.read.mark": { lastReadSeq: number };
  "teamChat.channel.create": TeamChatConversation;
  "teamChat.channel.join": TeamChatConversation;
  "teamChat.channel.members": TeamChatChannelRoster;
  "teamChat.channel.manage": Record<string, never>;
  "teamChat.dm.open": TeamChatConversation;
  "teamChat.workCard.create": TeamChatMessage;
  "teamChat.workCard.act": TeamChatWorkCard;
  "teamChat.agent.create": TeamChatAgent;
  "teamChat.agent.update": TeamChatAgent;
  "teamChat.agent.setDisabled": TeamChatAgent;
  "teamChat.agent.remove": Record<string, never>;
  "teamChat.agent.host.get": TeamChatAgentHostState;
  "teamChat.agent.host.bind": TeamChatAgentHostState;
  "teamChat.agent.host.unbind": TeamChatAgentHostState;
  "teamChat.webhook.list": { webhooks: TeamChatWebhook[] };
  "teamChat.webhook.create": TeamChatWebhookSecret;
  "teamChat.webhook.rotate": TeamChatWebhookSecret;
  "teamChat.webhook.remove": Record<string, never>;
  "teamChat.activity.list": { items: TeamChatActivityItem[] };
  "teamChat.activity.setDone": Record<string, never>;
  "teamChat.activity.markAllRead": Record<string, never>;
  "teamChat.conversation.mute": { muted: boolean };
  "teamChat.search": TeamChatSearchPage;
  "teamChat.message.edit": TeamChatMessage;
  "teamChat.message.recall": TeamChatMessage;
}

export interface TeamChatEventPayloads {
  "teamChat.pushed": TeamChatPushEvent;
  "teamChat.connectionChanged": TeamChatConnectionState;
  "teamChat.agentHostChanged": TeamChatAgentHostState;
}
