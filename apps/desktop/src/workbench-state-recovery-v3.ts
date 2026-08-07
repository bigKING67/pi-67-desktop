import { isAbsolute } from "node:path";
import { isTaskLifecycle } from "./workbench-state-lifecycle.js";
import { MAX_WORKSPACE_PATH_LENGTH } from "./workspace-identity.js";
import type { RuntimeRecoveryRecord, SessionConversationKey } from "./workbench-state-types.js";

const MAX_TASK_ID_LENGTH = 200;
const MAX_SESSION_ID_LENGTH = 1_024;
export function parseRuntimeRecoveryV3(
  value: unknown,
  workspaceIds: ReadonlySet<string>,
  maximumRecords: number
): RuntimeRecoveryRecord[] | undefined {
  if (!Array.isArray(value) || value.length > maximumRecords) return undefined;
  const records: RuntimeRecoveryRecord[] = [];
  const taskIds = new Set<string>();
  const conversationIds = new Set<string>();
  for (const candidate of value) {
    if (!isRecordWithAllowedKeys(
      candidate,
      [
        "taskId",
        "conversation",
        "sessionId",
        "taskGeneration",
        "sessionGeneration",
        "hostInstanceId",
        "hostEpoch",
        "lastKnownLifecycle"
      ]
    )) return undefined;
    const conversation = parseSessionConversationKey(candidate.conversation, workspaceIds);
    if (
      !conversation
      || !isBoundedId(candidate.taskId, MAX_TASK_ID_LENGTH)
      || !isBoundedId(candidate.sessionId, MAX_SESSION_ID_LENGTH)
      || !Number.isSafeInteger(candidate.taskGeneration)
      || Number(candidate.taskGeneration) < 1
      || !Number.isSafeInteger(candidate.sessionGeneration)
      || Number(candidate.sessionGeneration) < 1
      || !isBoundedId(candidate.hostInstanceId, MAX_SESSION_ID_LENGTH)
      || !Number.isSafeInteger(candidate.hostEpoch)
      || Number(candidate.hostEpoch) < 0
      || !isTaskLifecycle(candidate.lastKnownLifecycle)
    ) return undefined;
    const identity = conversationIdentity(conversation);
    if (taskIds.has(candidate.taskId) || conversationIds.has(identity)) return undefined;
    taskIds.add(candidate.taskId);
    conversationIds.add(identity);
    records.push({
      taskId: candidate.taskId,
      conversation,
      sessionId: candidate.sessionId,
      taskGeneration: Number(candidate.taskGeneration),
      sessionGeneration: Number(candidate.sessionGeneration),
      hostInstanceId: candidate.hostInstanceId,
      hostEpoch: Number(candidate.hostEpoch),
      lastKnownLifecycle: candidate.lastKnownLifecycle
    });
  }
  return records;
}

function parseSessionConversationKey(
  value: unknown,
  workspaceIds: ReadonlySet<string>
): SessionConversationKey | undefined {
  if (
    !isRecordWithAllowedKeys(value, ["kind", "workspaceId", "sessionFileIdentity", "sessionPath"])
    || value.kind !== "session"
    || !isKnownWorkspaceId(value.workspaceId, workspaceIds)
    || !isBoundedSessionFileIdentity(value.sessionFileIdentity)
    || !isAbsoluteBoundedPath(value.sessionPath)
  ) return undefined;
  return {
    kind: "session",
    workspaceId: value.workspaceId,
    sessionFileIdentity: value.sessionFileIdentity,
    sessionPath: value.sessionPath
  };
}

function conversationIdentity(conversation: SessionConversationKey): string {
  return `session:${conversation.workspaceId}:${conversation.sessionFileIdentity}`;
}

function isBoundedSessionFileIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_WORKSPACE_PATH_LENGTH + 64;
}

function isKnownWorkspaceId(value: unknown, workspaceIds: ReadonlySet<string>): value is string {
  return typeof value === "string" && workspaceIds.has(value);
}

function isAbsoluteBoundedPath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_WORKSPACE_PATH_LENGTH
    && isAbsolute(value);
}

function isBoundedId(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function isRecordWithAllowedKeys(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, keys);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
