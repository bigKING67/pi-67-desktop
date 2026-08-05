import { MAX_SESSION_CREATION_ID_CHARS } from "@pi67/protocol";

const MAX_SESSION_CREATION_RECOVERY_RECORDS = 32;

export interface SessionCreationRecoveryRecord {
  taskId: string;
  workspaceId: string;
  creationId: string;
  taskGeneration: number;
}

export function parseSessionCreationRecovery(
  value: unknown,
  workspaceIds: ReadonlySet<string>,
  maximumTaskIdLength: number
): SessionCreationRecoveryRecord[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_SESSION_CREATION_RECOVERY_RECORDS) {
    return undefined;
  }
  const records: SessionCreationRecoveryRecord[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate)
      || !hasExactKeys(candidate, ["taskId", "workspaceId", "creationId", "taskGeneration"])
      || !isBoundedId(candidate.taskId, maximumTaskIdLength)
      || typeof candidate.workspaceId !== "string"
      || !workspaceIds.has(candidate.workspaceId)
      || typeof candidate.creationId !== "string"
      || candidate.creationId.length > MAX_SESSION_CREATION_ID_CHARS
      || !/^[A-Za-z0-9_-]+$/u.test(candidate.creationId)
      || !Number.isSafeInteger(candidate.taskGeneration)
      || Number(candidate.taskGeneration) < 1
      || records.some((record) => (
        record.taskId === candidate.taskId || record.creationId === candidate.creationId
      ))
    ) return undefined;
    records.push({
      taskId: candidate.taskId,
      workspaceId: candidate.workspaceId,
      creationId: candidate.creationId,
      taskGeneration: Number(candidate.taskGeneration)
    });
  }
  return records;
}

function isBoundedId(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
