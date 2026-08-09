export interface WorkspaceFileNavigationIntent {
  relativePath: string;
  revision: string;
  line: number;
  column: number;
  query: string;
  nonce: number;
}

export interface WorkspaceFileTab {
  id?: string | undefined;
  name: string;
  relativePath: string;
  phase: "restoring" | "loading" | "ready" | "unavailable" | "missing";
  revision?: string | undefined;
  content?: string | undefined;
  savedContent?: string | undefined;
  dirty: boolean;
  conflict: boolean;
  reason?: string | undefined;
  documentVersion: number;
}

export interface WorkspaceFileWorkspaceState {
  tabs: string[];
  activeRelativePath?: string | undefined;
  byPath: Record<string, WorkspaceFileTab>;
  navigation?: WorkspaceFileNavigationIntent | undefined;
}
