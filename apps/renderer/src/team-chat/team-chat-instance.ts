import { useStore } from "zustand";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { createTeamChatController } from "./team-chat-controller.js";
import type { TeamChatState } from "./team-chat-model.js";

const APP_CONTEXT = { scope: "app" as const };

/** The renderer's single Team Chat controller, bound to the Agent Host connection. */
export const teamChat = createTeamChatController({
  async request(type, payload) {
    await ensureAgentConnection();
    return agentConnectionController.request(type, payload, [], { context: APP_CONTEXT });
  },
  subscribe: (subscriber) => agentConnectionController.subscribe(subscriber),
  newClientKey: () => crypto.randomUUID()
});

export function useTeamChat<T>(selector: (state: TeamChatState) => T): T {
  return useStore(teamChat.store, selector);
}
