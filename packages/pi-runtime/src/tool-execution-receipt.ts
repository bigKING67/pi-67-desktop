import {
  MAX_TOOL_CALL_ID_CHARS,
  MAX_TOOL_EXECUTION_RECEIPT_ITEMS,
  MAX_TOOL_NAME_CHARS
} from "@pi67/domain";

export const TOOL_EXECUTION_RECEIPT_TYPE = "pi67.tool-executions.v1";

export type ToolExecutionReceiptStatus = "completed" | "failed" | "interrupted" | "cancelled";

export interface ToolExecutionReceiptItem {
  toolCallId: string;
  toolName: string;
  startedAt?: number;
  completedAt: number;
  status: ToolExecutionReceiptStatus;
}

export interface ToolExecutionReceiptData {
  items: ToolExecutionReceiptItem[];
  omittedCount?: number;
}

export function parseToolExecutionReceipt(value: unknown): ToolExecutionReceiptData | undefined {
  const record = asRecord(value);
  if (
    !hasOnlyKeys(record, ["items", "omittedCount"])
    || !Array.isArray(record.items)
    || record.items.length === 0
    || record.items.length > MAX_TOOL_EXECUTION_RECEIPT_ITEMS
  ) return undefined;
  const items: ToolExecutionReceiptItem[] = [];
  const seenIds = new Set<string>();
  for (const candidate of record.items) {
    const item = parseReceiptItem(candidate);
    if (!item || seenIds.has(item.toolCallId)) return undefined;
    seenIds.add(item.toolCallId);
    items.push(item);
  }
  const omittedCount = nonNegativeInteger(record.omittedCount);
  if (record.omittedCount !== undefined && omittedCount === undefined) return undefined;
  return {
    items,
    ...(omittedCount === undefined || omittedCount === 0 ? {} : { omittedCount })
  };
}

function parseReceiptItem(value: unknown): ToolExecutionReceiptItem | undefined {
  const record = asRecord(value);
  if (!hasOnlyKeys(record, ["toolCallId", "toolName", "startedAt", "completedAt", "status"])) return undefined;
  const toolCallId = boundedString(record.toolCallId, MAX_TOOL_CALL_ID_CHARS);
  const toolName = boundedString(record.toolName, MAX_TOOL_NAME_CHARS);
  const startedAt = nonNegativeInteger(record.startedAt);
  const completedAt = nonNegativeInteger(record.completedAt);
  const status = receiptStatus(record.status);
  if (
    toolCallId === undefined
    || toolName === undefined
    || completedAt === undefined
    || status === undefined
    || (record.startedAt !== undefined && startedAt === undefined)
    || (startedAt !== undefined && completedAt < startedAt)
  ) return undefined;
  return {
    toolCallId,
    toolName,
    ...(startedAt === undefined ? {} : { startedAt }),
    completedAt,
    status
  };
}

function receiptStatus(value: unknown): ToolExecutionReceiptStatus | undefined {
  return value === "completed" || value === "failed" || value === "interrupted" || value === "cancelled"
    ? value
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return undefined;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return undefined;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(record).every((key) => allowedKeys.has(key));
}
