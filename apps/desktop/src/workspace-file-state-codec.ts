import { isAbsolute } from "node:path";
import {
  MAX_WORKSPACE_FILE_DRAFT_BYTES_TOTAL,
  MAX_WORKSPACE_FILE_PATH_CHARS,
  MAX_WORKSPACE_FILE_TABS_PER_WORKSPACE,
  MAX_WORKSPACE_FILE_TABS_TOTAL,
  type WorkspaceFilePersistedState,
  type WorkspaceFilePersistedTab
} from "@pi67/protocol";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";

const MAX_WORKSPACES = 100;

interface StoredWorkspaceFileTab {
  relativePath: string;
  baseRevision?: string;
  encryptedDraft?: string;
}

export interface StoredWorkspaceFileState {
  version: 1;
  workspaces: Array<{
    workspaceId: string;
    tabs: StoredWorkspaceFileTab[];
    activeRelativePath?: string;
  }>;
}

export function parseWorkspaceFilePersistedState(value: unknown): WorkspaceFilePersistedState | undefined {
  if (!isExactRecord(value, ["version", "workspaces"]) || value.version !== 1 || !Array.isArray(value.workspaces)) {
    return undefined;
  }
  if (value.workspaces.length > MAX_WORKSPACES) return undefined;
  const workspaces: WorkspaceFilePersistedState["workspaces"] = [];
  const workspaceIds = new Set<string>();
  let totalTabs = 0;
  let totalDraftBytes = 0;
  for (const workspaceValue of value.workspaces) {
    if (!isRecordWithAllowedKeys(
      workspaceValue,
      ["workspaceId", "tabs", "activeRelativePath"],
      ["workspaceId", "tabs"]
    )) return undefined;
    if (!isWorkspaceId(workspaceValue.workspaceId) || workspaceIds.has(workspaceValue.workspaceId)) return undefined;
    if (!Array.isArray(workspaceValue.tabs) || workspaceValue.tabs.length > MAX_WORKSPACE_FILE_TABS_PER_WORKSPACE) {
      return undefined;
    }
    const paths = new Set<string>();
    const tabs: WorkspaceFilePersistedTab[] = [];
    for (const tabValue of workspaceValue.tabs) {
      if (!isRecordWithAllowedKeys(
        tabValue,
        ["relativePath", "baseRevision", "draft"],
        ["relativePath"]
      )) return undefined;
      if (!isRelativePath(tabValue.relativePath) || paths.has(tabValue.relativePath)) return undefined;
      if (tabValue.baseRevision !== undefined && !isOpaqueRevision(tabValue.baseRevision)) return undefined;
      if (tabValue.draft !== undefined) {
        if (typeof tabValue.draft !== "string" || tabValue.baseRevision === undefined) return undefined;
        totalDraftBytes += Buffer.byteLength(tabValue.draft, "utf8");
      }
      paths.add(tabValue.relativePath);
      tabs.push({
        relativePath: tabValue.relativePath,
        ...(tabValue.baseRevision === undefined ? {} : { baseRevision: tabValue.baseRevision }),
        ...(tabValue.draft === undefined ? {} : { draft: tabValue.draft })
      });
    }
    totalTabs += tabs.length;
    if (totalTabs > MAX_WORKSPACE_FILE_TABS_TOTAL || totalDraftBytes > MAX_WORKSPACE_FILE_DRAFT_BYTES_TOTAL) {
      return undefined;
    }
    if (
      workspaceValue.activeRelativePath !== undefined
      && (!isRelativePath(workspaceValue.activeRelativePath) || !paths.has(workspaceValue.activeRelativePath))
    ) return undefined;
    workspaceIds.add(workspaceValue.workspaceId);
    workspaces.push({
      workspaceId: workspaceValue.workspaceId,
      tabs,
      ...(workspaceValue.activeRelativePath === undefined
        ? {}
        : { activeRelativePath: workspaceValue.activeRelativePath })
    });
  }
  return { version: 1, workspaces };
}

export function parseStoredState(value: unknown): StoredWorkspaceFileState | undefined {
  if (!isExactRecord(value, ["version", "workspaces"]) || value.version !== 1 || !Array.isArray(value.workspaces)) {
    return undefined;
  }
  if (value.workspaces.length > MAX_WORKSPACES) return undefined;
  const workspaces: StoredWorkspaceFileState["workspaces"] = [];
  let totalTabs = 0;
  for (const workspaceValue of value.workspaces) {
    if (!isRecordWithAllowedKeys(
      workspaceValue,
      ["workspaceId", "tabs", "activeRelativePath"],
      ["workspaceId", "tabs"]
    ) || !isWorkspaceId(workspaceValue.workspaceId) || !Array.isArray(workspaceValue.tabs)) return undefined;
    if (workspaceValue.tabs.length > MAX_WORKSPACE_FILE_TABS_PER_WORKSPACE) return undefined;
    const tabs: StoredWorkspaceFileTab[] = [];
    const paths = new Set<string>();
    for (const tabValue of workspaceValue.tabs) {
      if (!isRecordWithAllowedKeys(
        tabValue,
        ["relativePath", "baseRevision", "encryptedDraft"],
        ["relativePath"]
      ) || !isRelativePath(tabValue.relativePath) || paths.has(tabValue.relativePath)) return undefined;
      if (tabValue.baseRevision !== undefined && !isOpaqueRevision(tabValue.baseRevision)) return undefined;
      if (
        tabValue.encryptedDraft !== undefined
        && (typeof tabValue.encryptedDraft !== "string" || tabValue.baseRevision === undefined)
      ) return undefined;
      paths.add(tabValue.relativePath);
      tabs.push(tabValue as unknown as StoredWorkspaceFileTab);
    }
    totalTabs += tabs.length;
    if (totalTabs > MAX_WORKSPACE_FILE_TABS_TOTAL) return undefined;
    if (
      workspaceValue.activeRelativePath !== undefined
      && (typeof workspaceValue.activeRelativePath !== "string" || !paths.has(workspaceValue.activeRelativePath))
    ) return undefined;
    workspaces.push({
      workspaceId: workspaceValue.workspaceId,
      tabs,
      ...(workspaceValue.activeRelativePath === undefined
        ? {}
        : { activeRelativePath: workspaceValue.activeRelativePath })
    });
  }
  return { version: 1, workspaces };
}

export function encodeStoredState(
  state: WorkspaceFilePersistedState,
  encryption: DesktopTextEncryption
): StoredWorkspaceFileState {
  const canEncrypt = !hasWorkspaceFileDrafts(state) || encryption.isAvailable();
  return {
    version: 1,
    workspaces: state.workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      tabs: workspace.tabs.map((tab) => ({
        relativePath: tab.relativePath,
        ...(tab.baseRevision === undefined ? {} : { baseRevision: tab.baseRevision }),
        ...(tab.draft === undefined || !canEncrypt
          ? {}
          : { encryptedDraft: encryption.encrypt(tab.draft).toString("base64") })
      })),
      ...(workspace.activeRelativePath === undefined
        ? {}
        : { activeRelativePath: workspace.activeRelativePath })
    }))
  };
}

export function decodeStoredState(
  stored: StoredWorkspaceFileState,
  encryption: DesktopTextEncryption
): { state: WorkspaceFilePersistedState; decryptFailed: boolean } {
  let decryptFailed = false;
  const state: WorkspaceFilePersistedState = {
    version: 1,
    workspaces: stored.workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      tabs: workspace.tabs.map((tab) => {
        if (tab.encryptedDraft === undefined) return { relativePath: tab.relativePath };
        if (!encryption.isAvailable()) {
          decryptFailed = true;
          return { relativePath: tab.relativePath };
        }
        try {
          return {
            relativePath: tab.relativePath,
            baseRevision: tab.baseRevision!,
            draft: encryption.decrypt(Buffer.from(tab.encryptedDraft, "base64"))
          };
        } catch {
          decryptFailed = true;
          return { relativePath: tab.relativePath };
        }
      }),
      ...(workspace.activeRelativePath === undefined
        ? {}
        : { activeRelativePath: workspace.activeRelativePath })
    }))
  };
  const parsed = parseWorkspaceFilePersistedState(state);
  return { state: parsed ?? emptyWorkspaceFileState(), decryptFailed: decryptFailed || parsed === undefined };
}

export function emptyWorkspaceFileState(): WorkspaceFilePersistedState {
  return { version: 1, workspaces: [] };
}

export function hasWorkspaceFileDrafts(state: WorkspaceFilePersistedState): boolean {
  return state.workspaces.some((workspace) => workspace.tabs.some((tab) => tab.draft !== undefined));
}

function isWorkspaceId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 200
    && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function isOpaqueRevision(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/u.test(value);
}

function isRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_WORKSPACE_FILE_PATH_CHARS
    || value.includes("\0")
    || value.includes("\\")
    || isAbsolute(value)
  ) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..")
    && segments[0] !== ".git";
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecordWithAllowedKeys(value, keys, keys);
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
