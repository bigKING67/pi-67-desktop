import type { TeamChatWorkCard, TeamChatWorkCardRef } from "@pi67/domain";
import {
  asRecord,
  boundedInteger,
  boundedString,
  invalidResponse,
  parseTimestamp
} from "../context/enterprise-context-gateway-validation.js";

const WORK_CARD_STATUSES = new Set(["todo", "in_progress", "in_review", "done", "closed"]);
const WORK_CARD_REF_KINDS = new Set(["repository", "branch", "pull_request", "link"]);

export function parseWorkCard(value: unknown): TeamChatWorkCard {
  const record = asRecord(value);
  if (typeof record.status !== "string" || !WORK_CARD_STATUSES.has(record.status)) throw invalidResponse("workCard.status");
  if (!Array.isArray(record.refs) || record.refs.length > 10) throw invalidResponse("workCard.refs");
  const text = (field: string, maximum: number) => {
    const item = record[field];
    if (typeof item !== "string" || item.length > maximum * 2) throw invalidResponse(`workCard.${field}`);
    return item;
  };
  const assigneeUserId = nullable(record.assigneeUserId, (item) => boundedString(item, "workCard.assigneeUserId", 128));
  const claimedBy = nullable(record.claimedBy, (item) => boundedString(item, "workCard.claimedBy", 128));
  return {
    id: boundedString(record.id, "workCard.id", 128),
    conversationId: boundedString(record.conversationId, "workCard.conversationId", 128),
    createdBy: boundedString(record.createdBy, "workCard.createdBy", 128),
    ...(assigneeUserId === undefined ? {} : { assigneeUserId }),
    ...(claimedBy === undefined ? {} : { claimedBy }),
    title: boundedString(record.title, "workCard.title", 320),
    goal: text("goal", 4_000),
    acceptance: text("acceptance", 4_000),
    summary: text("summary", 8_000),
    refs: record.refs.map((item, index) => {
      const ref = asRecord(item);
      if (typeof ref.kind !== "string" || !WORK_CARD_REF_KINDS.has(ref.kind)) throw invalidResponse(`workCard.refs.${index}.kind`);
      const url = nullable(ref.url, (candidate) => {
        const checked = boundedString(candidate, `workCard.refs.${index}.url`);
        if (!checked.startsWith("https://")) throw invalidResponse(`workCard.refs.${index}.url`);
        return checked;
      });
      return {
        kind: ref.kind as TeamChatWorkCardRef["kind"],
        label: boundedString(ref.label, `workCard.refs.${index}.label`, 400),
        ...(url === undefined ? {} : { url })
      };
    }),
    status: record.status as TeamChatWorkCard["status"],
    revision: boundedInteger(record.revision, "workCard.revision", 1),
    createdAt: parseTimestamp(record.createdAt, "workCard.createdAt"),
    updatedAt: parseTimestamp(record.updatedAt, "workCard.updatedAt")
  };
}

function nullable<T>(value: unknown, parse: (item: unknown) => T): T | undefined {
  return value === null || value === undefined ? undefined : parse(value);
}
