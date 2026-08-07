import type {
  ExtensionPackageListResult,
  ExtensionPackageMutationResult,
  ExtensionPackageUpdatesResult
} from "@pi67/domain";
import { HostCommandError } from "./protocol-error.js";

export function parsePackageWorkerMutationResult(value: unknown): ExtensionPackageMutationResult {
  if (!isRecord(value) || typeof value.changed !== "boolean") throw invalidPackageWorkerResult();
  const list = parsePackageWorkerListResult(value);
  return { ...list, changed: value.changed };
}

export function parsePackageWorkerUpdatesResult(value: unknown): ExtensionPackageUpdatesResult {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 512) {
    throw invalidPackageWorkerResult();
  }
  const items = value.items.map((item) => {
    if (
      !isRecord(item)
      || !isBoundedString(item.source, 4_096)
      || (item.scope !== "global" && item.scope !== "project")
      || (item.type !== "npm" && item.type !== "git")
      || !isBoundedString(item.displayName, 512)
    ) throw invalidPackageWorkerResult();
    return {
      source: item.source,
      scope: item.scope as "global" | "project",
      type: item.type as "npm" | "git",
      displayName: item.displayName
    };
  });
  if (!Number.isSafeInteger(value.total) || value.total !== items.length) throw invalidPackageWorkerResult();
  return { items, total: items.length };
}

export function invalidPackageWorkerResult(): HostCommandError {
  return new HostCommandError(
    "INTERNAL",
    "The isolated Pi package worker returned an invalid result.",
    true
  );
}

function parsePackageWorkerListResult(value: Record<string, unknown>): ExtensionPackageListResult {
  if (!Array.isArray(value.items) || value.items.length > 512) throw invalidPackageWorkerResult();
  const items = value.items.map((item) => {
    if (
      !isRecord(item)
      || !isBoundedString(item.source, 4_096)
      || (item.scope !== "global" && item.scope !== "project")
      || typeof item.enabled !== "boolean"
      || typeof item.filtered !== "boolean"
      || typeof item.installed !== "boolean"
      || !isPackageTrustState(item.trustState)
    ) throw invalidPackageWorkerResult();
    return {
      source: item.source,
      scope: item.scope as "global" | "project",
      enabled: item.enabled,
      filtered: item.filtered,
      installed: item.installed,
      trustState: item.trustState
    };
  });
  if (!Number.isSafeInteger(value.total) || value.total !== items.length) throw invalidPackageWorkerResult();
  return { items, total: items.length };
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPackageTrustState(value: unknown): value is ExtensionPackageListResult["items"][number]["trustState"] {
  return value === "builtin-verified"
    || value === "user-installed-observed"
    || value === "unverified"
    || value === "drifted"
    || value === "unavailable";
}
