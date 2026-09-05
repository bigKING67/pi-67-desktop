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
    || /^viking:\/\/user\/peers\/[a-f0-9]{64}\/memories\/.+/.test(uri)
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

export interface PendingForget {
  uri: string;
  entry: MemoryEntrySummary;
  workspaceId: string;
  actorPeerId: string;
  userId?: string;
  expiresAt: number;
}

export function assertAuthorizedPrivateMemoryUri(uri: string, actorPeerId: string, currentUser?: string): void {
  assertPrivateMemoryUri(uri);
  let parsed: URL;
  try { parsed = new URL(uri); } catch {
    throw new HostCommandError("INVALID_PAYLOAD", "Private Memory URI must be canonical.", false);
  }
  if (parsed.pathname !== uri.slice("viking://user".length) || parsed.protocol !== "viking:" || parsed.hostname !== "user" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new HostCommandError("INVALID_PAYLOAD", "Private Memory URI must be canonical.", false);
  }
  const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch {
      throw new HostCommandError("INVALID_PAYLOAD", "Private Memory URI must be canonical.", false);
    }
    if (!decoded || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      throw new HostCommandError("INVALID_PAYLOAD", "Private Memory URI must be canonical.", false);
    }
    return decoded;
  });
  const global = segments[0] === "memories" && segments.length > 1;
  const ownGlobal = segments[0] === currentUser && segments[1] === "memories";
  const peerOffset = segments[0] === "peers" ? 0 : segments[1] === "peers" && segments[0] === currentUser ? 1 : -1;
  const currentPeer = peerOffset >= 0
    && segments[peerOffset + 1] === actorPeerId
    && segments[peerOffset + 2] === "memories"
    && segments.length > peerOffset + 3;
  if (global || ownGlobal || currentPeer) return;
  throw new HostCommandError("INVALID_PAYLOAD", "Private Memory URI is outside the current user or Workspace peer scope.", false);
}
