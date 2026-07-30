import type { FixtureWindow } from "./pi67-renderer-fixture-types.js";

export function installMockSessionRotationHandler(): void {
  const testWindow = window as FixtureWindow;
  testWindow.__pi67RotateMockSession = (current, sessionPath, messages = []) => {
    const index = ++current.sessionCounter;
    const sessionId = sessionPath ? `session-opened-${index}` : `session-created-${index}`;
    const resolvedPath = sessionPath ?? `/Users/test/.pi/agent/sessions/created-${index}.jsonl`;
    current.sessionGeneration += 1;
    current.conversationMessages = messages;
    current.workspaceChanges = { sessionId, items: [], truncated: false, total: 0 };
    current.snapshot = {
      ...current.snapshot,
      sessionId,
      sessionPath: resolvedPath,
      streaming: false,
      messages,
      messagePage: {
        ...(messages[0] === undefined ? {} : { startCursor: messages[0].id }),
        ...(messages.at(-1) === undefined ? {} : { endCursor: messages.at(-1)!.id }),
        hasOlder: false,
        hasNewer: false
      }
    };
  };
  testWindow.__pi67ForkMockSession = (current, entryId, position) => {
    const entryIndex = current.conversationMessages.findIndex((message) => message.id === entryId);
    const retainedMessages = entryIndex < 0
      ? current.conversationMessages
      : current.conversationMessages.slice(0, position === "before" ? entryIndex : entryIndex + 1);
    testWindow.__pi67RotateMockSession(current, undefined, retainedMessages);
  };
}
