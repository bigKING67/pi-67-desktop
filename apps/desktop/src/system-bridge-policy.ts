import type { NativeNotificationRequest } from "@pi67/protocol";

const NATIVE_NOTIFICATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;

export function asNativeNotificationRequest(value: unknown): NativeNotificationRequest | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 4) return undefined;
  const notificationId = asNativeNotificationId(value.notificationId);
  if (!notificationId) return undefined;
  if (value.kind !== "completed" && value.kind !== "failed" && value.kind !== "attention") {
    return undefined;
  }
  if (
    typeof value.workspaceId !== "string"
    || value.workspaceId.length === 0
    || value.workspaceId.length > 200
    || !WORKSPACE_ID_PATTERN.test(value.workspaceId)
  ) return undefined;
  if (
    typeof value.sessionFileIdentity !== "string"
    || value.sessionFileIdentity.length === 0
    || value.sessionFileIdentity.length > 2_048
  ) return undefined;
  return {
    notificationId,
    kind: value.kind,
    workspaceId: value.workspaceId,
    sessionFileIdentity: value.sessionFileIdentity
  };
}

export function asNativeNotificationId(value: unknown): string | undefined {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 200
    && NATIVE_NOTIFICATION_ID_PATTERN.test(value)
    ? value
    : undefined;
}

export function asExternalUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return undefined;
  try {
    const target = new URL(value);
    if ((target.protocol !== "http:" && target.protocol !== "https:")
      || target.hostname === "" || target.username !== "" || target.password !== "") return undefined;
    return target;
  } catch {
    return undefined;
  }
}

export function assertWorkspaceId(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 200
    || !WORKSPACE_ID_PATTERN.test(value)
  ) throw new Error("Workspace id is invalid.");
  return value;
}

export function assertWorkspaceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Workspace order is invalid.");
  return value.map(assertWorkspaceId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
