import type { FixtureWindow } from "./pi67-renderer-fixture-types.js";

export function installMockSessionRotationHandler(): void {
  (window as FixtureWindow).__pi67RotateMockSession = (current, sessionPath) => {
    const index = ++current.sessionCounter;
    const sessionId = sessionPath ? `session-opened-${index}` : `session-created-${index}`;
    const resolvedPath = sessionPath ?? `/Users/test/.pi/agent/sessions/created-${index}.jsonl`;
    current.sessionGeneration += 1;
    current.conversationMessages = [];
    current.workspaceChanges = { sessionId, items: [], truncated: false, total: 0 };
    current.snapshot = {
      ...current.snapshot,
      sessionId,
      sessionPath: resolvedPath,
      streaming: false,
      messages: [],
      messagePage: { hasOlder: false, hasNewer: false }
    };
  };
}
