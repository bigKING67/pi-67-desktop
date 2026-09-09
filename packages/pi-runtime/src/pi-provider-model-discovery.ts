import type {
  PiProviderDiscoveredModel,
  PiProviderDiscoveryConflict,
  PiProviderDiscoveryFamilyResult,
  PiProviderDiscoveryProtocolFamily,
  PiProviderModelDiscoveryInput,
  PiProviderModelDiscoveryResult
} from "@pi67/protocol";
import type { PiAuthCredentialStore } from "./pi-auth-credential-store.js";

const PROTOCOL_ORDER = ["openai", "anthropic", "gemini"] as const;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DISCOVERED_MODELS = 512;
const MAX_CONFLICTS = 128;

type DiscoveryFetch = typeof globalThis.fetch;

interface PiProviderModelDiscoveryOptions {
  resolveCredential(provider: string): Promise<string | undefined>;
  fetch?: DiscoveryFetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

interface CatalogEntry {
  id: string;
  name?: string;
  supplier?: string;
  protocol: PiProviderDiscoveryProtocolFamily;
}

interface CatalogAttempt {
  protocol: PiProviderDiscoveryProtocolFamily;
  ok: boolean;
  entries: CatalogEntry[];
  message?: string;
}

interface AggregatedEntry {
  id: string;
  name?: string;
  protocol: PiProviderDiscoveryProtocolFamily;
  suppliers: Set<string>;
  discoveredBy: Set<PiProviderDiscoveryProtocolFamily>;
}

export function createConfiguredProviderModelDiscovery(
  credentials: PiAuthCredentialStore
): PiProviderModelDiscovery {
  return new PiProviderModelDiscovery({
    resolveCredential: async (provider) => {
      const loadError = await credentials.reload();
      if (loadError) throw new Error("Pi auth.json could not be read for Provider discovery.");
      const credential = await credentials.read(provider);
      return credential?.type === "api_key" ? credential.key : undefined;
    }
  });
}

export class PiProviderModelDiscovery {
  private active: AbortController | undefined;
  private readonly fetch: DiscoveryFetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(private readonly options: PiProviderModelDiscoveryOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = boundedPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxResponseBytes = boundedPositiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
  }

  async inspect(input: PiProviderModelDiscoveryInput): Promise<PiProviderModelDiscoveryResult> {
    this.cancel();
    const catalogUrl = resolveCatalogUrl(input.baseUrl);
    const protocols = PROTOCOL_ORDER.filter((protocol) => input.protocols.includes(protocol));
    if (protocols.length === 0) throw new Error("至少选择一个要发现的 API 协议族。");
    const controller = new AbortController();
    this.active = controller;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      const credential = await this.resolveCredential(input);
      if (controller.signal.aborted) {
        return buildDiscoveryResult(input, protocols.map((protocol) => ({
          protocol,
          ok: false,
          entries: [],
          message: "模型目录检测已取消或超时。"
        })));
      }
      const attempts = input.authHeader !== false
        ? replicateSharedAttempt(
            await this.readCatalog(protocols[0]!, catalogUrl, credential, true, controller.signal),
            protocols
          )
        : await Promise.all(protocols.map((protocol) => this.readCatalog(
            protocol,
            catalogUrl,
            credential,
            false,
            controller.signal
          )));
      return buildDiscoveryResult(input, attempts);
    } finally {
      clearTimeout(timeout);
      if (this.active === controller) this.active = undefined;
    }
  }

  cancel(): boolean {
    if (!this.active) return false;
    this.active.abort();
    this.active = undefined;
    return true;
  }

  private async resolveCredential(input: PiProviderModelDiscoveryInput): Promise<string | undefined> {
    if (input.apiKey !== undefined && input.apiKey.length > 0) return input.apiKey;
    try {
      return await this.options.resolveCredential(input.provider);
    } catch {
      throw new Error("无法读取这个 Provider 已保存的 API Key。");
    }
  }

  private async readCatalog(
    protocol: PiProviderDiscoveryProtocolFamily,
    url: URL,
    credential: string | undefined,
    forceBearerAuth: boolean,
    signal: AbortSignal
  ): Promise<CatalogAttempt> {
    try {
      const response = await this.fetch(url, {
        method: "GET",
        headers: discoveryHeaders(protocol, credential, forceBearerAuth),
        redirect: "manual",
        signal
      });
      if (!response.ok) {
        return {
          protocol,
          ok: false,
          entries: [],
          message: statusMessage(response.status)
        };
      }
      const content = await readBoundedResponse(response, this.maxResponseBytes);
      const payload: unknown = JSON.parse(content);
      return {
        protocol,
        ok: true,
        entries: parseCatalogEntries(payload, protocol)
      };
    } catch (error) {
      return {
        protocol,
        ok: false,
        entries: [],
        message: signal.aborted
          ? "模型目录检测已取消或超时。"
          : error instanceof SyntaxError
            ? "模型目录没有返回有效 JSON。"
            : error instanceof CatalogResponseTooLargeError
              ? "模型目录响应超过安全大小限制。"
              : "无法读取模型目录。"
      };
    }
  }
}

function buildDiscoveryResult(
  input: PiProviderModelDiscoveryInput,
  attempts: CatalogAttempt[]
): PiProviderModelDiscoveryResult {
  const selected = new Set(input.protocols);
  const aggregated = new Map<string, AggregatedEntry>();
  for (const attempt of attempts) {
    for (const entry of attempt.entries) {
      if (!selected.has(entry.protocol)) continue;
      const current = aggregated.get(entry.id);
      if (!current) {
        aggregated.set(entry.id, {
          id: entry.id,
          ...(entry.name ? { name: entry.name } : {}),
          protocol: entry.protocol,
          suppliers: new Set(entry.supplier ? [entry.supplier] : []),
          discoveredBy: new Set([attempt.protocol])
        });
        continue;
      }
      current.discoveredBy.add(attempt.protocol);
      if (!current.name && entry.name) current.name = entry.name;
      if (entry.supplier) current.suppliers.add(entry.supplier);
    }
  }

  const models: PiProviderDiscoveredModel[] = [];
  const conflicts: PiProviderDiscoveryConflict[] = [];
  let truncated = false;
  for (const entry of aggregated.values()) {
    const suppliers = [...entry.suppliers];
    if (suppliers.length > 1) {
      if (conflicts.length < MAX_CONFLICTS) {
        conflicts.push({ id: entry.id, suppliers, reason: "supplier-id-collision" });
      } else {
        truncated = true;
      }
      continue;
    }
    if (models.length >= MAX_DISCOVERED_MODELS) {
      truncated = true;
      continue;
    }
    models.push({
      id: entry.id,
      ...(entry.name ? { name: entry.name } : {}),
      ...(suppliers[0] ? { supplier: suppliers[0] } : {}),
      protocol: entry.protocol,
      api: apiFor(entry.protocol, input.openAiApi),
      discoveredBy: PROTOCOL_ORDER.filter((protocol) => entry.discoveredBy.has(protocol)),
      verification: "catalog"
    });
  }

  const families = input.protocols.map((protocol): PiProviderDiscoveryFamilyResult => {
    const familyModels = models.filter((model) => model.protocol === protocol);
    const modelCount = familyModels.length;
    const ownModelCount = familyModels.filter((model) => model.discoveredBy.includes(protocol)).length;
    const ownAttempt = attempts.find((attempt) => attempt.protocol === protocol);
    if (ownModelCount > 0 && ownAttempt?.ok) return { protocol, status: "current", modelCount };
    if (modelCount > 0) {
      return {
        protocol,
        status: "shared",
        modelCount,
        message: "从其他已选协议返回的共享模型目录中识别。"
      };
    }
    if (ownAttempt?.ok) return { protocol, status: "empty", modelCount };
    return {
      protocol,
      status: "failed",
      modelCount,
      message: ownAttempt?.message ?? "未执行这个协议族的模型目录检测。"
    };
  });
  const failedFamilies = families.filter((family) => family.status === "failed").length;
  const failedAttempts = attempts.filter((attempt) => !attempt.ok).length;
  const status = failedFamilies === families.length && models.length === 0
    ? "failed"
    : failedAttempts > 0 || conflicts.length > 0 || truncated
      ? "partial"
      : "current";
  return { status, models, families, conflicts, truncated };
}

function replicateSharedAttempt(
  attempt: CatalogAttempt,
  protocols: readonly PiProviderDiscoveryProtocolFamily[]
): CatalogAttempt[] {
  return protocols.map((protocol) => ({ ...attempt, protocol }));
}

function parseCatalogEntries(
  payload: unknown,
  catalogProtocol: PiProviderDiscoveryProtocolFamily
): CatalogEntry[] {
  const root = isPlainObject(payload) ? payload : undefined;
  const googleShape = Array.isArray(root?.models);
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : googleShape
        ? root.models as unknown[]
        : [];
  const entries: CatalogEntry[] = [];
  for (const value of values) {
    const record = isPlainObject(value) ? value : undefined;
    const rawId = typeof value === "string"
      ? value
      : optionalString(record?.id) ?? optionalString(record?.name);
    if (!rawId) continue;
    const id = normalizeModelId(rawId, googleShape);
    if (!id || id.length > 512) continue;
    const name = boundedOptionalString(
      optionalString(record?.display_name)
      ?? optionalString(record?.displayName)
      ?? optionalString(record?.label),
      512
    );
    const supplier = boundedOptionalString(
      optionalString(record?.owned_by)
      ?? optionalString(record?.ownedBy)
      ?? optionalString(record?.publisher)
      ?? optionalString(record?.supplier),
      512
    );
    entries.push({
      id,
      ...(name && name !== id ? { name } : {}),
      ...(supplier ? { supplier } : {}),
      protocol: inferProtocol(record, id, name, catalogProtocol, googleShape)
    });
  }
  return entries;
}

function inferProtocol(
  record: Record<string, unknown> | undefined,
  id: string,
  name: string | undefined,
  catalogProtocol: PiProviderDiscoveryProtocolFamily,
  googleShape: boolean
): PiProviderDiscoveryProtocolFamily {
  const hint = [record?.api, record?.protocol, record?.type]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase("en-US");
  if (hint.includes("anthropic") || hint.includes("claude")) return "anthropic";
  if (hint.includes("gemini") || hint.includes("google-generative")) return "gemini";
  if (hint.includes("openai") || hint.includes("responses") || hint.includes("completions")) return "openai";
  const identity = `${id} ${name ?? ""}`.toLocaleLowerCase("en-US");
  if (identity.includes("claude")) return "anthropic";
  if (identity.includes("gemini")) return "gemini";
  if (googleShape && catalogProtocol === "gemini") return "gemini";
  return "openai";
}

function apiFor(
  protocol: PiProviderDiscoveryProtocolFamily,
  openAiApi: PiProviderModelDiscoveryInput["openAiApi"]
): PiProviderDiscoveredModel["api"] {
  if (protocol === "anthropic") return "anthropic-messages";
  if (protocol === "gemini") return "google-generative-ai";
  return openAiApi;
}

function discoveryHeaders(
  protocol: PiProviderDiscoveryProtocolFamily,
  credential: string | undefined,
  forceBearerAuth: boolean
): Headers {
  const headers = new Headers({ accept: "application/json" });
  if (!credential) return headers;
  if (forceBearerAuth || protocol === "openai") {
    headers.set("authorization", `Bearer ${credential}`);
    return headers;
  }
  if (protocol === "anthropic") {
    headers.set("x-api-key", credential);
    headers.set("anthropic-version", "2023-06-01");
    return headers;
  }
  headers.set("x-goog-api-key", credential);
  return headers;
}

function resolveCatalogUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Base URL 不是有效地址。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL 仅支持 HTTP 或 HTTPS。");
  }
  if (url.username || url.password) throw new Error("Base URL 不能包含用户名或密码。");
  const path = url.pathname.replace(/\/+$/u, "");
  url.pathname = path.endsWith("/models") ? path : `${path}/models`;
  return url;
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new CatalogResponseTooLargeError();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new CatalogResponseTooLargeError();
    }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}

function statusMessage(status: number): string {
  if (status === 401 || status === 403) return `API Key 认证失败（HTTP ${status}）。`;
  if (status >= 300 && status < 400) return `模型目录重定向被安全策略阻止（HTTP ${status}）。`;
  return `模型目录请求失败（HTTP ${status}）。`;
}

function normalizeModelId(value: string, googleShape: boolean): string {
  const normalized = value.trim();
  return googleShape && normalized.startsWith("models/") ? normalized.slice("models/".length) : normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedOptionalString(value: string | undefined, maximum: number): string | undefined {
  return value && value.length <= maximum ? value : undefined;
}

function boundedPositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error("Provider discovery limits must be positive integers.");
  return Math.floor(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class CatalogResponseTooLargeError extends Error {}
