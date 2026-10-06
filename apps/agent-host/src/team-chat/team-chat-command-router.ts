import {
  TEAM_CHAT_ATTACHMENT_LIMITS,
  TEAM_CHAT_CHANNEL_NAME_MAX_CHARS,
  TEAM_CHAT_MESSAGE_MAX_CHARS,
  TEAM_CHAT_SEARCH_QUERY_MAX,
  TEAM_CHAT_WEBHOOK_NAME_MAX,
  TEAM_CHAT_WORK_CARD_LIMITS,
  teamChatAttachmentRejection,
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
import { TeamChatAgentGateway } from "./team-chat-agent-gateway.js";
import { TeamChatAttachmentTransfers } from "./team-chat-attachment-transfers.js";
import { TEAM_CHAT_AGENT_COMMANDS, TeamChatAgentHost, type TeamChatAgentCommandType } from "./team-chat-agent-host.js";
import type { TeamChatAgentTurns } from "./team-chat-agent-turns.js";
import type { TeamChatAccess } from "./team-chat-gateway.js";
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
  "teamChat.channel.members",
  "teamChat.channel.manage",
  "teamChat.dm.open",
  "teamChat.workCard.create",
  "teamChat.workCard.act",
  ...TEAM_CHAT_AGENT_COMMANDS,
  "teamChat.webhook.list",
  "teamChat.webhook.create",
  "teamChat.webhook.rotate",
  "teamChat.webhook.remove",
  "teamChat.activity.list",
  "teamChat.activity.setDone",
  "teamChat.activity.markAllRead",
  "teamChat.conversation.mute",
  "teamChat.search",
  "teamChat.message.edit",
  "teamChat.message.recall",
  "teamChat.attachment.begin",
  "teamChat.attachment.chunk",
  "teamChat.attachment.finish",
  "teamChat.attachment.discard",
  "teamChat.attachment.read"
]);

export function isTeamChatCommand(type: AgentCommandType): type is TeamChatCommandType {
  return TEAM_CHAT_COMMANDS.has(type);
}

export interface TeamChatRouterDependencies {
  session(): Promise<{ endpoint: string; credential: EnterpriseAccessCredential }>;
  events: HostEventChannel;
  credentials?: EnterpriseCredentialBrokerClient;
  realtime?: Partial<Pick<TeamChatRealtimeOptions, "openSocket" | "heartbeatTimeoutMs" | "random">>;
  /** Where this Desktop records which Agents it hosts (ADR 0004). */
  storageRoot?: string;
  /** Runs Agent turns; absent in hosts that cannot (Agents are then never claimed here). */
  agentTurns?: TeamChatAgentTurns;
  /** Object-storage transfers; tests inject a fake `fetch`. */
  transfers?: TeamChatAttachmentTransfers;
}

export class TeamChatCommandRouter {
  readonly #realtime: TeamChatRealtime;
  readonly #idle = new AbortController();
  readonly #agents: TeamChatAgentHost;
  readonly #transfers: TeamChatAttachmentTransfers;
  /** Whose bytes the transfers hold; another account or team drops them. */
  #transferOwner: string | undefined;
  #liveGeneration = 0;

  constructor(private readonly dependencies: TeamChatRouterDependencies) {
    const { credentials, events } = dependencies;
    this.#transfers = dependencies.transfers ?? new TeamChatAttachmentTransfers();
    this.#agents = new TeamChatAgentHost({
      access: () => this.#access(),
      storageRoot: dependencies.storageRoot ?? process.env.PI67_STORAGE_ROOT ?? process.cwd(),
      turns: dependencies.agentTurns,
      refreshHosting: () => { this.#realtime.start(); this.#realtime.reconnect(); },
      onHostChanged: (payload) => events.sendFor({ type: "teamChat.agentHostChanged", payload }, appContextAuthority())
    });
    this.#realtime = new TeamChatRealtime({
      ...dependencies.realtime,
      resolveUrl: async (signal) => {
        const access = await this.#access();
        const gateway = new TeamChatAgentGateway(access);
        const ticket = await gateway.issueRealtimeTicket(signal, await this.#agents.ticketAgentIds(access, signal));
        return teamChatRealtimeUrl(access.endpoint, access.teamId, ticket);
      },
      hasCredential: () => credentials?.snapshot().credential !== undefined,
      credentialSignal: () => credentials?.signal ?? this.#idle.signal,
      onState: (payload) => {
        events.sendFor({ type: "teamChat.connectionChanged", payload }, appContextAuthority());
        if (payload.status === "live" && payload.generation !== this.#liveGeneration) {
          this.#liveGeneration = payload.generation;
          void this.#agents.runner.catchUp().catch(() => undefined);
        }
      },
      onPush: (payload) => {
        if (payload.type === "agent.invoked") {
          this.#agents.runner.enqueue(payload.invocationId, payload.agentUserId);
          return;
        }
        // A request the service ended stops here too (ADR 0008: a recall cancels it).
        if (payload.type === "agent_invocation.changed" && (payload.invocation.status === "failed" || payload.invocation.status === "expired")) {
          this.#agents.runner.cancel(payload.invocation.id);
        }
        events.sendFor({ type: "teamChat.pushed", payload }, appContextAuthority());
      }
    });
    // A Desktop hosting Agents connects at startup, not only when Chat is opened.
    void this.#agents.bindings.hasEnabled().then((hosting) => { if (hosting) this.#realtime.start(); }, () => undefined);
    this.#agents.runner.startPolling();
  }

  shutdown(): void {
    this.#agents.runner.stop();
    this.#realtime.stop();
    this.#transfers.clear();
  }

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
    const gateway = new TeamChatAgentGateway(access);
    if (isAgentCommand(command)) return this.#agents.dispatch(command.type, command.payload, signal);
    switch (command.type) {
      case "teamChat.directory.get": {
        const [members, conversations, policy, agents, bots] = await Promise.all([
          gateway.listMembers(signal),
          gateway.listConversations(signal),
          gateway.getPolicyOrDefault(signal),
          // Services before Agent members or webhooks lack these routes; Chat works without them.
          gateway.listAgents(signal).catch(() => []),
          gateway.listBots(signal).catch(() => [])
        ]);
        return { teamId: access.teamId, selfUserId: access.userId, members, conversations, policy, agents, bots };
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
        const { conversationId, clientKey, body, mentionUserIds, attachmentIds = [] } = command.payload as TeamChatCommandPayloads["teamChat.message.send"];
        // Attachments may stand alone; otherwise the text carries the message.
        if ((!body.trim() && attachmentIds.length === 0) || teamChatCodePointLength(body) > TEAM_CHAT_MESSAGE_MAX_CHARS || body.includes("\0")
          || attachmentIds.length > TEAM_CHAT_ATTACHMENT_LIMITS.perMessage || new Set(attachmentIds).size !== attachmentIds.length) {
          throw invalid("Messages need 1 to 4000 characters or up to 10 distinct attachments.");
        }
        return gateway.postMessage(conversationId, {
          clientKey,
          // Blank text beside files is no text.
          body: attachmentIds.length > 0 && !body.trim() ? "" : body,
          ...(mentionUserIds === undefined || mentionUserIds.length === 0 ? {} : { mentionUserIds }),
          ...(attachmentIds.length === 0 ? {} : { attachmentIds })
        }, signal);
      }
      case "teamChat.attachment.begin": {
        const { conversationId, ...input } = command.payload as TeamChatCommandPayloads["teamChat.attachment.begin"];
        if (teamChatAttachmentRejection({ name: input.fileName, size: input.byteSize }) !== undefined) {
          throw invalid("This file cannot be attached.");
        }
        const { attachment, upload } = await gateway.createAttachment(conversationId, input, signal);
        this.#transfers.begin(attachment, upload);
        return { attachment };
      }
      case "teamChat.attachment.chunk": {
        const { attachmentId, offset, data } = command.payload as TeamChatCommandPayloads["teamChat.attachment.chunk"];
        return { received: this.#transfers.chunk(attachmentId, offset, data) };
      }
      case "teamChat.attachment.finish": {
        const { attachmentId } = command.payload as TeamChatCommandPayloads["teamChat.attachment.finish"];
        return { attachment: await this.#transfers.finish(attachmentId, signal) };
      }
      case "teamChat.attachment.discard":
        // The service discards the unused grant on its own (ADR 0009).
        this.#transfers.discard((command.payload as TeamChatCommandPayloads["teamChat.attachment.discard"]).attachmentId);
        return {};
      case "teamChat.attachment.read": {
        const { attachmentId, offset, length } = command.payload as TeamChatCommandPayloads["teamChat.attachment.read"];
        return this.#transfers.read(attachmentId, offset, length ?? TEAM_CHAT_ATTACHMENT_LIMITS.chunk,
          () => gateway.attachmentDownload(attachmentId, signal), signal);
      }
      case "teamChat.message.edit": {
        const { conversationId, messageId, body, mentionUserIds } = command.payload as TeamChatCommandPayloads["teamChat.message.edit"];
        if (!body.trim() || teamChatCodePointLength(body) > TEAM_CHAT_MESSAGE_MAX_CHARS || body.includes("\0")) {
          throw invalid("Messages need 1 to 4000 characters.");
        }
        return gateway.editMessage(conversationId, messageId, {
          body,
          ...(mentionUserIds === undefined || mentionUserIds.length === 0 ? {} : { mentionUserIds })
        }, signal);
      }
      case "teamChat.message.recall": {
        const { conversationId, messageId } = command.payload as TeamChatCommandPayloads["teamChat.message.recall"];
        return gateway.recallMessage(conversationId, messageId, signal);
      }
      case "teamChat.read.mark": {
        const { conversationId, lastReadSeq } = command.payload as TeamChatCommandPayloads["teamChat.read.mark"];
        return { lastReadSeq: await gateway.markRead(conversationId, lastReadSeq, signal) };
      }
      case "teamChat.channel.create": {
        const input = command.payload as TeamChatCommandPayloads["teamChat.channel.create"];
        return gateway.createChannel({ ...input, name: channelName(input.name) }, signal);
      }
      case "teamChat.channel.join":
        return gateway.joinChannel((command.payload as TeamChatCommandPayloads["teamChat.channel.join"]).conversationId, signal);
      case "teamChat.channel.members":
        return gateway.channelMembers((command.payload as TeamChatCommandPayloads["teamChat.channel.members"]).conversationId, signal);
      case "teamChat.channel.manage": {
        const { conversationId, action } = command.payload as TeamChatCommandPayloads["teamChat.channel.manage"];
        if (action.type === "rename") {
          const name = channelName(action.name);
          await gateway.manageChannel(conversationId, { type: "rename", name }, signal);
        } else {
          await gateway.manageChannel(conversationId, action, signal);
        }
        return {};
      }
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
      case "teamChat.webhook.list":
        return { webhooks: await gateway.listWebhooks((command.payload as TeamChatCommandPayloads["teamChat.webhook.list"]).conversationId, signal) };
      case "teamChat.webhook.create": {
        const { conversationId, name } = command.payload as TeamChatCommandPayloads["teamChat.webhook.create"];
        const trimmed = name.trim();
        if (!trimmed || teamChatCodePointLength(trimmed) > TEAM_CHAT_WEBHOOK_NAME_MAX || teamChatHasControlCharacter(trimmed)) {
          throw invalid("Webhook names need 1 to 40 printable characters.");
        }
        return gateway.createWebhook(conversationId, trimmed, signal);
      }
      case "teamChat.webhook.rotate": {
        const { conversationId, botUserId } = command.payload as TeamChatCommandPayloads["teamChat.webhook.rotate"];
        return gateway.rotateWebhook(conversationId, botUserId, signal);
      }
      case "teamChat.webhook.remove": {
        const { conversationId, botUserId } = command.payload as TeamChatCommandPayloads["teamChat.webhook.remove"];
        await gateway.removeWebhook(conversationId, botUserId, signal);
        return {};
      }
      case "teamChat.workCard.act": {
        const { cardId, action, expectedRevision } = command.payload as TeamChatCommandPayloads["teamChat.workCard.act"];
        return gateway.actOnWorkCard(cardId, action, expectedRevision, signal);
      }
      case "teamChat.activity.list":
        return { items: await gateway.listActivity(signal) };
      case "teamChat.activity.setDone": {
        const { keys, done } = command.payload as TeamChatCommandPayloads["teamChat.activity.setDone"];
        await gateway.setActivityDone(keys, done, signal);
        return {};
      }
      case "teamChat.activity.markAllRead":
        await gateway.markActivityRead(signal);
        return {};
      case "teamChat.conversation.mute": {
        const { conversationId, muted } = command.payload as TeamChatCommandPayloads["teamChat.conversation.mute"];
        return { muted: await gateway.muteConversation(conversationId, muted, signal) };
      }
      case "teamChat.search": {
        const { query, ...filters } = command.payload as TeamChatCommandPayloads["teamChat.search"];
        const text = query.trim();
        if (!text || teamChatCodePointLength(text) > TEAM_CHAT_SEARCH_QUERY_MAX || teamChatHasControlCharacter(text)) {
          throw invalid("Search for 1 to 100 printable characters.");
        }
        return gateway.searchMessages({ query: text, ...filters }, signal);
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
    const owner = `${endpoint}\n${credential.accountId}\n${credential.userId}`;
    if (owner !== this.#transferOwner) {
      this.#transfers.clear();
      this.#transferOwner = owner;
    }
    return { endpoint, accessToken: credential.accessToken, teamId: credential.accountId, userId: credential.userId };
  }
}

function isAgentCommand(command: AgentCommand<TeamChatCommandType>): command is AgentCommand<TeamChatAgentCommandType> {
  return (TEAM_CHAT_AGENT_COMMANDS as readonly string[]).includes(command.type);
}

function channelName(value: string): string {
  const name = value.trim();
  if (!name || teamChatCodePointLength(name) > TEAM_CHAT_CHANNEL_NAME_MAX_CHARS || teamChatHasControlCharacter(name)) {
    throw invalid("Channel names need 1 to 80 printable characters.");
  }
  return name;
}

function invalid(message: string): HostCommandError {
  return new HostCommandError("INVALID_PAYLOAD", message, false);
}
