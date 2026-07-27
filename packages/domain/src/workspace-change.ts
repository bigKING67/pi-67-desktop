export type WorkspaceChangeKind = "edit" | "write";

export type WorkspaceChangeStatus = "pending" | "running" | "completed" | "failed" | "interrupted";

interface WorkspaceChangeBase {
  toolCallId: string;
  path: string;
  pathTruncated: boolean;
  status: WorkspaceChangeStatus;
}

export interface EditWorkspaceChangeView extends WorkspaceChangeBase {
  kind: "edit";
  patch?: string;
  patchTruncated: boolean;
  additions?: number;
  deletions?: number;
  firstChangedLine?: number;
}

export interface WriteWorkspaceChangeView extends WorkspaceChangeBase {
  kind: "write";
  writtenBytes?: number;
  writtenLines?: number;
  metricsTruncated: boolean;
}

export type WorkspaceChangeView = EditWorkspaceChangeView | WriteWorkspaceChangeView;

export interface WorkspaceChangesProjection {
  sessionId: string;
  items: WorkspaceChangeView[];
  truncated: boolean;
  total: number;
}
