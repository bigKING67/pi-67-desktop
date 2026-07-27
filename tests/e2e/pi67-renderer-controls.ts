import type { Page } from "@playwright/test";
import type { FixtureMessage } from "./pi67-renderer-fixture.js";
import type { FixtureResyncOperations } from "./pi67-renderer-fixture-types.js";

interface MockProtocolError {
  code: string;
  message: string;
  recoverable: boolean;
}

interface MockEventOptions {
  hostEpoch?: number;
  operationId?: string;
  sequence?: number;
  sessionId?: string;
  sessionGeneration?: number;
}

export interface RecordedCommand {
  type: string;
  payload: unknown;
  hostEpoch: number;
}

interface MockWorkspaceChanges {
  sessionId: string;
  items: unknown[];
  truncated: boolean;
  total: number;
}

export async function replaceMockAgentHost(page: Page, hostEpoch?: number): Promise<void> {
  await page.evaluate((nextHostEpoch) => {
    const state = (window as unknown as {
      __pi67TestAgent: { hostEpoch: number; attachHost(epoch: number): void };
    }).__pi67TestAgent;
    state.attachHost(nextHostEpoch ?? state.hostEpoch + 1);
  }, hostEpoch);
}

export async function setMockConversationMessages(page: Page, messages: FixtureMessage[]): Promise<void> {
  await page.evaluate((nextMessages) => {
    const state = (window as unknown as {
      __pi67TestAgent: { conversationMessages: FixtureMessage[] };
    }).__pi67TestAgent;
    state.conversationMessages = nextMessages;
  }, messages);
}

export async function setMockWorkspaceChanges(page: Page, changes: MockWorkspaceChanges): Promise<void> {
  await page.evaluate((nextChanges) => {
    (window as unknown as {
      __pi67TestAgent: { workspaceChanges: MockWorkspaceChanges };
    }).__pi67TestAgent.workspaceChanges = nextChanges;
  }, changes);
}

export async function setMockResyncOperations(
  page: Page,
  operations: FixtureResyncOperations
): Promise<void> {
  await page.evaluate((nextOperations) => {
    const state = (window as unknown as {
      __pi67TestAgent: {
        resyncOperations: FixtureResyncOperations;
        snapshot: Record<string, unknown>;
      };
    }).__pi67TestAgent;
    state.resyncOperations = nextOperations;
    state.snapshot = {
      ...state.snapshot,
      streaming: nextOperations.activeOperation !== undefined
    };
  }, operations);
}

export async function replaceMockSessionProjection(
  page: Page,
  sessionId: string,
  messages: FixtureMessage[]
): Promise<void> {
  await page.evaluate(({ nextSessionId, nextMessages }) => {
    const state = (window as unknown as {
      __pi67TestAgent: {
        conversationMessages: FixtureMessage[];
        sessionGeneration: number;
        workspaceChanges: MockWorkspaceChanges;
        snapshot: Record<string, unknown>;
        emit(event: { type: string; payload: unknown }, options?: MockEventOptions): void;
      };
    }).__pi67TestAgent;
    state.sessionGeneration += 1;
    state.conversationMessages = nextMessages;
    state.workspaceChanges = { sessionId: nextSessionId, items: [], truncated: false, total: 0 };
    const visibleMessages = nextMessages.slice(-100);
    state.snapshot = {
      ...state.snapshot,
      sessionId: nextSessionId,
      messages: visibleMessages,
      messagePage: {
        ...(visibleMessages[0] === undefined ? {} : { startCursor: visibleMessages[0].id }),
        ...(visibleMessages.at(-1) === undefined ? {} : { endCursor: visibleMessages.at(-1)!.id }),
        hasOlder: nextMessages.length > 100,
        hasNewer: false
      }
    };
    state.emit({
      type: "session.bootstrap",
      payload: { snapshot: state.snapshot, reason: "session-open" }
    }, {
      sessionId: nextSessionId,
      sessionGeneration: state.sessionGeneration
    });
  }, { nextSessionId: sessionId, nextMessages: messages });
}

export async function setMockAgentResponseFailure(
  page: Page,
  type: string,
  error: MockProtocolError
): Promise<void> {
  await page.evaluate(({ commandType, protocolError }) => {
    const state = (window as unknown as {
      __pi67TestAgent: { responseFailures: Record<string, MockProtocolError> };
    }).__pi67TestAgent;
    state.responseFailures[commandType] = protocolError;
  }, { commandType: type, protocolError: error });
}

export async function setMockAgentResponseDelay(page: Page, type: string, delayMs: number): Promise<void> {
  await page.evaluate(({ commandType, nextDelayMs }) => {
    const state = (window as unknown as {
      __pi67TestAgent: { responseDelays: Record<string, number> };
    }).__pi67TestAgent;
    if (nextDelayMs > 0) state.responseDelays[commandType] = nextDelayMs;
    else delete state.responseDelays[commandType];
  }, { commandType: type, nextDelayMs: delayMs });
}

export async function setMockAgentResponseResult(page: Page, type: string, result: unknown): Promise<void> {
  await page.evaluate(({ commandType, responseResult }) => {
    const state = (window as unknown as {
      __pi67TestAgent: { responseResults: Record<string, unknown> };
    }).__pi67TestAgent;
    state.responseResults[commandType] = responseResult;
  }, { commandType: type, responseResult: result });
}

export async function clearRecordedCommands(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __pi67TestAgent: { commands: RecordedCommand[] } }).__pi67TestAgent.commands = [];
  });
}

export async function recordedCommands(page: Page): Promise<string[]> {
  return page.evaluate(() => (
    window as unknown as { __pi67TestAgent: { commands: RecordedCommand[] } }
  ).__pi67TestAgent.commands.map((command) => command.type));
}

export async function recordedCommandDetails(page: Page): Promise<RecordedCommand[]> {
  return page.evaluate(() => [
    ...(window as unknown as { __pi67TestAgent: { commands: RecordedCommand[] } }).__pi67TestAgent.commands
  ]);
}

export async function emitMockAgentEvent(
  page: Page,
  event: unknown,
  options: MockEventOptions = {}
): Promise<void> {
  await page.evaluate(({ agentEvent, eventOptions }) => {
    const state = (window as unknown as {
      __pi67TestAgent: {
        emit(event: { type: string; payload: unknown }, options: MockEventOptions): void;
      };
    }).__pi67TestAgent;
    state.emit(agentEvent as { type: string; payload: unknown }, eventOptions);
  }, { agentEvent: event, eventOptions: options });
}
