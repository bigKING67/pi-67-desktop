import type { FixtureWindow } from "./pi67-renderer-fixture-types.js";

export function installMockSessionRotationHandler(): void {
  const testWindow = window as FixtureWindow;
  const fileIdentityByPath = new Map([
    ["/Users/test/.pi/agent/sessions/demo.jsonl", "session-file-fixture-demo"]
  ]);
  testWindow.__pi67RotateMockSession = (current, sessionPath, messages = [], knownFileIdentity) => {
    const index = ++current.sessionCounter;
    const sessionId = sessionPath ? `session-opened-${index}` : `session-created-${index}`;
    const resolvedPath = sessionPath ?? `/Users/test/.pi/agent/sessions/created-${index}.jsonl`;
    const sessionFileIdentity = knownFileIdentity
      ?? fileIdentityByPath.get(resolvedPath)
      ?? `session-file-fixture-${index}`;
    fileIdentityByPath.set(resolvedPath, sessionFileIdentity);
    current.sessionGeneration += 1;
    current.conversationMessages = messages;
    current.workspaceChanges = { sessionId, items: [], truncated: false, total: 0 };
    current.snapshot = {
      ...current.snapshot,
      sessionId,
      sessionFileIdentity,
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
