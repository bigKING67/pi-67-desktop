import type {
  WorkspaceFileMutationResult,
  WorkspaceFileOpenResult,
  WorkspaceFilePage,
  WorkspaceFileRenameResult,
  WorkspaceFileSearchResult
} from "@pi67/domain";

export interface WorkspaceFileCommandPayloads {
  "workspace.file.list": { parentId?: string; cursor?: string; limit?: number; includeGenerated?: boolean };
  "workspace.file.search": { query: string; includeGenerated?: boolean };
  "workspace.file.resolve": { relativePath: string };
  "workspace.file.open": { id: string };
  "workspace.file.save": { id: string; expectedRevision: string; content: string };
  "workspace.file.create": { parentId?: string; name: string; kind: "file" | "directory" };
  "workspace.file.rename": { id: string; name: string };
}

export interface WorkspaceFileCommandResults {
  "workspace.file.list": WorkspaceFilePage;
  "workspace.file.search": WorkspaceFileSearchResult;
  "workspace.file.resolve": WorkspaceFileMutationResult;
  "workspace.file.open": WorkspaceFileOpenResult;
  "workspace.file.save": WorkspaceFileMutationResult;
  "workspace.file.create": WorkspaceFileMutationResult;
  "workspace.file.rename": WorkspaceFileRenameResult;
}
