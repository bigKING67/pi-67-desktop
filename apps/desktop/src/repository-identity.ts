import { createHash } from "node:crypto";
import { realpath } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceDescriptor } from "@pi67/protocol";

const realpathNative = promisify(realpath.native);

export interface PhysicalDirectoryIdentity {
  canonicalPath: string;
  device?: string;
  inode?: string;
  birthtimeNs?: string;
  assurance: "filesystem" | "path-only";
}

export async function observePhysicalDirectoryIdentity(path: string): Promise<PhysicalDirectoryIdentity> {
  const canonicalPath = await realpathNative(path);
  if (!isAbsolute(canonicalPath) || canonicalPath.length === 0 || canonicalPath.length > 32_768) {
    throw new Error("Physical directory path is invalid.");
  }
  const metadata = await stat(canonicalPath, { bigint: true });
  if (!metadata.isDirectory()) throw new Error("Physical identity target must be a directory.");
  const hasFilesystemIdentity = metadata.dev !== 0n && metadata.ino !== 0n;
  return {
    canonicalPath,
    ...(hasFilesystemIdentity ? {
      device: metadata.dev.toString(10),
      inode: metadata.ino.toString(10),
      birthtimeNs: metadata.birthtimeNs.toString(10)
    } : {}),
    assurance: hasFilesystemIdentity ? "filesystem" : "path-only"
  };
}

export function repositoryGroupId(identity: PhysicalDirectoryIdentity): string {
  return `repo_${identityDigest(identity).slice(0, 32)}`;
}

export function worktreeProjectionId(identity: PhysicalDirectoryIdentity): string {
  return `wt_${identityDigest(identity).slice(0, 32)}`;
}

export function workspaceIdentityFingerprint(workspace: WorkspaceDescriptor): string {
  return createHash("sha256").update(workspaceIdentityKey(workspace)).digest("hex");
}

export function physicalDirectoryIdentitiesMatch(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (left.assurance === "filesystem" && right.assurance === "filesystem") {
    return left.device === right.device
      && left.inode === right.inode
      && left.birthtimeNs === right.birthtimeNs;
  }
  return normalizePath(left.canonicalPath, platform) === normalizePath(right.canonicalPath, platform);
}

export function workspaceMatchesPhysicalDirectory(
  workspace: WorkspaceDescriptor,
  identity: PhysicalDirectoryIdentity,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (workspace.identity.assurance === "filesystem" && identity.assurance === "filesystem") {
    return workspace.identity.device === identity.device
      && workspace.identity.inode === identity.inode
      && workspace.identity.birthtimeNs === identity.birthtimeNs;
  }
  return normalizePath(workspace.identity.canonicalPath, platform)
    === normalizePath(identity.canonicalPath, platform);
}

function identityDigest(identity: PhysicalDirectoryIdentity): string {
  return createHash("sha256").update(physicalIdentityKey(identity)).digest("hex");
}

function physicalIdentityKey(identity: PhysicalDirectoryIdentity): string {
  return identity.assurance === "filesystem"
    ? `filesystem:${identity.device ?? ""}:${identity.inode ?? ""}:${identity.birthtimeNs ?? ""}`
    : `path:${normalizePath(identity.canonicalPath, process.platform)}`;
}

function workspaceIdentityKey(workspace: WorkspaceDescriptor): string {
  const identity = workspace.identity;
  return identity.assurance === "filesystem"
    ? `filesystem:${identity.device ?? ""}:${identity.inode ?? ""}:${identity.birthtimeNs ?? ""}`
    : `path:${normalizePath(identity.canonicalPath, process.platform)}`;
}

function normalizePath(path: string, platform: NodeJS.Platform): string {
  const normalized = path.replace(/[\\/]+$/u, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}
