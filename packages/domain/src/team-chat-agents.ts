import type { TeamChatDirectory } from "./team-chat.js";

/** Agent members (ADR 0004, P3a). New Money routes requests; the owner's Desktop runs them. */
export const TEAM_CHAT_AGENT_LIMITS = { name: 40, description: 280, dailyLimit: 500, perOwner: 5 } as const;

export interface TeamChatAgent {
  /** The Agent's principal id: a conversation member, mention target and message sender. */
  userId: string;
  name: string;
  description: string;
  ownerUserId: string;
  /** Provider and model its owner's Desktop uses, shown before anyone asks it. */
  modelLabel: string;
  dailyLimit: number;
  status: "active" | "disabled";
  /** Disabled by a team owner/admin; only they can enable it again. */
  disabledByAdmin: boolean;
  /** The owner's Desktop is connected and hosting it. */
  online: boolean;
  createdAt: number;
}

export type TeamChatAgentInvocationStatus = "queued" | "running" | "replied" | "failed" | "expired" | "rejected";
export type TeamChatAgentInvocationReason =
  | "daily_limit" | "agent_disabled" | "not_configured" | "model_unavailable"
  | "runtime_error" | "lease_expired" | "cancelled";

/** One Agent request carried on the message that made it. */
export interface TeamChatAgentInvocationSummary {
  id: string;
  agentUserId: string;
  status: TeamChatAgentInvocationStatus;
  reason?: TeamChatAgentInvocationReason;
}

/**
 * This Desktop's binding for an Agent its user owns: where its team-scoped Sessions
 * live (Workspace + team project, so the owner can review them) and which model runs.
 */
export interface TeamChatAgentBinding {
  agentUserId: string;
  workspaceId: string;
  projectId: string;
  model: { provider: string; id: string };
  enabled: boolean;
}

/** Last outcome of a request this Desktop ran, for the owner's settings view. */
export interface TeamChatAgentActivity {
  agentUserId: string;
  invocationId: string;
  state: "running" | "replied" | "failed";
  reason?: TeamChatAgentInvocationReason;
  at: number;
}

/** Viewers never add Agents; the team policy may restrict it to owners/admins. */
export function teamChatCanCreateAgent(directory: TeamChatDirectory): boolean {
  const role = directory.members.find((member) => member.userId === directory.selfUserId)?.role;
  if (role === undefined || role === "viewer") return false;
  return directory.policy.agentCreation === "members" || role === "owner" || role === "admin";
}

export function teamChatAgentById(directory: TeamChatDirectory | undefined, userId: string | undefined): TeamChatAgent | undefined {
  if (!directory || userId === undefined) return undefined;
  return directory.agents.find((agent) => agent.userId === userId);
}

/** An incoming webhook bot (ADR 0005): posts into one channel, never reads. */
export interface TeamChatBot {
  userId: string;
  name: string;
  conversationId: string;
}

/** Webhook metadata for channel managers; the secret URL is never part of it. */
export interface TeamChatWebhook {
  botUserId: string;
  conversationId: string;
  channelName: string;
  name: string;
  createdBy: string;
  createdAt: number;
  rotatedAt?: number;
  lastUsedAt?: number;
}

export const TEAM_CHAT_WEBHOOK_NAME_MAX = 40;
