import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";

const realpathNative = promisify(realpath.native);

export const MAX_WORKSPACE_ID_LENGTH = 200;
export const MAX_WORKSPACE_PATH_LENGTH = 32_768;
const MAX_WORKSPACE_DISPLAY_NAME_LENGTH = 1_024;

export interface WorkspacePathIdentity {
  canonicalPath: string;
  /** Decimal bigint values remain lossless across JSON and Electron IPC. */
  device?: string;
  inode?: string;
  birthtimeNs?: string;
  assurance: "filesystem" | "path-only";
}

export interface WorkspaceDescriptor {
  id: string;
  displayName: string;
  identity: WorkspacePathIdentity;
  lastVerifiedAt?: number;
  trust: "unknown" | "trusted" | "untrusted";
  trustProvenance: "native-picker" | "user-confirmed" | "restored" | "identity-changed" | "indirect";
  availability: "available" | "missing" | "identity-changed" | "needs-confirmation" | "unavailable";
}

export interface NativeWorkspaceDescriptor extends WorkspaceDescriptor {
  identity: WorkspacePathIdentity & {
    device: string;
    inode: string;
    birthtimeNs: string;
  };
  lastVerifiedAt: number;
  trust: "trusted";
  trustProvenance: "native-picker";
  availability: "available";
}

export interface WorkspaceIdentityOptions {
  createId?: () => string;
  now?: () => number;
}

export async function refreshPersistedWorkspaceDescriptor(
  existing: WorkspaceDescriptor
): Promise<WorkspaceDescriptor> {
  let observed: NativeWorkspaceDescriptor;
  try {
    observed = await createNativeWorkspaceDescriptor(existing.identity.canonicalPath, {
      createId: () => existing.id
    });
  } catch (error) {
    if (isNodeError(error, "ENOENT") || isNodeError(error, "ENOTDIR")) {
      return { ...existing, availability: "missing" };
    }
    return { ...existing, availability: "unavailable" };
  }

  if (workspaceIdentityMatches(existing.identity, observed.identity)) {
    return {
      ...observed,
      id: existing.id,
      trust: existing.trust,
      trustProvenance: existing.trust === "trusted" ? "restored" : existing.trustProvenance
    };
  }
  if (existing.identity.assurance === "path-only") {
    return {
      id: existing.id,
      displayName: observed.displayName,
      identity: observed.identity,
      ...(existing.lastVerifiedAt === undefined ? {} : { lastVerifiedAt: existing.lastVerifiedAt }),
      trust: "unknown",
      trustProvenance: "identity-changed",
      availability: "needs-confirmation"
    };
  }
  return {
    ...existing,
    trust: "unknown",
    trustProvenance: "identity-changed",
    availability: "identity-changed"
  };
}

export async function createNativeWorkspaceDescriptor(
  selectedPath: string,
  options: WorkspaceIdentityOptions = {}
): Promise<NativeWorkspaceDescriptor> {
  if (!isBoundedString(selectedPath, MAX_WORKSPACE_PATH_LENGTH)) {
    throw new Error("Workspace path is invalid.");
  }

  const canonicalPath = await realpathNative(selectedPath);
  if (!isAbsolute(canonicalPath) || !isBoundedString(canonicalPath, MAX_WORKSPACE_PATH_LENGTH)) {
    throw new Error("Workspace canonical path is invalid.");
  }

  const metadata = await stat(canonicalPath, { bigint: true });
  if (!metadata.isDirectory()) throw new Error("Selected workspace must be a directory.");

  const displayName = basename(canonicalPath) || canonicalPath;
  if (!isBoundedString(displayName, MAX_WORKSPACE_DISPLAY_NAME_LENGTH)) {
    throw new Error("Workspace display name is invalid.");
  }

  const id = (options.createId ?? randomUUID)();
  if (!isWorkspaceId(id)) throw new Error("Workspace id is invalid.");
  const lastVerifiedAt = (options.now ?? Date.now)();
  if (!isTimestamp(lastVerifiedAt)) throw new Error("Workspace verification timestamp is invalid.");

  const hasFilesystemIdentity = metadata.dev !== 0n && metadata.ino !== 0n;
  return {
    id,
    displayName,
    identity: {
      canonicalPath,
      device: metadata.dev.toString(10),
      inode: metadata.ino.toString(10),
      birthtimeNs: metadata.birthtimeNs.toString(10),
      assurance: hasFilesystemIdentity ? "filesystem" : "path-only"
    },
    lastVerifiedAt,
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

export function workspaceDescriptorsReferToSameDirectory(
  left: WorkspaceDescriptor,
  right: WorkspaceDescriptor
): boolean {
  if (left.identity.assurance === "filesystem" && right.identity.assurance === "filesystem") {
    return workspaceIdentityMatches(left.identity, right.identity);
  }
  if (left.identity.assurance !== "path-only" || right.identity.assurance !== "path-only") return false;
  return left.identity.canonicalPath === right.identity.canonicalPath;
}

export function refreshNativeWorkspaceDescriptor(
  existing: WorkspaceDescriptor,
  selected: NativeWorkspaceDescriptor
): NativeWorkspaceDescriptor {
  return { ...selected, id: existing.id };
}

function workspaceIdentityMatches(
  existing: WorkspacePathIdentity,
  observed: WorkspacePathIdentity
): boolean {
  if (existing.assurance !== "filesystem" || observed.assurance !== "filesystem") return false;
  return existing.device !== undefined
    && existing.inode !== undefined
    && existing.birthtimeNs !== undefined
    && existing.device === observed.device
    && existing.inode === observed.inode
    && existing.birthtimeNs === observed.birthtimeNs;
}

export function parseNativeWorkspaceDescriptor(value: unknown): NativeWorkspaceDescriptor | undefined {
  const descriptor = parseWorkspaceDescriptor(value);
  if (!descriptor || descriptor.trust !== "trusted" || descriptor.trustProvenance !== "native-picker"
    || descriptor.availability !== "available" || descriptor.identity.device === undefined
    || descriptor.identity.inode === undefined || descriptor.identity.birthtimeNs === undefined
    || descriptor.lastVerifiedAt === undefined) return undefined;
  return descriptor as NativeWorkspaceDescriptor;
}

export function parseWorkspaceDescriptor(value: unknown): WorkspaceDescriptor | undefined {
  if (!isRecordWithAllowedKeys(value, [
    "id",
    "displayName",
    "identity",
    "lastVerifiedAt",
    "trust",
    "trustProvenance",
    "availability"
  ], ["id", "displayName", "identity", "trust", "trustProvenance", "availability"])) return undefined;
  if (!isWorkspaceId(value.id)) return undefined;
  if (!isBoundedString(value.displayName, MAX_WORKSPACE_DISPLAY_NAME_LENGTH)) return undefined;
  if (value.lastVerifiedAt !== undefined && !isTimestamp(value.lastVerifiedAt)) return undefined;
  if (value.trust !== "unknown" && value.trust !== "trusted" && value.trust !== "untrusted") return undefined;
  if (!isOneOf(value.trustProvenance, [
    "native-picker",
    "user-confirmed",
    "restored",
    "identity-changed",
    "indirect"
  ])) return undefined;
  if (!isOneOf(value.availability, [
    "available",
    "missing",
    "identity-changed",
    "needs-confirmation",
    "unavailable"
  ])) return undefined;
  if (!isRecordWithAllowedKeys(
    value.identity,
    ["canonicalPath", "device", "inode", "birthtimeNs", "assurance"],
    ["canonicalPath", "assurance"]
  )) return undefined;
  if (!isBoundedString(value.identity.canonicalPath, MAX_WORKSPACE_PATH_LENGTH)
    || !isAbsolute(value.identity.canonicalPath)) return undefined;
  if (value.identity.device !== undefined && !isDecimalBigint(value.identity.device)) return undefined;
  if (value.identity.inode !== undefined && !isDecimalBigint(value.identity.inode)) return undefined;
  if (value.identity.birthtimeNs !== undefined && !isDecimalBigint(value.identity.birthtimeNs)) return undefined;
  if (value.identity.assurance !== "filesystem" && value.identity.assurance !== "path-only") return undefined;
  if (value.identity.assurance === "filesystem" && (
    value.identity.device === undefined || value.identity.inode === undefined
  )) return undefined;
  return value as unknown as WorkspaceDescriptor;
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength && !value.includes("\0");
}

function isWorkspaceId(value: unknown): value is string {
  return isBoundedString(value, MAX_WORKSPACE_ID_LENGTH) && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function isDecimalBigint(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) && value.length <= 40;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRecordWithAllowedKeys(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[]
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.every((key) => allowedKeys.includes(key))
    && requiredKeys.every((key) => Object.hasOwn(value, key));
}

function isOneOf<const T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}
