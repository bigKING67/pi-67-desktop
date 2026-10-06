import {
  TEAM_CHAT_ATTACHMENT_LIMITS,
  TEAM_CHAT_MENTION_MAX,
  type TeamChatAgentInvocationSummary,
  type TeamChatAttachment,
  type TeamChatMessage
} from "@pi67/domain";
import {
  asRecord,
  boundedInteger,
  boundedString,
  invalidResponse,
  parseTimestamp
} from "../context/enterprise-context-gateway-validation.js";
import { parseWorkCard } from "./team-chat-work-card-parse.js";

const INVOCATION_STATUSES = new Set(["queued", "running", "replied", "failed", "expired", "rejected"]);
const INVOCATION_REASONS = new Set(["daily_limit", "agent_disabled", "not_configured", "model_unavailable",
  "runtime_error", "lease_expired", "cancelled"]);

export function parseMessage(value: unknown): TeamChatMessage {
  const record = asRecord(value);
  const workCard = nullable(record.workCard, parseWorkCard);
  const mentions = nullable(record.mentionUserIds, (item) => {
    if (!Array.isArray(item) || item.length > TEAM_CHAT_MENTION_MAX) throw invalidResponse("message.mentionUserIds");
    return item.map((userId, index) => boundedString(userId, `message.mentionUserIds.${index}`, 128));
  });
  const attachments = nullable(record.attachments, (item) => {
    if (!Array.isArray(item) || item.length > TEAM_CHAT_ATTACHMENT_LIMITS.perMessage) throw invalidResponse("message.attachments");
    return item.map(parseAttachment);
  });
  const editedAt = nullable(record.editedAt, (item) => parseTimestamp(item, "message.editedAt"));
  const recalledAt = nullable(record.recalledAt, (item) => parseTimestamp(item, "message.recalledAt"));
  const recalledBy = nullable(record.recalledBy, (item) => boundedString(item, "message.recalledBy", 128));
  // Only a recalled message, or one carrying files, has an empty body.
  const emptyAllowed = recalledAt !== undefined || (attachments?.length ?? 0) > 0;
  if (recalledAt !== undefined ? record.body !== "" : typeof record.body !== "string" || (record.body.length === 0 && !emptyAllowed)) {
    throw invalidResponse("message.body");
  }
  const invocations = nullable(record.agentInvocations, (item) => {
    if (!Array.isArray(item) || item.length > TEAM_CHAT_MENTION_MAX) throw invalidResponse("message.agentInvocations");
    return item.map(parseInvocationSummary);
  });
  return {
    ...(workCard === undefined ? {} : { workCard }),
    ...(mentions === undefined || mentions.length === 0 ? {} : { mentionUserIds: mentions }),
    ...(invocations === undefined || invocations.length === 0 ? {} : { agentInvocations: invocations }),
    id: boundedString(record.id, "message.id", 128),
    conversationId: boundedString(record.conversationId, "message.conversationId", 128),
    seq: boundedInteger(record.seq, "message.seq", 1),
    senderUserId: boundedString(record.senderUserId, "message.senderUserId", 128),
    body: recalledAt !== undefined || record.body === "" ? "" : boundedString(record.body, "message.body", 8_000),
    ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }),
    ...(editedAt === undefined ? {} : { editedAt }),
    ...(recalledAt === undefined ? {} : { recalledAt }),
    ...(recalledBy === undefined ? {} : { recalledBy }),
    clientKey: boundedString(record.clientKey, "message.clientKey", 64),
    createdAt: parseTimestamp(record.createdAt, "message.createdAt")
  };
}

export function parseInvocationSummary(value: unknown): TeamChatAgentInvocationSummary {
  const record = asRecord(value);
  if (typeof record.status !== "string" || !INVOCATION_STATUSES.has(record.status)) throw invalidResponse("invocation.status");
  const reason = nullable(record.reason, (item) => {
    if (typeof item !== "string" || !INVOCATION_REASONS.has(item)) throw invalidResponse("invocation.reason");
    return item as NonNullable<TeamChatAgentInvocationSummary["reason"]>;
  });
  return {
    id: boundedString(record.id, "invocation.id", 128),
    agentUserId: boundedString(record.agentUserId, "invocation.agentUserId", 128),
    status: record.status as TeamChatAgentInvocationSummary["status"],
    ...(reason === undefined ? {} : { reason })
  };
}

export function parseAttachment(value: unknown): TeamChatAttachment {
  const record = asRecord(value);
  const dimension = (name: "width" | "height") => nullable(record[name], (item) => boundedInteger(item, `attachment.${name}`, 1, 20_000));
  const width = dimension("width");
  const height = dimension("height");
  return {
    id: boundedString(record.id, "attachment.id", 128),
    fileName: boundedString(record.fileName, "attachment.fileName", 400),
    contentType: boundedString(record.contentType, "attachment.contentType", 120),
    byteSize: boundedInteger(record.byteSize, "attachment.byteSize", 1, TEAM_CHAT_ATTACHMENT_LIMITS.bytes),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height })
  };
}

function nullable<T>(value: unknown, parse: (item: unknown) => T): T | undefined {
  return value === null || value === undefined ? undefined : parse(value);
}
