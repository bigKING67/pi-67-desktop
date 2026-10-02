import type { TeamChatAgent, TeamChatBot, TeamChatMessage, TeamChatWebhook } from "@pi67/domain";
import {
  asRecord,
  boundedInteger,
  boundedString,
  invalidResponse,
  parseTimestamp
} from "../context/enterprise-context-gateway-validation.js";
import { TeamChatGateway, nullable, parseMessage } from "./team-chat-gateway.js";

const MAX_AGENTS = 50;
const MAX_PENDING = 50;
const MAX_CONTEXT = 20;

/** A request the service routed to one of this user's Agents. */
export interface TeamChatAgentInvocation {
  id: string;
  agentUserId: string;
  conversationId: string;
  messageId: string;
  messageSeq: number;
  invokerUserId: string;
  expiresAt: number;
}

/** A claimed request: the bounded context is the only conversation content this Desktop receives. */
export interface TeamChatAgentClaim {
  invocation: TeamChatAgentInvocation;
  /** Completion and failure must repeat it; a lapsed or re-issued lease refuses them. */
  leaseToken: string;
  conversationKind: "channel" | "dm";
  conversationName?: string;
  messages: TeamChatMessage[];
}

export type TeamChatAgentFailure = "not_configured" | "model_unavailable" | "runtime_error" | "cancelled";

/** Agent members (ADR 0004): management for every member, invocations for the owner. */
export class TeamChatAgentGateway extends TeamChatGateway {
  async listAgents(signal?: AbortSignal): Promise<TeamChatAgent[]> {
    const value = asRecord(await this.request("/chat/agents", { method: "GET" }, signal));
    if (!Array.isArray(value.agents) || value.agents.length > MAX_AGENTS) throw invalidResponse("agents");
    return value.agents.map(parseAgent);
  }

  async createAgent(input: { name: string; description: string }, signal?: AbortSignal): Promise<TeamChatAgent> {
    return parseAgent(await this.request("/chat/agents", { method: "POST", body: JSON.stringify(input) }, signal));
  }

  async updateAgent(
    agentUserId: string,
    changes: { name?: string; description?: string; dailyLimit?: number; modelLabel?: string },
    signal?: AbortSignal
  ): Promise<TeamChatAgent> {
    return parseAgent(await this.request(agentPath(agentUserId), { method: "PATCH", body: JSON.stringify(changes) }, signal));
  }

  async setAgentDisabled(agentUserId: string, disabled: boolean, signal?: AbortSignal): Promise<TeamChatAgent> {
    return parseAgent(await this.request(`${agentPath(agentUserId)}/${disabled ? "disable" : "enable"}`, { method: "POST" }, signal));
  }

  async removeAgent(agentUserId: string, signal?: AbortSignal): Promise<void> {
    await this.request(agentPath(agentUserId), { method: "DELETE" }, signal);
  }

  /** Webhook bots (ADR 0005): names for labelling, management for channel managers. */
  async listBots(signal?: AbortSignal): Promise<TeamChatBot[]> {
    const value = asRecord(await this.request("/chat/bots", { method: "GET" }, signal));
    if (!Array.isArray(value.bots) || value.bots.length > 100) throw invalidResponse("bots");
    return value.bots.map((item, index) => {
      const bot = asRecord(item);
      return {
        userId: boundedString(bot.userId, `bots.${index}.userId`, 128),
        name: boundedString(bot.name, `bots.${index}.name`, 80),
        conversationId: boundedString(bot.conversationId, `bots.${index}.conversationId`, 128)
      };
    });
  }

  async listWebhooks(conversationId: string, signal?: AbortSignal): Promise<TeamChatWebhook[]> {
    const value = asRecord(await this.request(`${webhooksPath(conversationId)}`, { method: "GET" }, signal));
    if (!Array.isArray(value.webhooks) || value.webhooks.length > 10) throw invalidResponse("webhooks");
    return value.webhooks.map(parseWebhook);
  }

  async createWebhook(conversationId: string, name: string, signal?: AbortSignal): Promise<{ webhook: TeamChatWebhook; url: string }> {
    return parseWebhookSecret(await this.request(webhooksPath(conversationId), { method: "POST", body: JSON.stringify({ name }) }, signal));
  }

  async rotateWebhook(conversationId: string, botUserId: string, signal?: AbortSignal): Promise<{ webhook: TeamChatWebhook; url: string }> {
    return parseWebhookSecret(await this.request(`${webhooksPath(conversationId)}/${encodeURIComponent(botUserId)}/rotate`, { method: "POST" }, signal));
  }

  async removeWebhook(conversationId: string, botUserId: string, signal?: AbortSignal): Promise<void> {
    await this.request(`${webhooksPath(conversationId)}/${encodeURIComponent(botUserId)}`, { method: "DELETE" }, signal);
  }

  async pendingInvocations(signal?: AbortSignal): Promise<TeamChatAgentInvocation[]> {
    const value = asRecord(await this.request("/chat/agent-invocations", { method: "GET" }, signal));
    if (!Array.isArray(value.invocations) || value.invocations.length > MAX_PENDING) throw invalidResponse("invocations");
    return value.invocations.map(parseInvocation);
  }

  async claimInvocation(invocationId: string, signal?: AbortSignal): Promise<TeamChatAgentClaim> {
    const value = asRecord(await this.request(`${invocationPath(invocationId)}/claim`, { method: "POST" }, signal));
    const kind = value.conversationKind;
    if (kind !== "channel" && kind !== "dm") throw invalidResponse("claim.conversationKind");
    if (!Array.isArray(value.messages) || value.messages.length > MAX_CONTEXT) throw invalidResponse("claim.messages");
    const name = nullable(value.conversationName, (item) => boundedString(item, "claim.conversationName", 160));
    return {
      invocation: parseInvocation(value.invocation),
      leaseToken: boundedString(asRecord(value.invocation).leaseToken, "claim.leaseToken", 64),
      conversationKind: kind,
      ...(name === undefined ? {} : { conversationName: name }),
      messages: value.messages.map(parseMessage)
    };
  }

  async completeInvocation(
    invocationId: string,
    input: { clientKey: string; body: string; leaseToken: string },
    signal?: AbortSignal
  ): Promise<TeamChatMessage> {
    return parseMessage(await this.request(`${invocationPath(invocationId)}/complete`, { method: "POST", body: JSON.stringify(input) }, signal));
  }

  async failInvocation(invocationId: string, reason: TeamChatAgentFailure, leaseToken: string, signal?: AbortSignal): Promise<void> {
    await this.request(`${invocationPath(invocationId)}/fail`, { method: "POST", body: JSON.stringify({ reason, leaseToken }) }, signal);
  }
}

function webhooksPath(conversationId: string): string {
  return `/chat/conversations/${encodeURIComponent(conversationId)}/webhooks`;
}

function parseWebhook(value: unknown): TeamChatWebhook {
  const record = asRecord(value);
  const rotatedAt = nullable(record.rotatedAt, (item) => parseTimestamp(item, "webhook.rotatedAt"));
  const lastUsedAt = nullable(record.lastUsedAt, (item) => parseTimestamp(item, "webhook.lastUsedAt"));
  return {
    botUserId: boundedString(record.botUserId, "webhook.botUserId", 128),
    conversationId: boundedString(record.conversationId, "webhook.conversationId", 128),
    channelName: boundedString(record.channelName, "webhook.channelName", 160),
    name: boundedString(record.name, "webhook.name", 80),
    createdBy: boundedString(record.createdBy, "webhook.createdBy", 128),
    createdAt: parseTimestamp(record.createdAt, "webhook.createdAt"),
    ...(rotatedAt === undefined ? {} : { rotatedAt }),
    ...(lastUsedAt === undefined ? {} : { lastUsedAt })
  };
}

function parseWebhookSecret(value: unknown): { webhook: TeamChatWebhook; url: string } {
  const record = asRecord(value);
  const url = boundedString(record.url, "webhook.url", 512);
  if (!/^https?:\/\/\S+\/v1\/hooks\/chat\//u.test(url)) throw invalidResponse("webhook.url");
  return { webhook: parseWebhook(record.webhook), url };
}

function agentPath(agentUserId: string): string {
  return `/chat/agents/${encodeURIComponent(agentUserId)}`;
}

function invocationPath(invocationId: string): string {
  return `/chat/agent-invocations/${encodeURIComponent(invocationId)}`;
}

function parseAgent(value: unknown): TeamChatAgent {
  const record = asRecord(value);
  if (record.status !== "active" && record.status !== "disabled") throw invalidResponse("agent.status");
  if (typeof record.disabledByAdmin !== "boolean" || typeof record.online !== "boolean") throw invalidResponse("agent.flags");
  const text = (field: string, maximum: number) => {
    const item = record[field];
    if (typeof item !== "string" || item.length > maximum * 2) throw invalidResponse(`agent.${field}`);
    return item;
  };
  return {
    userId: boundedString(record.userId, "agent.userId", 128),
    name: boundedString(record.name, "agent.name", 80),
    description: text("description", 280),
    ownerUserId: boundedString(record.ownerUserId, "agent.ownerUserId", 128),
    modelLabel: text("modelLabel", 120),
    dailyLimit: boundedInteger(record.dailyLimit, "agent.dailyLimit", 1, 500),
    status: record.status,
    disabledByAdmin: record.disabledByAdmin,
    online: record.online,
    createdAt: parseTimestamp(record.createdAt, "agent.createdAt")
  };
}

function parseInvocation(value: unknown): TeamChatAgentInvocation {
  const record = asRecord(value);
  return {
    id: boundedString(record.id, "invocation.id", 128),
    agentUserId: boundedString(record.agentUserId, "invocation.agentUserId", 128),
    conversationId: boundedString(record.conversationId, "invocation.conversationId", 128),
    messageId: boundedString(record.messageId, "invocation.messageId", 128),
    messageSeq: boundedInteger(record.messageSeq, "invocation.messageSeq", 1),
    invokerUserId: boundedString(record.invokerUserId, "invocation.invokerUserId", 128),
    expiresAt: parseTimestamp(record.expiresAt, "invocation.expiresAt")
  };
}
