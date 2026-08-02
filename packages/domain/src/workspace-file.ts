export type WorkspaceFileKind = "directory" | "file" | "symlink" | "other";

export interface WorkspaceFileEntry {
  id: string;
  name: string;
  relativePath: string;
  kind: WorkspaceFileKind;
  revision: string;
  byteLength?: number;
  modifiedAt?: number;
}

export interface WorkspaceFilePage {
  workspaceId: string;
  parentId?: string;
  entries: WorkspaceFileEntry[];
  nextCursor?: string;
  truncated: boolean;
}

export interface WorkspaceFileSearchResult {
  workspaceId: string;
  query: string;
  entries: WorkspaceFileEntry[];
  truncated: boolean;
  visited: number;
}

export type WorkspaceFileOpenKind = "text" | "binary" | "oversized" | "unsupported";

export interface WorkspaceFileOpenResult {
  id: string;
  relativePath: string;
  kind: WorkspaceFileOpenKind;
  totalBytes: number;
  revision: string;
  content?: string;
  reason?: string;
}

export interface WorkspaceFileMutationResult {
  entry: WorkspaceFileEntry;
}

export interface WorkspaceFileRenameResult extends WorkspaceFileMutationResult {
  previousRelativePath: string;
}

export interface WorkspaceFilePersistedTab {
  relativePath: string;
  baseRevision?: string;
  draft?: string;
}

export interface WorkspaceFilePersistedWorkspace {
  workspaceId: string;
  tabs: WorkspaceFilePersistedTab[];
  activeRelativePath?: string;
}

export interface WorkspaceFilePersistedState {
  version: 1;
  workspaces: WorkspaceFilePersistedWorkspace[];
}

export interface WorkspaceFileStateSnapshot {
  state: WorkspaceFilePersistedState;
  draftPersistence: "available" | "unavailable";
  recovery?: "corrupt-reset" | "draft-decrypt-failed";
}

export interface WorkspaceEntryRequest {
  workspaceId: string;
  relativePath: string;
  kind: WorkspaceFileKind;
}

export type WorkspaceEntryContextAction =
  | "pi67-open"
  | "open-default"
  | "copy-absolute"
  | "copy-relative"
  | "reveal";
