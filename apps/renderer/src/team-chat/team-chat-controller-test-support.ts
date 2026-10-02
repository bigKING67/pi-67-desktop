import { TEAM_CHAT_DEFAULT_POLICY, type TeamChatConversation, type TeamChatDirectory, type TeamChatMessage } from "@pi67/domain";
import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { vi } from "vitest";
import type { ConnectionSubscriber } from "../connection/agent-connection-controller-contract.js";
import { createTeamChatController, type TeamChatPort } from "./team-chat-controller.js";

/** Shared fixtures for the Team Chat controller tests. */
export const conversation: TeamChatConversation = {
  id: "c1", kind: "channel", visibility: "public", name: "研究", joined: true, memberCount: 2, memberUserIds: [],
  lastSeq: 2, lastReadSeq: 1, unreadCount: 1, mentionCount: 0, createdAt: 1
};
export const directory: TeamChatDirectory = {
  teamId: "t", selfUserId: "me", members: [{ userId: "me", displayName: "Me", role: "owner" }], conversations: [conversation],
  policy: TEAM_CHAT_DEFAULT_POLICY,
  agents: [],
  bots: []
};
export const message = (seq: number, patch: Partial<TeamChatMessage> = {}): TeamChatMessage => ({
  id: `m${seq}`, conversationId: "c1", seq, senderUserId: "u2", body: `m${seq}`, clientKey: `client-${seq}`, createdAt: seq, ...patch
});
const appEnvelope = { context: { scope: "app" } } as EventEnvelope;
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A controller over a scripted port; unknown commands reject. */
export function harness(handlers: Partial<Record<string, (payload: never) => unknown>>) {
  let subscriber: ConnectionSubscriber = {};
  const calls: Array<{ type: string; payload: unknown }> = [];
  const port: TeamChatPort = {
    request: vi.fn(async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      const handler = handlers[type];
      if (!handler) throw new Error(`unexpected ${type}`);
      return await handler(payload as never);
    }) as unknown as TeamChatPort["request"],
    subscribe: (next) => { subscriber = next; return () => { subscriber = {}; }; },
    newClientKey: () => "client-key-new"
  };
  const controller = createTeamChatController(port);
  const emit = (event: AgentEvent) => subscriber.onEvent?.(event, appEnvelope);
  return { controller, calls, emit, connect: () => subscriber.onConnected?.({} as never), subscriber: () => subscriber };
}
