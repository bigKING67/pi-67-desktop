import {
  TEAM_CHAT_CHANNEL_NAME_MAX_CHARS,
  TEAM_CHAT_MESSAGE_MAX_CHARS,
  TEAM_CHAT_WORK_CARD_LIMITS,
  teamChatCodePointLength,
  teamChatHasControlCharacter
} from "@pi67/domain";
import type {
  AgentCommand,
  AgentCommandType,
  CommandResults,
  EnterpriseAccessCredential,
  TeamChatCommandPayloads
} from "@pi67/protocol";
import type { HostEventChannel } from "../host-event-channel.js";
import { HostCommandError } from "../protocol-error.js";
import { appContextAuthority } from "../context/context-memory-support.js";
import type { EnterpriseCredentialBrokerClient } from "../context/enterprise-credential-broker-client.js";
import { TeamChatGateway, type TeamChatAccess } from "./team-chat-gateway.js";
import { TeamChatRealtime, teamChatRealtimeUrl, type TeamChatRealtimeOptions } from "./team-chat-realtime.js";

export type TeamChatCommandType = keyof TeamChatCommandPayloads;

const TEAM_CHAT_COMMANDS: ReadonlySet<string> = new Set<TeamChatCommandType>([
  "teamChat.connection.get",
  "teamChat.directory.get",
  "teamChat.messages.list",
  "teamChat.message.send",
  "teamChat.read.mark",
  "teamChat.channel.create",
  "teamChat.channel.join",
  "teamChat.dm.open",
  "teamChat.workCard.create",
  "teamChat.workCard.act"
]);

export function isTeamChatCommand(type: AgentCommandType): type is TeamChatCommandType {
  return TEAM_CHAT_COMMANDS.has(type);
}

export interface TeamChatRouterDependencies {
  session(): Promise<{ endpoint: string; credential: EnterpriseAccessCredential }>;
  events: HostEventChannel;
  credentials?: EnterpriseCredentialBrokerClient;
  realtime?: Partial<Pick<TeamChatRealtimeOptions, "openSocket" | "heartbeatTimeoutMs" | "random">>;
}

export class TeamChatCommandRouter {
  readonly #realtime: TeamChatRealtime;
  readonly #idle = new AbortController();

  constructor(private readonly dependencies: TeamChatRouterDependencies) {
    const { credentials, events } = dependencies;
    this.#realtime = new TeamChatRealtime({
      ...dependencies.realtime,
      resolveUrl: async (signal) => {
        const access = await this.#access();
        const ticket = await new TeamChatGateway(access).issueRealtimeTicket(signal);
        return teamChatRealtimeUrl(access.endpoint, access.teamId, ticket);
      },
      hasCredential: () => credentials?.snapshot().credential !== undefined,
      credentialSignal: () => credentials?.signal ?? this.#idle.signal,
      onState: (payload) => events.sendFor({ type: "teamChat.connectionChanged", payload }, appContextAuthority()),
      onPush: (payload) => events.sendFor({ type: "teamChat.pushed", payload }, appContextAuthority())
    });
  }

  shutdown(): void { this.#realtime.stop(); }

  async dispatch<T extends TeamChatCommandType>(
    command: AgentCommand<T>,
    signal?: AbortSignal
  ): Promise<CommandResults[T]> {
    return await this.#dispatch(command as AgentCommand<TeamChatCommandType>, signal) as CommandResults[T];
  }

  async #dispatch(
    command: AgentCommand<TeamChatCommandType>,
    signal: AbortSignal | undefined
  ): Promise<CommandResults[TeamChatCommandType]> {
    this.#realtime.start();
    if (command.type === "teamChat.connection.get") return this.#realtime.state;
    const access = await this.#access();
    const gateway = new TeamChatGateway(access);
    switch (command.type) {
      case "teamChat.directory.get": {
        const [members, conversations] = await Promise.all([
          gateway.listMembers(signal),
          gateway.listConversations(signal)
        ]);
        return { teamId: access.teamId, selfUserId: access.userId, members, conversations };
      }
      case "teamChat.messages.list": {
        const { conversationId, before, after, limit } = command.payload as TeamChatCommandPayloads["teamChat.messages.list"];
        if (before !== undefined && after !== undefined) throw invalid("Use either before or after, not both.");
        return gateway.listMessages(conversationId, {
          ...(before === undefined ? {} : { before }),
          ...(after === undefined ? {} : { after }),
          ...(limit === undefined ? {} : { limit })
        }, signal);
      }
      case "teamChat.message.send": {
        const { conversationId, clientKey, body } = command.payload as TeamChatCommandPayloads["teamChat.message.send"];
        if (!body.trim() || teamChatCodePointLength(body) > TEAM_CHAT_MESSAGE_MAX_CHARS || body.includes("\0")) {
          throw invalid("Messages need 1 to 4000 characters.");
        }
        return gateway.postMessage(conversationId, clientKey, body, signal);
      }
      case "teamChat.read.mark": {
        const { conversationId, lastReadSeq } = command.payload as TeamChatCommandPayloads["teamChat.read.mark"];
        return { lastReadSeq: await gateway.markRead(conversationId, lastReadSeq, signal) };
      }
      case "teamChat.channel.create": {
        const input = command.payload as TeamChatCommandPayloads["teamChat.channel.create"];
        const name = input.name.trim();
        if (!name || teamChatCodePointLength(name) > TEAM_CHAT_CHANNEL_NAME_MAX_CHARS || teamChatHasControlCharacter(name)) {
          throw invalid("Channel names need 1 to 80 printable characters.");
        }
        return gateway.createChannel({ ...input, name }, signal);
      }
      case "teamChat.channel.join":
        return gateway.joinChannel((command.payload as TeamChatCommandPayloads["teamChat.channel.join"]).conversationId, signal);
      case "teamChat.workCard.create": {
        const { conversationId, ...input } = command.payload as TeamChatCommandPayloads["teamChat.workCard.create"];
        const title = input.title.trim();
        const limits = TEAM_CHAT_WORK_CARD_LIMITS;
        const tooLong = (text: string, maximum: number) => teamChatCodePointLength(text) > maximum || text.includes("\0");
        if (!title || tooLong(title, limits.title) || teamChatHasControlCharacter(title)
          || tooLong(input.goal, limits.section) || tooLong(input.acceptance, limits.section)
          || tooLong(input.summary, limits.summary)) {
          throw invalid("Work Card fields exceed their limits.");
        }
        return gateway.createWorkCard(conversationId, { ...input, title }, signal);
      }
      case "teamChat.workCard.act": {
        const { cardId, action, expectedRevision } = command.payload as TeamChatCommandPayloads["teamChat.workCard.act"];
        return gateway.actOnWorkCard(cardId, action, expectedRevision, signal);
      }
      case "teamChat.dm.open": {
        const { userId } = command.payload as TeamChatCommandPayloads["teamChat.dm.open"];
        if (userId === access.userId) throw invalid("Choose a teammate other than yourself.");
        return gateway.openDirectMessage(userId, signal);
      }
    }
  }

  async #access(): Promise<TeamChatAccess> {
    const { endpoint, credential } = await this.dependencies.session();
    return { endpoint, accessToken: credential.accessToken, teamId: credential.accountId, userId: credential.userId };
  }
}

function invalid(message: string): HostCommandError {
  return new HostCommandError("INVALID_PAYLOAD", message, false);
}
