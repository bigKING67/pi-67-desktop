import { messages } from "../localization/message-catalog.js";
import { useShellStore } from "../shell/shell-store.js";
import { conversationTitle } from "./team-chat-model.js";
import { useTeamChat } from "./team-chat-instance.js";

/** TitleBar context while Chat is the active mode; undefined in Work mode. */
export function useTeamChatTitle(): string | undefined {
  const chatMode = useShellStore((state) => state.workspaceMode === "chat");
  const title = useTeamChat((state) => {
    if (state.activityOpen) return messages.teamChat.activity;
    const conversation = state.directory?.conversations.find((item) => item.id === state.selectedConversationId);
    if (!conversation) return undefined;
    const name = conversationTitle(state.directory, conversation, messages.teamChat.unknownTeammate);
    return conversation.kind === "channel" ? `# ${name}` : name;
  });
  return chatMode ? title ?? messages.teamChat.chat : undefined;
}
