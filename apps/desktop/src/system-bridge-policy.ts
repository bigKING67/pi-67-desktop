import {
  isNativeNotificationId,
  isNativeNotificationRequest,
  isWorkspaceId,
  type NativeNotificationRequest
} from "@pi67/protocol";

export function asNativeNotificationRequest(value: unknown): NativeNotificationRequest | undefined {
  return isNativeNotificationRequest(value) ? value : undefined;
}

export function asNativeNotificationId(value: unknown): string | undefined {
  return isNativeNotificationId(value) ? value : undefined;
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
  if (!isWorkspaceId(value)) throw new Error("Workspace id is invalid.");
  return value;
}

export function assertWorkspaceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Workspace order is invalid.");
  return value.map(assertWorkspaceId);
}
