import type {
  EnterpriseProjectSummary,
  EnterpriseWorkspaceBinding,
  SharedExperienceDetail,
  SharedExperienceSearchItem
} from "@pi67/domain";
import type { EnterpriseAccessCredential, EnterpriseDeviceAuthorization } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";

interface DeviceAuthorizationExchange {
  state: "pending" | "signed-in";
  credential?: EnterpriseAccessCredential;
}

interface WorkspaceBindingPayload {
  state: "bound";
  workspaceId: string;
  enterpriseProjectId: string;
  enterpriseProjectName: string;
  accountId: string;
  boundAt: number;
}

export interface EnterpriseCandidateSubmissionInput {
  idempotencyKey: string;
  projectId: string;
  workspaceFingerprint: string;
  sourceSessionIdHash: string;
  candidateKind: "experience";
  taskType: string;
  title: string;
  problem: string;
  strategy: string;
  result: "success";
  confidence: number;
  sensitivity: "project" | "team" | "company";
  applicableWhen: string[];
  notApplicableWhen: string[];
  evidence: Array<{
    kind: "test" | "tool-result" | "user-confirmation" | "artifact";
    label: string;
    hash: string;
    verifiedAt: string;
  }>;
  redactionStatus: "passed";
}

export interface EnterpriseCandidateSubmissionReceipt {
  id: string;
  status: "candidate" | "validated" | "approved" | "publishing" | "shared" | "failed" | "rejected" | "revoked";
  createdAt: number;
  updatedAt: number;
}

const REQUEST_TIMEOUT_MS = 8_000;

export class EnterpriseContextGatewayClient {
  readonly #apiBase: string;

  constructor(
    readonly endpoint: string,
    private readonly accessToken?: string
  ) {
    this.#apiBase = `${endpoint.replace(/\/+$/u, "")}/v1/agent`;
  }

  async startDeviceAuthorization(): Promise<EnterpriseDeviceAuthorization & { deviceSecret: string }> {
    const value = await this.#request("/device-authorizations", {
      method: "POST",
      body: JSON.stringify({ clientName: "Pi-67 Desktop" })
    });
    const record = asRecord(value);
    const expiresAt = parseTimestamp(record.expiresAt, "expiresAt");
    return {
      authorizationId: boundedString(record.authorizationId, "authorizationId"),
      deviceSecret: lowercaseSha256(record.deviceSecret, "deviceSecret"),
      verificationUri: secureUrl(record.verificationUri, "verificationUri"),
      userCode: boundedString(record.userCode, "userCode", 64),
      expiresAt,
      intervalSeconds: boundedInteger(record.intervalSeconds, "intervalSeconds", 1, 300)
    };
  }

  async exchangeDeviceAuthorization(
    authorizationId: string,
    deviceSecret: string
  ): Promise<DeviceAuthorizationExchange> {
    const value = await this.#request(
      `/device-authorizations/${encodeURIComponent(authorizationId)}/exchange`,
      { method: "POST", body: JSON.stringify({ deviceSecret }) }
    );
    const record = asRecord(value);
    const state = record.state;
    if (state === "pending") return { state };
    if (state !== "signed-in") throw invalidResponse("state");
    return {
      state,
      credential: {
        endpoint: this.endpoint,
        accessToken: boundedString(record.accessToken, "accessToken", 16_384),
        accountId: boundedString(record.accountId, "accountId"),
        userId: boundedString(record.userId, "userId"),
        ...(record.displayName === null || record.displayName === undefined
          ? {}
          : { displayName: boundedString(record.displayName, "displayName", 512) }),
        expiresAt: parseTimestamp(record.expiresAt, "expiresAt")
      }
    };
  }

  async listProjects(): Promise<EnterpriseProjectSummary[]> {
    const value = asRecord(await this.#request("/projects", { method: "GET" }));
    if (!Array.isArray(value.items) || value.items.length > 1_000) throw invalidResponse("items");
    return value.items.map((item) => {
      const record = asRecord(item);
      const status = record.status;
      if (status !== "active" && status !== "archived") throw invalidResponse("project.status");
      return {
        id: boundedString(record.id, "project.id"),
        accountId: boundedString(record.accountId, "project.accountId"),
        name: boundedString(record.name, "project.name", 512),
        slug: boundedString(record.slug, "project.slug", 128),
        status,
        bindingCount: boundedInteger(record.bindingCount, "project.bindingCount", 0),
        candidateCount: boundedInteger(record.candidateCount, "project.candidateCount", 0),
        sharedAssetCount: boundedInteger(record.sharedAssetCount, "project.sharedAssetCount", 0),
        updatedAt: parseTimestamp(record.updatedAt, "project.updatedAt")
      };
    });
  }

  async bindWorkspace(
    projectId: string,
    workspaceFingerprint: string,
    idempotencyKey: string
  ): Promise<WorkspaceBindingPayload> {
    const value = asRecord(await this.#request(
      `/projects/${encodeURIComponent(projectId)}/bindings`,
      {
        method: "POST",
        body: JSON.stringify({ workspaceFingerprint, idempotencyKey })
      }
    ));
    if (value.state !== "bound") throw invalidResponse("binding.state");
    return {
      state: "bound",
      workspaceId: boundedString(value.workspaceId, "binding.workspaceId"),
      enterpriseProjectId: boundedString(value.enterpriseProjectId, "binding.enterpriseProjectId"),
      enterpriseProjectName: boundedString(value.enterpriseProjectName, "binding.enterpriseProjectName", 512),
      accountId: boundedString(value.accountId, "binding.accountId"),
      boundAt: parseTimestamp(value.boundAt, "binding.boundAt")
    };
  }

  async getWorkspaceBinding(
    workspaceFingerprint: string
  ): Promise<WorkspaceBindingPayload | undefined> {
    const value = asRecord(await this.#request(
      `/workspace-bindings/current?workspaceFingerprint=${encodeURIComponent(workspaceFingerprint)}`,
      { method: "GET" }
    ));
    if (value.state === "unbound") return undefined;
    if (value.state !== "bound") throw invalidResponse("binding.state");
    return {
      state: "bound",
      workspaceId: boundedString(value.workspaceId, "binding.workspaceId"),
      enterpriseProjectId: boundedString(value.enterpriseProjectId, "binding.enterpriseProjectId"),
      enterpriseProjectName: boundedString(value.enterpriseProjectName, "binding.enterpriseProjectName", 512),
      accountId: boundedString(value.accountId, "binding.accountId"),
      boundAt: parseTimestamp(value.boundAt, "binding.boundAt")
    };
  }

  async createExperienceCandidate(
    input: EnterpriseCandidateSubmissionInput
  ): Promise<EnterpriseCandidateSubmissionReceipt> {
    const value = asRecord(await this.#request("/candidates", {
      method: "POST",
      body: JSON.stringify(input)
    }));
    const status = value.status;
    if (!isCandidateStatus(status)) throw invalidResponse("candidate.status");
    return {
      id: boundedString(value.id, "candidate.id"),
      status,
      createdAt: parseTimestamp(value.createdAt, "candidate.createdAt"),
      updatedAt: parseTimestamp(value.updatedAt, "candidate.updatedAt")
    };
  }

  async searchSharedExperiences(
    workspaceFingerprint: string,
    query: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<SharedExperienceSearchItem[]> {
    const value = asRecord(await this.#request("/shared-experiences/search", {
      method: "POST",
      body: JSON.stringify({ workspaceFingerprint, query, limit }),
      ...(signal === undefined ? {} : { signal })
    }));
    if (!Array.isArray(value.items) || value.items.length > 5) throw invalidResponse("shared.items");
    return value.items.map((item) => {
      const record = asRecord(item);
      return {
        id: boundedString(record.id, "shared.id"),
        projectId: boundedString(record.projectId, "shared.projectId"),
        title: boundedString(record.title, "shared.title", 512),
        taskType: boundedString(record.taskType, "shared.taskType", 256),
        summary: boundedOptionalString(record.summary, "shared.summary", 8_192),
        score: boundedNumber(record.score, "shared.score", 0, 1),
        applicableWhen: boundedStringArray(record.applicableWhen, "shared.applicableWhen"),
        notApplicableWhen: boundedStringArray(record.notApplicableWhen, "shared.notApplicableWhen"),
        externalRevision: lowercaseSha256(record.externalRevision, "shared.externalRevision"),
        publishedAt: parseTimestamp(record.publishedAt, "shared.publishedAt")
      };
    });
  }

  async getSharedExperience(
    workspaceFingerprint: string,
    assetId: string,
    signal?: AbortSignal
  ): Promise<SharedExperienceDetail> {
    const value = asRecord(await this.#request(
      `/shared-experiences/${encodeURIComponent(assetId)}?workspaceFingerprint=${encodeURIComponent(workspaceFingerprint)}`,
      { method: "GET", ...(signal === undefined ? {} : { signal }) }
    ));
    const result = value.result;
    if (result !== "success" && result !== "partial" && result !== "failed" && result !== "rolled-back") {
      throw invalidResponse("shared.result");
    }
    const sensitivity = value.sensitivity;
    if (sensitivity !== "project" && sensitivity !== "team" && sensitivity !== "company") {
      throw invalidResponse("shared.sensitivity");
    }
    if (!Array.isArray(value.evidence) || value.evidence.length > 64) {
      throw invalidResponse("shared.evidence");
    }
    return {
      id: boundedString(value.id, "shared.id"),
      projectId: boundedString(value.projectId, "shared.projectId"),
      title: boundedString(value.title, "shared.title", 512),
      taskType: boundedString(value.taskType, "shared.taskType", 256),
      problem: boundedString(value.problem, "shared.problem", 8_192),
      strategy: boundedString(value.strategy, "shared.strategy", 16_384),
      result,
      confidence: boundedNumber(value.confidence, "shared.confidence", 0, 1),
      sensitivity,
      applicableWhen: boundedStringArray(value.applicableWhen, "shared.applicableWhen"),
      notApplicableWhen: boundedStringArray(value.notApplicableWhen, "shared.notApplicableWhen"),
      evidence: value.evidence.map((item) => {
        const evidence = asRecord(item);
        const kind = evidence.kind;
        if (kind !== "test" && kind !== "tool-result" && kind !== "user-confirmation" && kind !== "artifact") {
          throw invalidResponse("shared.evidence.kind");
        }
        return {
          kind,
          label: boundedString(evidence.label, "shared.evidence.label", 512),
          reference: `sha256:${lowercaseSha256(evidence.hash, "shared.evidence.hash")}`,
          verifiedAt: parseTimestamp(evidence.verifiedAt, "shared.evidence.verifiedAt")
        };
      }),
      externalRevision: lowercaseSha256(value.externalRevision, "shared.externalRevision"),
      publishedAt: parseTimestamp(value.publishedAt, "shared.publishedAt")
    };
  }

  toDesktopBinding(localWorkspaceId: string, binding: WorkspaceBindingPayload): EnterpriseWorkspaceBinding {
    return {
      state: "bound",
      workspaceId: localWorkspaceId,
      enterpriseProjectId: binding.enterpriseProjectId,
      enterpriseProjectName: binding.enterpriseProjectName,
      accountId: binding.accountId,
      boundAt: binding.boundAt
    };
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const callerSignal = init.signal;
    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      if (init.body !== undefined) headers.set("Content-Type", "application/json");
      if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
      const response = await fetch(`${this.#apiBase}${path}`, {
        ...init,
        headers,
        redirect: "error",
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new HostCommandError(
          "RUNTIME_NOT_READY",
          response.status === 401
            ? "Enterprise sign-in expired or was rejected."
            : response.status === 403
              ? "The enterprise account does not have permission for this operation."
              : `Enterprise Context Gateway request failed (${response.status}).`,
          response.status >= 500 || response.status === 408 || response.status === 429
        );
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw invalidResponse("json");
      }
    } catch (error) {
      if (error instanceof HostCommandError) throw error;
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        error instanceof Error && error.name === "AbortError"
          ? "Enterprise Context Gateway request timed out."
          : "Enterprise Context Gateway is unavailable.",
        true
      );
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidResponse("object");
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, field: string, maximum = 2_048): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw invalidResponse(field);
  return value;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidResponse(field);
  }
  return value as number;
}

function boundedNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidResponse(field);
  }
  return value;
}

function boundedOptionalString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) throw invalidResponse(field);
  return value;
}

function boundedStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 64) throw invalidResponse(field);
  return value.map((item, index) => boundedString(item, `${field}.${index}`, 2_048));
}

function lowercaseSha256(value: unknown, field: string): string {
  const candidate = boundedString(value, field, 64);
  if (!/^[a-f0-9]{64}$/u.test(candidate)) throw invalidResponse(field);
  return candidate;
}

function isCandidateStatus(
  value: unknown
): value is EnterpriseCandidateSubmissionReceipt["status"] {
  return value === "candidate"
    || value === "validated"
    || value === "approved"
    || value === "publishing"
    || value === "shared"
    || value === "failed"
    || value === "rejected"
    || value === "revoked";
}

function parseTimestamp(value: unknown, field: string): number {
  if (typeof value !== "string") throw invalidResponse(field);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) throw invalidResponse(field);
  return timestamp;
}

function secureUrl(value: unknown, field: string): string {
  const candidate = boundedString(value, field);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw invalidResponse(field);
  }
  if (url.username || url.password || (url.protocol !== "https:" && !isLoopbackHttp(url))) {
    throw invalidResponse(field);
  }
  return candidate;
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
}

function invalidResponse(field: string): HostCommandError {
  return new HostCommandError(
    "INVALID_PAYLOAD",
    `Enterprise Context Gateway returned an invalid ${field} field.`,
    false
  );
}
