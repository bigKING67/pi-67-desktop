export interface OVSearchResult {
  uri: string;
  context_type: string;
  score: number;
  abstract: string;
  overview: string | null;
  level: number;
  category: string;
  match_reason: string;
}

export interface OVContextSearchEntry {
  uri: string;
  category: string;
  detail: string;
  score: number;
  text: string;
}

export interface OVContextSearchResult {
  entries: OVContextSearchEntry[];
  rendered: string;
  digest: string;
  stats: Record<string, unknown>;
}

export interface OVDirEntry {
  uri: string;
  name: string;
  isDir: boolean;
  size: number;
  mode: number;
  modTime: string;
  abstract: string;
}

export interface OVStatInfo {
  name: string;
  size: number;
  mode: number;
  modTime: string;
  isDir: boolean;
  isLocked: boolean;
  uri?: string;
  count?: number;
}

export interface OVSessionMeta {
  session_id: string;
  message_count: number;
  total_message_count?: number;
  commit_count: number;
  pending_tokens?: number;
  memories_extracted?: Record<string, number>;
  last_commit_at?: string;
}

export interface OVSessionContext {
  latest_archive_overview: string | null;
  pre_archive_abstracts: unknown[];
  messages: unknown[];
  estimatedTokens: number;
  stats: {
    totalArchives: number;
    includedArchives: number;
    droppedArchives: number;
    failedArchives: number;
    activeTokens: number;
    archiveTokens: number;
  };
}

export interface OVSessionArchive {
  archive_id: string;
  abstract?: string;
  overview?: string;
  messages?: unknown[];
}

export interface OVCommitResult {
  status?: string;
  archived?: boolean;
  reason?: string;
  task_id?: string;
  archive_uri?: string;
  trace_id?: string;
}

export interface OVCommitRetention {
  keepRecentCount?: number;
  keepRecentTurns?: number;
}

export interface OVCommitResponse {
  result: OVCommitResult | null;
  traceId?: string;
  error?: { message?: string; code?: string };
  status?: number;
}

export interface OVResponse<T> {
  ok: boolean;
  result: T | null;
  error?: { message?: string; code?: string };
  status?: number;
  traceId?: string;
}
