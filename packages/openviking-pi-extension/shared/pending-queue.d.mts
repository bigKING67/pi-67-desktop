export function enqueue(
  type: string,
  sessionId: string,
  payload: Record<string, any>,
  options?: { createdAt?: number },
): Promise<{ ok: boolean; path?: string; error?: string; dedupKey: string; deduped?: boolean }>;
export function listPending(): Promise<Array<{ filename: string; entry: Record<string, any> }>>;
export function dequeue(filename: string): Promise<boolean>;
export function replayPending(
  fetchJSON: (path: string, init?: any) => Promise<{ ok: boolean; status?: number; result?: any; error?: any }>,
  log: (stage: string, data?: any) => void,
): Promise<{
  replayed: number;
  failed: number;
  skipped: number;
  deferred: number;
  outcomes: Record<string, "replayed" | "failed" | "skipped" | "deferred">;
}>;
export function cleanStale(): Promise<number>;
