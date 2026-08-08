import { isAbsolute } from "node:path";
import {
  MAX_WORKSPACE_ID_LENGTH,
  MAX_WORKSPACE_PATH_LENGTH
} from "./workspace-identity.js";

export function isKnownWorkspaceId(value: unknown, workspaceIds: ReadonlySet<string>): value is string {
  return isBoundedId(value, MAX_WORKSPACE_ID_LENGTH) && workspaceIds.has(value);
}

export function isAbsoluteBoundedPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_WORKSPACE_PATH_LENGTH
    && !value.includes("\0") && isAbsolute(value);
}

export function isBoundedSessionFileIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_WORKSPACE_PATH_LENGTH + 64;
}

export function isBoundedId(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && !value.includes("\0") && /^[A-Za-z0-9._:-]+$/u.test(value);
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRecordWithAllowedKeys(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.every((key) => allowedKeys.includes(key))
    && requiredKeys.every((key) => Object.hasOwn(value, key));
}
