export interface PendingQueueContext { readonly directory: string; readonly scopeKey: string; }
export function enqueue(
  type: string,
  sessionId: string,
  payload: Record<string, any>,
  options?: { createdAt?: number },
  context?: PendingQueueContext,
): Promise<{ ok: boolean; path?: string; error?: string; dedupKey: string; deduped?: boolean }>;
export function listPending(context?: PendingQueueContext): Promise<Array<{ filename: string; entry: Record<string, any> }>>;
export function dequeue(filename: string, context?: PendingQueueContext): Promise<boolean>;
export function replayPending(
  fetchJSON: (path: string, init?: any) => Promise<{ ok: boolean; status?: number; result?: any; error?: any }>,
  log: (stage: string, data?: any) => void,
  canReplay?: () => boolean,
  context?: PendingQueueContext,
): Promise<{
  replayed: number;
  failed: number;
  skipped: number;
  deferred: number;
  outcomes: Record<string, "replayed" | "failed" | "skipped" | "deferred">;
}>;
export function cleanStale(context?: PendingQueueContext): Promise<number>;
