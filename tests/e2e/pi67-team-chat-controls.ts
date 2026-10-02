import type { Page } from "@playwright/test";
import { emitMockAgentEvent } from "./pi67-renderer-controls.js";
import type { MockTeamChatState } from "./pi67-team-chat-command-fixture.js";

/** Signs the mock Team Chat in and announces a live connection. */
export async function signIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __pi67MockTeamChat: MockTeamChatState }).__pi67MockTeamChat.connection = { status: "live", generation: 1 };
  });
  await emitMockAgentEvent(page, { type: "teamChat.connectionChanged", payload: { status: "live", generation: 1 } }, { context: "app" });
}

