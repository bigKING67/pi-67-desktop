export function buildRecallBlock(
  fetchJSON: (path: string, init?: any, options?: any) => Promise<{ ok: boolean; status?: number; result?: any; error?: any }>,
  cfg: Record<string, any>,
  query: string,
  options?: {
    actorPeerId?: string;
    sessionId?: string;
    legacyCachePath?: string;
    log?: (stage: string, data?: any) => void;
  },
): Promise<string | null>;

export function buildRecallEndpointBody(cfg?: Record<string, any>): Record<string, any>;
export function postRecall(
  fetchJSON: (path: string, init?: any, options?: any) => Promise<{ ok: boolean; status?: number; result?: any; error?: any }>,
  body: Record<string, any>,
  options?: {
    actorPeerId?: string;
    log?: (stage: string, data?: any) => void;
  },
): Promise<{ ok: boolean; status?: number; result?: any; error?: any }>;
export function estimateTokens(text: string): number;
