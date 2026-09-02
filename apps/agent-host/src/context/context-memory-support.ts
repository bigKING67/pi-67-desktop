import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveContextOwner,
  type ContextMemoryConfiguration,
  type ContextRuntimeStatus,
  type MemoryEntrySummary,
  type MemoryScope
} from "@pi67/domain";
import { HostCommandError } from "../protocol-error.js";
import type { OpenVikingSearchResult } from "./openviking-client.js";

export function contextStatusResult(
  configuration: ContextMemoryConfiguration,
  conflicts: string[],
  health: ContextRuntimeStatus["health"]
): ContextRuntimeStatus {
  return {
    provider: "openviking",
    health,
    owner: resolveContextOwner({
      openVikingEnabled: configuration.enabled,
      openVikingAvailable: health === "healthy",
      conflictingOwners: conflicts
    }),
    effectivePrivacyMode: configuration.defaultPrivacyMode,
    endpoint: configuration.endpoint,
    configured: configuration.enabled,
    conflictExtensions: conflicts,
    lastCheckedAt: Date.now()
  };
}

export function appContextAuthority() {
  return { runtime: undefined, operations: undefined, context: { scope: "app" as const } };
}

export function deriveWorkspacePeerId(cwd: string): string {
  return workspaceFingerprint(cwd);
}

export function memorySummary(
  value: OpenVikingSearchResult,
  scope: MemoryScope,
  workspaceId: string
): MemoryEntrySummary {
  return {
    id: value.uri,
    title: titleForUri(value.uri),
    summary: value.abstract || value.overview || "",
    scope,
    createdAt: 0,
    updatedAt: 0,
    ...(scope === "workspace" ? { workspaceId } : {})
  };
}

export function titleForUri(uri: string): string {
  const value = uri.split("/").filter(Boolean).at(-1) ?? "Memory";
  try {
    return decodeURIComponent(value).replace(/[-_]+/g, " ");
  } catch {
    return value.replace(/[-_]+/g, " ");
  }
}

export function assertPrivateMemoryUri(uri: string): void {
  if (!isPrivateMemoryUri(uri)) {
    throw new HostCommandError("INVALID_PAYLOAD", "Only private user memories can be read or forgotten here.", false);
  }
}

export function isPrivateMemoryUri(uri: string): boolean {
  return /^viking:\/\/user\/memories\/.+/.test(uri)
    || /^viking:\/\/user\/[^/?#]+\/memories\/.+/.test(uri)
    || /^viking:\/\/user\/[^/?#]+\/peers\/[a-f0-9]{64}\/memories\/.+/.test(uri);
}

export function memoryScopeForUri(uri: string): "user" | "workspace" {
  return /\/peers\/[a-f0-9]{64}\/memories\//.test(uri) ? "workspace" : "user";
}

function workspaceFingerprint(cwd: string): string {
  let canonicalCwd = resolve(cwd);
  try {
    canonicalCwd = realpathSync.native(canonicalCwd);
  } catch {
    // A not-yet-created workspace still receives a deterministic identity.
  }
  if (process.platform === "win32") canonicalCwd = canonicalCwd.toLowerCase();
  return createHash("sha256").update(canonicalCwd).digest("hex");
}
