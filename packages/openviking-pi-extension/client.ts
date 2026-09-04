import type { OVConfig } from "./config.js";
import type {
  OVCommitResponse,
  OVCommitResult,
  OVCommitRetention,
  OVContextSearchEntry,
  OVContextSearchResult,
  OVDirEntry,
  OVResponse,
  OVSearchResult,
  OVSessionArchive,
  OVSessionContext,
  OVSessionMeta,
  OVStatInfo,
} from "./client-contracts.js";
export type * from "./client-contracts.js";

export class OVClient {
  private baseUrl: string;
  private apiKey: string;
  private account: string;
  private user: string;
  private peerId: string;
  private connectionState = false;
  private lastHealthAttemptAt = 0;
  private healthPromise: Promise<boolean> | null = null;
  private connectionListeners = new Set<(connected: boolean) => void>();

  private resolvedSpaces: Map<string, string> = new Map();

  private static RESERVED_USER = new Set(["memories"]);
  private static RESERVED_AGENT = new Set(["memories", "skills", "instructions", "workspaces"]);

  /** Read-only access to config (for value access across modules). */
  readonly cfg: OVConfig;

  constructor(config: OVConfig) {
    this.cfg = config;
    this.baseUrl = config.endpoint.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.account = config.account;
    this.user = config.user;
    this.peerId = config.peerId;
  }

  get connected(): boolean {
    return this.connectionState;
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    if (this.account) h["X-OpenViking-Account"] = this.account;
    if (this.user) h["X-OpenViking-User"] = this.user;
    if (this.peerId) h["X-OpenViking-Actor-Peer"] = this.peerId;
    if (this.cfg.userAgent) h["User-Agent"] = this.cfg.userAgent;
    return h;
  }

  /** Core fetch wrapper. Returns { ok, result } after parsing OV's { status, result } envelope. */
  async fetchJSON<T>(path: string, init?: RequestInit, timeoutMs = 10000): Promise<OVResponse<T>> {
    const controller = new AbortController();
    const externalSignal = init?.signal;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("OpenViking request timed out")), timeoutMs);
    try {
      const resp = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(), ...(init?.headers as Record<string, string> | undefined) },
        signal: controller.signal,
      });
      const body = await resp.json().catch(() => ({}));
      const traceId = body?.result?.trace_id || body?.error?.trace_id || body?.trace_id || undefined;
      if (!resp.ok || body.status === "error") {
        this.setConnected(path !== "/health");
        return {
          ok: false,
          result: null,
          status: resp.status,
          error: body.error || { message: `HTTP ${resp.status}` },
          traceId,
        };
      }
      this.setConnected(true);
      return { ok: true, result: (body.result ?? body) as T, traceId };
    } catch (err: any) {
      this.setConnected(false);
      return { ok: false, result: null, status: 0, error: { message: err?.message || String(err) } };
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }

  // ========== Health ==========

  async health(signal?: AbortSignal): Promise<boolean> {
    const res = await this.fetchJSON<any>(
      "/health",
      signal ? { signal } : undefined,
      this.cfg.healthTimeoutMs,
    );
    this.setConnected(res.ok);
    return res.ok;
  }

  async ensureConnected(force = false, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted || this.cfg.enabled === false) return false;
    if (this.connected) return true;
    if (this.healthPromise) return this.healthPromise;
    const now = Date.now();
    if (!force && now - this.lastHealthAttemptAt < 1_000) return false;
    this.lastHealthAttemptAt = now;
    const healthPromise = this.health(signal).finally(() => {
      if (this.healthPromise === healthPromise) this.healthPromise = null;
    });
    this.healthPromise = healthPromise;
    return healthPromise;
  }

  private setConnected(connected: boolean): void {
    if (this.connectionState === connected) return;
    this.connectionState = connected;
    for (const listener of this.connectionListeners) listener(connected);
  }

  // ========== Sessions ==========

  /** POST /api/v1/sessions — create or reuse session */
  async createSession(sessionId: string): Promise<boolean> {
    const res = await this.fetchJSON<any>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, auto_commit_policy: null }),
    });
    return res.ok;
  }

  /** GET /api/v1/sessions/{id} — session metadata */
  async getSession(sessionId: string, autoCreate = false): Promise<OVSessionMeta | null> {
    const q = autoCreate ? "?auto_create=true" : "";
    const res = await this.fetchJSON<OVSessionMeta>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}${q}`,
      undefined, 5000,
    );
    return res.ok ? res.result : null;
  }

  /** GET /api/v1/sessions/{id}/context — assembled context with archive overview */
  async getSessionContext(sessionId: string, tokenBudget = 128000, signal?: AbortSignal): Promise<OVSessionContext | null> {
    const res = await this.fetchJSON<OVSessionContext>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/context?token_budget=${tokenBudget}`,
      signal ? { signal } : undefined, 10000,
    );
    return res.ok ? res.result : null;
  }

  async getSessionArchive(
    sessionId: string,
    archiveId: string,
    signal?: AbortSignal,
  ): Promise<OVSessionArchive | null> {
    const res = await this.fetchJSON<OVSessionArchive>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/archives/${encodeURIComponent(archiveId)}`,
      signal ? { signal } : undefined,
      10000,
    );
    return res.ok ? res.result : null;
  }

  /** POST /api/v1/sessions/{id}/messages — add a message (simple text mode) */
  async addMessage(sessionId: string, role: string, content: string): Promise<boolean> {
    const res = await this.fetchJSON<any>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", body: JSON.stringify({ role, content }) },
      10000,
    );
    return res.ok;
  }

  /** POST /api/v1/sessions/{id}/messages — add a message with parts */
  async addMessageParts(sessionId: string, role: string, parts: any[]): Promise<boolean> {
    const res = await this.fetchJSON<any>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", body: JSON.stringify({ role, parts }) },
      10000,
    );
    return res.ok;
  }

  async addMessagePayload(sessionId: string, payload: any): Promise<boolean> {
    const res = await this.fetchJSON<any>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", body: JSON.stringify(payload) },
      10000,
    );
    return res.ok;
  }

  /** POST /api/v1/sessions/{id}/commit — commit session for archiving + extraction */
  async commitSessionResponse(
    sessionId: string,
    retention: number | OVCommitRetention = this.cfg.commitKeepRecentCount,
  ): Promise<OVCommitResponse> {
    const res = await this.fetchJSON<OVCommitResult>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`,
      { method: "POST", body: JSON.stringify(buildCommitRequestBody(retention)) },
      30000,
    );
    if (res.ok && res.result && !res.result.trace_id && res.traceId) {
      res.result.trace_id = res.traceId;
    }
    return {
      result: res.ok ? res.result : null,
      ...(res.traceId === undefined ? {} : { traceId: res.traceId }),
      ...(res.error === undefined ? {} : { error: res.error }),
      ...(res.status === undefined ? {} : { status: res.status }),
    };
  }

  async commitSession(
    sessionId: string,
    retention: number | OVCommitRetention = this.cfg.commitKeepRecentCount,
  ): Promise<OVCommitResult | null> {
    return (await this.commitSessionResponse(sessionId, retention)).result;
  }

  /** DELETE /api/v1/sessions/{id} */
  async deleteSession(sessionId: string): Promise<boolean> {
    const res = await this.fetchJSON<any>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
      10000,
    );
    return res.ok;
  }

  // ========== Search ==========

  /** POST /api/v1/search/find — basic vector search */
  async find(
    query: string,
    opts?: { targetUri?: string; topK?: number; scoreThreshold?: number; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<OVSearchResult[]> {
    const body: Record<string, unknown> = { query };
    if (opts?.targetUri) body.target_uri = opts.targetUri;
    if (opts?.topK) body.limit = opts.topK;
    if (opts?.scoreThreshold) body.score_threshold = opts.scoreThreshold;

    const res = await this.fetchJSON<any>("/api/v1/search/find", {
      method: "POST",
      body: JSON.stringify(body),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    }, opts?.timeoutMs ?? 10000);
    if (!res.ok || !res.result) return [];

    // OV returns { memories: [...], resources: [...], skills: [...], total }
    const all: OVSearchResult[] = [];
    for (const bucket of ["memories", "resources", "skills"]) {
      const items = res.result[bucket];
      if (Array.isArray(items)) {
        for (const m of items) {
          all.push({
            uri: m.uri ?? "",
            context_type: m.context_type ?? (bucket === "memories" ? "memory" : bucket === "skills" ? "skill" : "resource"),
            score: m.score ?? 0,
            abstract: m.abstract ?? "",
            overview: m.overview ?? null,
            level: m.level ?? 0,
            category: m.category ?? "",
            match_reason: m.match_reason ?? "",
          });
        }
      }
    }
    return all;
  }

  /**
   * POST /api/v1/search/search — session-aware context search for Pi Tool use.
   *
   * Startup recall keeps query expansion off for latency and prefix stability;
   * an explicit model Tool call is the narrower place to pay for expansion.
   */
  async searchContext(
    query: string,
    opts?: { sessionId?: string; limit?: number },
  ): Promise<OVContextSearchResult | null> {
    const limit = Math.max(1, Math.min(8, Math.floor(opts?.limit ?? 5)));
    const sessionId = String(opts?.sessionId ?? "").trim();
    const body: Record<string, unknown> = {
      query,
      mode: "context",
      purpose: "coding",
      peer_scope: "actor",
      score_threshold: this.cfg.scoreThreshold,
      max_tokens: this.cfg.recallTokenBudget,
      quotas: {
        events: 1,
        entities: 1,
        preferences: 1,
        experiences: this.cfg.experienceRecallLimit,
        resources: this.cfg.sharedExperienceLimit,
        skills: 0,
      },
    };
    if (sessionId) {
      body.session_id = sessionId;
      body.query_expansion = "auto";
    }

    const res = await this.fetchJSON<any>("/api/v1/search/search", {
      method: "POST",
      body: JSON.stringify(body),
    }, sessionId ? 15000 : 10000);
    if (!res.ok || !res.result) return null;

    const entries = (Array.isArray(res.result.entries) ? res.result.entries : [])
      .map(normalizeContextSearchEntry)
      .filter((entry: OVContextSearchEntry) => entry.uri || entry.text)
      .slice(0, limit);
    return {
      entries,
      rendered: String(res.result.rendered ?? "").trim(),
      digest: String(res.result.digest ?? "").trim(),
      stats: res.result.stats && typeof res.result.stats === "object" ? res.result.stats : {},
    };
  }

  // ========== Content ==========

  /** GET /api/v1/content/abstract — L0 summary */
  async abstract(uri: string, signal?: AbortSignal): Promise<string | null> {
    const res = await this.fetchJSON<string>(
      `/api/v1/content/abstract?uri=${encodeURIComponent(uri)}`,
      signal ? { signal } : undefined, 10000,
    );
    return res.ok ? res.result : null;
  }

  /** GET /api/v1/content/overview — L1 overview (directories only) */
  async overview(uri: string, signal?: AbortSignal): Promise<string | null> {
    const res = await this.fetchJSON<string>(
      `/api/v1/content/overview?uri=${encodeURIComponent(uri)}`,
      signal ? { signal } : undefined, 10000,
    );
    return res.ok ? res.result : null;
  }

  /** GET /api/v1/content/read — L2 full content (files only) */
  async readContent(uri: string, signal?: AbortSignal): Promise<string | null> {
    const res = await this.fetchJSON<string>(
      `/api/v1/content/read?uri=${encodeURIComponent(uri)}`,
      signal ? { signal } : undefined, 10000,
    );
    return res.ok ? res.result : null;
  }

  // ========== Filesystem ==========

  /** GET /api/v1/fs/ls — list directory */
  async ls(uri: string, signal?: AbortSignal): Promise<OVDirEntry[]> {
    const res = await this.fetchJSON<any[]>(
      `/api/v1/fs/ls?uri=${encodeURIComponent(uri)}`,
      signal ? { signal } : undefined, 10000,
    );
    if (!res.ok || !Array.isArray(res.result)) return [];
    return res.result.map(e => ({
      uri: e.uri ?? "",
      name: e.name ?? uriBasename(e.uri ?? ""),
      isDir: e.isDir ?? false,
      size: e.size ?? 0,
      mode: e.mode ?? 0,
      modTime: e.modTime ?? "",
      abstract: e.abstract ?? "",
    }));
  }

  /** GET /api/v1/fs/stat — file/directory metadata */
  async stat(uri: string, signal?: AbortSignal): Promise<OVStatInfo | null> {
    const res = await this.fetchJSON<OVStatInfo>(
      `/api/v1/fs/stat?uri=${encodeURIComponent(uri)}`,
      signal ? { signal } : undefined, 10000,
    );
    return res.ok ? res.result : null;
  }

  /** DELETE /api/v1/fs — remove file or directory */
  async delete(uri: string, recursive = false, signal?: AbortSignal): Promise<boolean> {
    const res = await this.fetchJSON<any>(
      `/api/v1/fs?uri=${encodeURIComponent(uri)}&recursive=${recursive}`,
      { method: "DELETE", ...(signal ? { signal } : {}) },
      10000,
    );
    return res.ok;
  }

  // ========== Resources ==========

  /** POST /api/v1/resources — ingest a URL or file path */
  async addResource(
    path: string, opts?: { to?: string },
  ): Promise<{ root_uri: string } | null> {
    const body: Record<string, unknown> = { path };
    if (opts?.to) body.to = opts.to;
    const res = await this.fetchJSON<{ root_uri: string }>(
      "/api/v1/resources",
      { method: "POST", body: JSON.stringify(body) },
      30000,
    );
    return res.ok ? res.result : null;
  }

  // ========== URI Space Resolution ==========

  async resolveScopeSpace(scope: "user" | "agent"): Promise<string> {
    const cached = this.resolvedSpaces.get(scope);
    if (cached) return cached;

    // Probe system status for user identity fallback
    let fallbackSpace = "default";
    const statusRes = await this.fetchJSON<any>("/api/v1/system/status", undefined, 5000);
    if (statusRes.ok && typeof statusRes.result?.user === "string" && statusRes.result.user.trim()) {
      fallbackSpace = statusRes.result.user.trim();
    }

    // List scope root for actual namespaces
    const reserved = scope === "user" ? OVClient.RESERVED_USER : OVClient.RESERVED_AGENT;
    const entries = await this.ls(`viking://${scope}/`);
    const spaces = entries
      .filter(e => e.isDir && !e.name.startsWith(".") && !reserved.has(e.name))
      .map(e => e.name);

    if (spaces.length > 0) {
      // Prefer the fallback space if it exists, then "default", then first available
      let chosen = spaces[0]!;
      if (spaces.includes(fallbackSpace)) chosen = fallbackSpace;
      else if (spaces.includes("default")) chosen = "default";
      this.resolvedSpaces.set(scope, chosen);
      return chosen;
    }

    this.resolvedSpaces.set(scope, fallbackSpace);
    return fallbackSpace;
  }

  async resolveTargetUri(targetUri: string): Promise<string> {
    const trimmed = targetUri.trim().replace(/\/+$/, "");
    const m = trimmed.match(/^viking:\/\/(user|agent)(?:\/(.*))?$/);
    if (!m) return trimmed;
    const scope = m[1] as "user" | "agent";
    const rawRest = (m[2] ?? "").trim();
    if (!rawRest) return trimmed;
    const parts = rawRest.split("/").filter(Boolean);
    if (parts.length === 0) return trimmed;

    const reserved = scope === "user" ? OVClient.RESERVED_USER : OVClient.RESERVED_AGENT;
    if (!reserved.has(parts[0]!)) return trimmed; // already has space

    const space = await this.resolveScopeSpace(scope);
    return `viking://${scope}/${space}/${parts.join("/")}`;
  }
}

export function buildCommitRequestBody(retention: number | OVCommitRetention): Record<string, unknown> {
  if (typeof retention === "object" && retention !== null && retention.keepRecentTurns !== undefined) {
    return {
      retention_mode: "turn_budget",
      keep_recent_turn_count: Math.max(0, Math.floor(retention.keepRecentTurns)),
    };
  }
  const keepRecentCount = typeof retention === "number"
    ? retention
    : retention?.keepRecentCount ?? 0;
  return { keep_recent_count: Math.max(0, Math.floor(keepRecentCount)) };
}

function uriBasename(uri: string): string {
  const cleaned = uri.replace(/\/+$/, "");
  const last = cleaned.lastIndexOf("/");
  return last >= 0 ? cleaned.slice(last + 1) : cleaned;
}

function normalizeContextSearchEntry(value: any): OVContextSearchEntry {
  return {
    uri: String(value?.uri ?? "").trim(),
    category: String(value?.category ?? value?.type ?? "memory").trim() || "memory",
    detail: String(value?.detail ?? value?.mode ?? "abstract").trim() || "abstract",
    score: Number.isFinite(Number(value?.score)) ? Math.max(0, Math.min(1, Number(value.score))) : 0,
    text: String(
      value?.text ?? value?.content ?? value?.summary ?? value?.abstract ?? value?.uri ?? "",
    ).trim(),
  };
}
