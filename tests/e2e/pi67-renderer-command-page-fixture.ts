import type { FixtureAgentState, FixtureMessage, FixtureWindow } from "./pi67-renderer-fixture-types.js";

type MockConversationCommandType = "message.locate" | "message.page" | "message.search";

export type MockConversationCommandHandler = (
  type: MockConversationCommandType,
  payload: Record<string, unknown>,
  state: FixtureAgentState
) => Record<string, unknown>;

export function installMockConversationCommandHandler(): void {
  const testWindow = window as FixtureWindow & {
    __pi67ResolveMockConversationCommand?: MockConversationCommandHandler;
  };
  const resolveMockConversationCommand: MockConversationCommandHandler = (type, payload, current) => {
    if (type === "message.page") return conversationPage(current, payload);
    if (type === "message.search") return searchConversation(current, payload);
    return locateConversationMessage(current, payload);
  };

  function conversationPage(
    current: FixtureAgentState,
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    const direction = payload.direction === "newer" ? "newer" : "older";
    const limit = typeof payload.limit === "number" ? Math.min(200, Math.max(1, payload.limit)) : 100;
    const cursor = typeof payload.cursor === "string" ? payload.cursor : undefined;
    const cursorIndex = cursor === undefined
      ? undefined
      : current.conversationMessages.findIndex((message) => message.id === cursor);
    const start = direction === "older"
      ? Math.max(0, (cursorIndex ?? current.conversationMessages.length) - limit)
      : cursorIndex === undefined ? 0 : cursorIndex + 1;
    const end = direction === "older"
      ? cursorIndex ?? current.conversationMessages.length
      : Math.min(current.conversationMessages.length, start + limit);
    const messages = current.conversationMessages.slice(start, end);
    return {
      sessionId: String(current.snapshot.sessionId),
      messages,
      ...pageMetadata(messages, start > 0, end < current.conversationMessages.length)
    };
  }

  function searchConversation(
    current: FixtureAgentState,
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    const query = typeof payload.query === "string" ? payload.query : "";
    const normalizedQuery = query.toLocaleLowerCase();
    const items = current.conversationMessages.flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const text = message.parts
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
      if (!text.toLocaleLowerCase().includes(normalizedQuery)) return [];
      return [{
        id: message.id,
        role: message.role,
        snippet: text.slice(0, 240),
        ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt })
      }];
    });
    return {
      sessionId: String(current.snapshot.sessionId),
      revision: 1,
      query,
      total: items.length,
      items,
      truncated: false
    };
  }

  function locateConversationMessage(
    current: FixtureAgentState,
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    const anchorId = typeof payload.id === "string" ? payload.id : "";
    const anchorIndex = current.conversationMessages.findIndex((message) => message.id === anchorId);
    const start = Math.max(0, anchorIndex - 40);
    const end = Math.min(current.conversationMessages.length, Math.max(anchorIndex + 41, start + 1));
    const messages = current.conversationMessages.slice(start, end);
    return {
      sessionId: String(current.snapshot.sessionId),
      revision: 1,
      anchorId,
      messages,
      ...pageMetadata(messages, start > 0, end < current.conversationMessages.length)
    };
  }

  function pageMetadata(
    messages: FixtureMessage[],
    hasOlder: boolean,
    hasNewer: boolean
  ): Record<string, unknown> {
    return {
      ...(messages[0] === undefined ? {} : { startCursor: messages[0].id }),
      ...(messages.at(-1) === undefined ? {} : { endCursor: messages.at(-1)!.id }),
      hasOlder,
      hasNewer
    };
  }

  testWindow.__pi67ResolveMockConversationCommand = resolveMockConversationCommand;
}
