import { readFileSync } from "node:fs";

export class OpenVikingLabClient {
  constructor({ baseUrl, apiKey, actorPeer = "" }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.actorPeer = actorPeer;
  }

  async health() {
    return this.#request("/health", { authenticated: false, timeoutMs: 3000 });
  }

  async listAccounts() {
    return this.#request("/api/v1/admin/accounts", { root: true });
  }

  async createAccount(accountId, adminUserId) {
    return this.#request("/api/v1/admin/accounts", {
      method: "POST",
      root: true,
      body: { account_id: accountId, admin_user_id: adminUserId },
      timeoutMs: 15000,
    });
  }

  async deleteAccount(accountId) {
    return this.#request(`/api/v1/admin/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
      root: true,
      timeoutMs: 30000,
    });
  }

  async writeResource(uri, content) {
    return this.#request("/api/v1/content/write", {
      method: "POST",
      body: { uri, content, mode: "create", wait: true, timeout: 90 },
      timeoutMs: 100000,
    });
  }

  async queueResource(uri, content) {
    return this.#request("/api/v1/content/write", {
      method: "POST",
      body: { uri, content, mode: "create", wait: false },
      timeoutMs: 10000,
    });
  }

  async createSession(sessionId) {
    return this.#request("/api/v1/sessions", {
      method: "POST",
      body: { session_id: sessionId },
      timeoutMs: 10000,
    });
  }

  async find(query, configuration, targetUri) {
    return this.#request("/api/v1/search/find", {
      method: "POST",
      body: {
        query,
        target_uri: targetUri,
        limit: configuration.findCandidateLimit,
        score_threshold: configuration.scoreThreshold,
      },
      timeoutMs: configuration.findTimeoutMs,
    });
  }

  async contextSearch(query, sessionId, configuration) {
    return this.#request("/api/v1/search/search", {
      method: "POST",
      body: {
        query,
        mode: "context",
        purpose: "coding",
        peer_scope: "actor",
        score_threshold: configuration.scoreThreshold,
        max_tokens: configuration.recallTokenBudget,
        quotas: {
          events: 0,
          entities: 0,
          preferences: 0,
          experiences: 0,
          resources: configuration.resourceQuota,
          skills: 0,
        },
        session_id: sessionId,
        query_expansion: "auto",
      },
      timeoutMs: configuration.contextTimeoutMs,
    });
  }

  withUserKey(apiKey) {
    return new OpenVikingLabClient({
      baseUrl: this.baseUrl,
      apiKey,
      actorPeer: this.actorPeer,
    });
  }

  async #request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: this.#headers(options.authenticated !== false),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const envelope = await response.json().catch(() => ({}));
      if (!response.ok || envelope?.status === "error") {
        throw safeHttpError(response.status, envelope);
      }
      return envelope;
    } catch (error) {
      if (error instanceof OpenVikingPilotError) throw error;
      const code = error?.name === "AbortError" ? "timeout" : "transport";
      throw new OpenVikingPilotError(code, 0, `OpenViking ${code} failure.`);
    } finally {
      clearTimeout(timer);
    }
  }

  #headers(authenticated) {
    const headers = { "Content-Type": "application/json" };
    if (authenticated && this.apiKey) headers["X-API-Key"] = this.apiKey;
    if (authenticated && this.actorPeer) {
      headers["X-OpenViking-Actor-Peer"] = this.actorPeer;
    }
    return headers;
  }
}

export class OpenVikingPilotError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "OpenVikingPilotError";
    this.code = code;
    this.status = status;
  }
}

export function readRootKey(rootConfigPath) {
  if (!rootConfigPath) {
    throw new Error("Pass --root-config with an external OpenViking ov.conf path.");
  }
  const config = JSON.parse(readFileSync(rootConfigPath, "utf8"));
  const key = String(config?.server?.root_api_key ?? "").trim();
  if (!key) throw new Error("The external OpenViking config has no root_api_key.");
  return key;
}

export function accountExists(envelope, accountId) {
  return Array.isArray(envelope?.result) && envelope.result.some(
    (item) => item?.account_id === accountId,
  );
}

function safeHttpError(status, envelope) {
  const rawCode = String(envelope?.error?.code ?? `http_${status}`);
  const code = /^[A-Z0-9_-]{1,80}$/i.test(rawCode) ? rawCode : `http_${status}`;
  return new OpenVikingPilotError(code, status, `OpenViking request failed (${code}).`);
}
