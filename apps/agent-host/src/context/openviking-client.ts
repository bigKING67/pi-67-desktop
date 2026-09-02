import type { ContextMemoryConfiguration, MemoryScope } from "@pi67/domain";
import { HostCommandError } from "../protocol-error.js";
import {
  resolveOpenVikingClientCredentials,
  type OpenVikingClientCredentials
} from "./openviking-credentials.js";

interface OpenVikingEnvelope<T> {
  status?: "ok" | "error";
  result?: T;
  error?: { message?: string };
}

export interface OpenVikingSessionMeta {
  session_id: string;
  message_count: number;
  total_message_count?: number;
  commit_count?: number;
  pending_tokens?: number;
  memories_extracted?: Record<string, number>;
  last_commit_at?: string;
}

export interface OpenVikingSearchResult {
  uri: string;
  context_type: string;
  score: number;
  abstract: string;
  overview?: string | null;
  category?: string;
  match_reason?: string;
}

export interface OpenVikingCommitResult {
  status: string;
  archived: boolean;
  reason?: string;
  task_id?: string;
  archive_uri?: string;
  trace_id?: string;
}

type OpenVikingTaskStatus =
  | "pending"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export interface OpenVikingCommitTaskResult {
  session_id: string;
  archive_uri: string;
  memory_diff_uri: string;
  memories_extracted?: Record<string, number>;
}

export interface OpenVikingTask {
  task_id: string;
  task_type: string;
  status: OpenVikingTaskStatus;
  result?: OpenVikingCommitTaskResult;
  error?: unknown;
}

export class OpenVikingClient {
  constructor(
    private readonly configuration: ContextMemoryConfiguration,
    private readonly actorPeerId?: string,
    private readonly credentials: OpenVikingClientCredentials = resolveOpenVikingClientCredentials(
      configuration.endpoint
    )
  ) {}

  async health(): Promise<{ version?: string; latencyMs: number }> {
    const startedAt = Date.now();
    const result = await this.request<Record<string, unknown>>(
      "/health",
      undefined,
      this.configuration.healthTimeoutMs
    );
    await this.request(
      "/api/v1/fs/ls?uri=viking%3A%2F%2F&simple=true&node_limit=1",
      undefined,
      this.configuration.healthTimeoutMs
    );
    const version = typeof result.version === "string" ? result.version : undefined;
    return { ...(version === undefined ? {} : { version }), latencyMs: Date.now() - startedAt };
  }

  getSession(sessionId: string): Promise<OpenVikingSessionMeta> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, undefined, 5_000);
  }

  async commitSession(sessionId: string): Promise<OpenVikingCommitResult> {
    const result = await this.request<OpenVikingCommitResult>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`,
      {
        method: "POST",
        body: JSON.stringify({
          retention_mode: "turn_budget",
          keep_recent_turn_count: this.configuration.takeover.keepRecentTurns
        })
      },
      30_000
    );
    if (typeof result.status !== "string" || typeof result.archived !== "boolean") {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "OpenViking returned an invalid commit result.",
        true
      );
    }
    return result;
  }

  async getTask(taskId: string): Promise<OpenVikingTask> {
    const value = await this.request<unknown>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}`,
      undefined,
      5_000
    );
    if (!isRecord(value)) throw invalidOpenVikingResponse("task");
    const status = value.status;
    if (!isTaskStatus(status)) throw invalidOpenVikingResponse("task status");
    const task: OpenVikingTask = {
      task_id: requiredString(value.task_id, "task id"),
      task_type: requiredString(value.task_type, "task type"),
      status
    };
    if (value.result !== null && value.result !== undefined) {
      if (!isRecord(value.result)) throw invalidOpenVikingResponse("task result");
      task.result = {
        session_id: requiredString(value.result.session_id, "task session id"),
        archive_uri: requiredString(value.result.archive_uri, "task archive URI"),
        memory_diff_uri: requiredString(value.result.memory_diff_uri, "task memory diff URI"),
        ...(isNumberRecord(value.result.memories_extracted)
          ? { memories_extracted: value.result.memories_extracted }
          : {})
      };
    }
    if (value.error !== undefined) task.error = value.error;
    return task;
  }

  async listDirectory(uri: string, limit = 100): Promise<string[]> {
    const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    const value = await this.request<unknown>(
      `/api/v1/fs/ls?uri=${encodeURIComponent(uri)}&simple=true&node_limit=${boundedLimit}`,
      undefined,
      this.configuration.recallTimeoutMs
    );
    if (!Array.isArray(value) || value.length > boundedLimit) {
      throw invalidOpenVikingResponse("directory listing");
    }
    const entries: string[] = [];
    for (const item of value) {
      if (typeof item !== "string" || item.length === 0 || item.length > 4_096) {
        throw invalidOpenVikingResponse("directory entry");
      }
      entries.push(item);
    }
    return entries;
  }

  async search(query: string, options: {
    limit: number;
    scope?: MemoryScope;
    targetUri?: string;
  }): Promise<OpenVikingSearchResult[]> {
    const payload: Record<string, unknown> = {
      query,
      limit: options.limit,
      score_threshold: this.configuration.scoreThreshold
    };
    if (options.targetUri) payload.target_uri = options.targetUri;
    const result = await this.request<Record<string, unknown>>(
      "/api/v1/search/find",
      { method: "POST", body: JSON.stringify(payload) },
      this.configuration.recallTimeoutMs
    );
    const values: OpenVikingSearchResult[] = [];
    for (const bucket of ["memories", "resources", "skills"]) {
      const entries = result[bucket];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!isRecord(entry) || typeof entry.uri !== "string") continue;
        const contextType = stringValue(entry.context_type)
          ?? (bucket === "memories" ? "memory" : bucket === "skills" ? "skill" : "resource");
        const item: OpenVikingSearchResult = {
          uri: entry.uri,
          context_type: contextType,
          score: numberValue(entry.score),
          abstract: stringValue(entry.abstract) ?? ""
        };
        const overview = entry.overview === null ? null : stringValue(entry.overview);
        const category = stringValue(entry.category);
        const matchReason = stringValue(entry.match_reason);
        if (overview !== undefined) item.overview = overview;
        if (category !== undefined) item.category = category;
        if (matchReason !== undefined) item.match_reason = matchReason;
        values.push(item);
      }
    }
    return values.slice(0, options.limit);
  }

  async abstract(uri: string): Promise<string> {
    const value = await this.request<unknown>(
      `/api/v1/content/abstract?uri=${encodeURIComponent(uri)}`,
      undefined,
      this.configuration.recallTimeoutMs
    );
    if (typeof value === "string") return value;
    if (isRecord(value)) return stringValue(value.abstract) ?? "";
    return "";
  }

  async read(uri: string): Promise<string> {
    const value = await this.request<unknown>(
      `/api/v1/content/read?uri=${encodeURIComponent(uri)}`,
      undefined,
      this.configuration.recallTimeoutMs
    );
    if (typeof value === "string") return value;
    if (isRecord(value)) {
      return stringValue(value.content)
        ?? stringValue(value.text)
        ?? stringValue(value.abstract)
        ?? "";
    }
    return "";
  }

  async forget(uri: string): Promise<void> {
    await this.request(
      `/api/v1/fs?uri=${encodeURIComponent(uri)}&recursive=false`,
      { method: "DELETE" },
      10_000
    );
  }

  private async request<T>(path: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
    if (this.credentials.problem) {
      throw new HostCommandError("RUNTIME_NOT_READY", this.credentials.problem, true);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (this.credentials.bearerToken) {
      headers.set("Authorization", `Bearer ${this.credentials.bearerToken}`);
    }
    if (this.credentials.account) headers.set("X-OpenViking-Account", this.credentials.account);
    if (this.credentials.user) headers.set("X-OpenViking-User", this.credentials.user);
    if (this.actorPeerId) headers.set("X-OpenViking-Actor-Peer", this.actorPeerId);
    try {
      const response = await fetch(`${this.configuration.endpoint.replace(/\/+$/, "")}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({})) as OpenVikingEnvelope<T>;
      if (!response.ok || body.status === "error") {
        throw new HostCommandError(
          "RUNTIME_NOT_READY",
          body.error?.message ?? `OpenViking returned HTTP ${response.status}.`,
          true,
          { status: response.status }
        );
      }
      return (body.result ?? body) as T;
    } catch (error) {
      if (error instanceof HostCommandError) throw error;
      const message = error instanceof Error && error.name === "AbortError"
        ? `OpenViking exceeded the ${timeoutMs} ms timeout.`
        : error instanceof Error ? error.message : "OpenViking is unavailable.";
      throw new HostCommandError("RUNTIME_NOT_READY", message, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) {
    throw invalidOpenVikingResponse(field);
  }
  return value;
}

function isTaskStatus(value: unknown): value is OpenVikingTaskStatus {
  return value === "pending"
    || value === "running"
    || value === "cancelling"
    || value === "completed"
    || value === "failed"
    || value === "cancelled";
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, count]) => (
    key.length > 0
    && key.length <= 128
    && typeof count === "number"
    && Number.isSafeInteger(count)
    && count >= 0
  ));
}

function invalidOpenVikingResponse(field: string): HostCommandError {
  return new HostCommandError(
    "RUNTIME_NOT_READY",
    `OpenViking returned an invalid ${field}.`,
    true
  );
}
