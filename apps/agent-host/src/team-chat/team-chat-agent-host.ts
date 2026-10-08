import {
  TEAM_CHAT_AGENT_LIMITS,
  teamChatCodePointLength,
  teamChatHasControlCharacter,
  type TeamChatAgentActivity
} from "@pi67/domain";
import type { CommandResults, TeamChatAgentHostState, TeamChatCommandPayloads } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";
import { TeamChatAgentBindingStore } from "./team-chat-agent-bindings.js";
import { TeamChatAgentGateway } from "./team-chat-agent-gateway.js";
import { TeamChatAgentRunner } from "./team-chat-agent-runner.js";
import type { TeamChatAgentTurns } from "./team-chat-agent-turns.js";
import type { TeamChatAccess } from "./team-chat-gateway.js";

export type TeamChatAgentCommandType =
  | "teamChat.agent.create" | "teamChat.agent.update" | "teamChat.agent.setDisabled" | "teamChat.agent.remove"
  | "teamChat.agent.host.get" | "teamChat.agent.host.bind" | "teamChat.agent.host.unbind";

export const TEAM_CHAT_AGENT_COMMANDS: readonly TeamChatAgentCommandType[] = [
  "teamChat.agent.create", "teamChat.agent.update", "teamChat.agent.setDisabled", "teamChat.agent.remove",
  "teamChat.agent.host.get", "teamChat.agent.host.bind", "teamChat.agent.host.unbind"
];

export interface TeamChatAgentHostDependencies {
  access(): Promise<TeamChatAccess>;
  storageRoot: string;
  turns: TeamChatAgentTurns | undefined;
  /** Reconnects realtime so a new ticket carries the hosted Agents (and starts it if idle). */
  refreshHosting(): void;
  onHostChanged(state: TeamChatAgentHostState): void;
}

/** This Desktop's side of Agent members (ADR 0004): management, bindings and the runner. */
export class TeamChatAgentHost {
  readonly bindings: TeamChatAgentBindingStore;
  readonly runner: TeamChatAgentRunner;

  constructor(private readonly dependencies: TeamChatAgentHostDependencies) {
    this.bindings = new TeamChatAgentBindingStore(dependencies.storageRoot);
    this.runner = new TeamChatAgentRunner({
      access: () => dependencies.access(),
      bindings: this.bindings,
      turns: dependencies.turns,
      onActivity: (activity) => { void this.#announce(activity); }
    });
  }

  /**
   * Agents to name in a realtime ticket. A hosted Agent that was disabled or removed
   * elsewhere is dropped (and disabled locally) instead of failing every reconnect.
   */
  async ticketAgentIds(access: TeamChatAccess, signal?: AbortSignal): Promise<string[]> {
    const enabled = await this.bindings.enabledAgentIds(access.teamId);
    if (enabled.length === 0 || !this.dependencies.turns) return [];
    const agents = await new TeamChatAgentGateway(access).listAgents(signal).catch(() => undefined);
    if (!agents) return [];
    const usable = new Set(agents.filter((agent) => agent.ownerUserId === access.userId && agent.status === "active")
      .map((agent) => agent.userId));
    await this.bindings.retain(access.teamId, new Set(agents.filter((agent) => agent.ownerUserId === access.userId)
      .map((agent) => agent.userId)));
    return enabled.filter((id) => usable.has(id));
  }

  async dispatch(
    type: TeamChatAgentCommandType,
    payload: TeamChatCommandPayloads[TeamChatAgentCommandType],
    signal?: AbortSignal
  ): Promise<CommandResults[TeamChatAgentCommandType]> {
    const access = await this.dependencies.access();
    const gateway = new TeamChatAgentGateway(access);
    switch (type) {
      case "teamChat.agent.create": {
        const input = payload as TeamChatCommandPayloads["teamChat.agent.create"];
        return gateway.createAgent({ name: agentName(input.name), description: agentDescription(input.description) }, signal);
      }
      case "teamChat.agent.update": {
        const { agentUserId, name, description, dailyLimit } = payload as TeamChatCommandPayloads["teamChat.agent.update"];
        return gateway.updateAgent(agentUserId, {
          ...(name === undefined ? {} : { name: agentName(name) }),
          ...(description === undefined ? {} : { description: agentDescription(description) }),
          ...(dailyLimit === undefined ? {} : { dailyLimit })
        }, signal);
      }
      case "teamChat.agent.setDisabled": {
        const { agentUserId, disabled } = payload as TeamChatCommandPayloads["teamChat.agent.setDisabled"];
        const agent = await gateway.setAgentDisabled(agentUserId, disabled, signal);
        if (await this.bindings.find(access.teamId, agentUserId)) this.dependencies.refreshHosting();
        return agent;
      }
      case "teamChat.agent.remove": {
        const { agentUserId } = payload as TeamChatCommandPayloads["teamChat.agent.remove"];
        await gateway.removeAgent(agentUserId, signal);
        if (await this.bindings.find(access.teamId, agentUserId)) {
          await this.bindings.remove(access.teamId, agentUserId);
          this.dependencies.refreshHosting();
          await this.#announce();
        }
        return {};
      }
      case "teamChat.agent.host.get":
        return this.state(access.teamId);
      case "teamChat.agent.host.bind": {
        const { binding, modelLabel } = payload as TeamChatCommandPayloads["teamChat.agent.host.bind"];
        const agent = (await gateway.listAgents(signal)).find((item) => item.userId === binding.agentUserId);
        if (!agent || agent.ownerUserId !== access.userId) throw invalid("Only your own Agents can run on this Desktop.");
        await this.bindings.put(access.teamId, binding).catch(() => { throw invalid("Each Desktop hosts at most five Agents."); });
        const label = modelLabel?.trim() || `${binding.model.provider} · ${binding.model.id}`;
        await gateway.updateAgent(agent.userId, { modelLabel: label.slice(0, 120) }, signal);
        this.dependencies.refreshHosting();
        return this.#announce();
      }
      case "teamChat.agent.host.unbind": {
        const { agentUserId } = payload as TeamChatCommandPayloads["teamChat.agent.host.unbind"];
        await this.bindings.remove(access.teamId, agentUserId);
        this.dependencies.refreshHosting();
        return this.#announce();
      }
    }
  }

  async state(teamId: string): Promise<TeamChatAgentHostState> {
    return { bindings: await this.bindings.list(teamId), activity: [...this.runner.activity] };
  }

  async #announce(activity?: readonly TeamChatAgentActivity[]): Promise<TeamChatAgentHostState> {
    const access = await this.dependencies.access();
    const state = { bindings: await this.bindings.list(access.teamId), activity: [...(activity ?? this.runner.activity)] };
    this.dependencies.onHostChanged(state);
    return state;
  }
}

function agentName(value: string): string {
  const name = value.trim();
  if (!name || teamChatCodePointLength(name) > TEAM_CHAT_AGENT_LIMITS.name || teamChatHasControlCharacter(name)) {
    throw invalid("Agent names need 1 to 40 printable characters.");
  }
  return name;
}

function agentDescription(value: string): string {
  if (teamChatCodePointLength(value) > TEAM_CHAT_AGENT_LIMITS.description || value.includes("\0")) {
    throw invalid("Agent descriptions are limited to 280 characters.");
  }
  return value.trim();
}

function invalid(message: string): HostCommandError {
  return new HostCommandError("INVALID_PAYLOAD", message, false);
}
