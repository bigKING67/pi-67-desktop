export interface MessageSearchItem {
  id: string;
  role: "user" | "assistant";
  snippet: string;
  createdAt?: number;
}

export interface MessageSearchResult {
  sessionId: string;
  revision: number;
  query: string;
  total: number;
  items: MessageSearchItem[];
  truncated: boolean;
}

export interface WorkspaceMessageSearchItem {
  sessionFileIdentity: string;
  sessionPath: string;
  sessionName: string;
  messageId: string;
  role: "user" | "assistant";
  snippet: string;
  createdAt?: number;
}

export interface WorkspaceMessageSearchResult {
  workspaceId: string;
  query: string;
  items: WorkspaceMessageSearchItem[];
  sessionsVisited: number;
  entriesVisited: number;
  skippedCount: number;
  incomplete: boolean;
  truncated: boolean;
}
