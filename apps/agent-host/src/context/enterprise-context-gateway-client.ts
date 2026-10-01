import type {
  EnterpriseProjectSummary,
  EnterpriseTeamSummary,
  EnterpriseWorkspaceBinding,
  ExperienceMethodSummary,
  SharedExperienceDetail,
  SharedExperienceSearchItem,
  SharedSopDetail,
  SharedSopSearchItem
} from "@pi67/domain";
import type { EnterpriseAccessCredential, EnterpriseDeviceAuthorization } from "@pi67/protocol";
import { parseScopeAuthorization } from "./enterprise-scope-authorization.js";
import { readKnowledgeSyncResponse, type KnowledgeSyncResponse } from "./enterprise-knowledge-sync-transport.js";
import type { KnowledgeSyncExpectation } from "./enterprise-knowledge-sync-page.js";
import { requestNewMoney } from "./new-money-http.js";
import {
  asRecord,
  boundedInteger,
  boundedString,
  invalidResponse,
  parseTeamSummary,
  parseTimestamp,
  secureUrl
} from "./enterprise-context-gateway-validation.js";
import {
  parseSharedExperienceDetail,
  parseSharedExperienceSearchResponse,
  parseSharedSopDetail,
  parseSharedSopSearchResponse
} from "./enterprise-context-gateway-shared-knowledge.js";

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
  method: ExperienceMethodSummary;
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

export class EnterpriseContextGatewayClient {
  readonly #rootBase: string;
  readonly #apiBase: string;

  constructor(
    readonly endpoint: string,
    private readonly accessToken?: string
  ) {
    this.#rootBase = endpoint.replace(/\/+$/u, "");
    this.#apiBase = `${this.#rootBase}/v1/agent`;
  }

  async startDeviceAuthorization(): Promise<EnterpriseDeviceAuthorization & { deviceSecret: string }> {
    const value = await this.#request("/device-authorizations", {
      method: "POST",
      body: JSON.stringify({ deviceLabel: "New Money Desktop" })
    });
    const record = asRecord(value);
    const expiresAt = parseTimestamp(record.expiresAt, "expiresAt");
    return {
      authorizationId: boundedString(record.authorizationId, "authorizationId"),
      deviceSecret: boundedString(record.deviceCode, "deviceCode", 512),
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
      { method: "POST", body: JSON.stringify({ deviceCode: deviceSecret }) }
    );
    const record = asRecord(value);
    if (record.state === "pending") return { state: "pending" };
    return {
      state: "signed-in",
      credential: credentialFromSession(record, this.endpoint)
    };
  }

  async refreshCredential(refreshToken: string): Promise<EnterpriseAccessCredential> {
    const value = await this.#requestRoot("/v1/auth/sessions/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken })
    });
    return credentialFromSession(asRecord(value), this.endpoint);
  }

  async revokeSession(): Promise<void> {
    await this.#requestRoot("/v1/auth/sessions/current", { method: "DELETE" });
  }

  async readProfile(): Promise<{ userId: string; displayName: string }> {
    const record = asRecord(await this.#request("/identity", { method: "GET", cache: "no-store" }));
    const user = asRecord(record.user);
    return { userId: boundedString(user.id, "user.id"),
      displayName: boundedString(user.displayName, "user.displayName", 80) };
  }

  async listTeams(): Promise<EnterpriseTeamSummary[]> {
    const value = asRecord(await this.#request("/teams", { method: "GET" }));
    if (!Array.isArray(value.teams) || value.teams.length > 1_000) throw invalidResponse("teams");
    return value.teams.map(parseTeamSummary);
  }

  async listProjects(teamId: string): Promise<EnterpriseProjectSummary[]> {
    const value = asRecord(await this.#request(
      `/teams/${encodeURIComponent(teamId)}/projects`,
      { method: "GET" }
    ));
    if (!Array.isArray(value.projects) || value.projects.length > 1_000) {
      throw invalidResponse("projects");
    }
    return value.projects.map((item) => {
      const record = asRecord(item);
      const status = record.status;
      if (status !== "active" && status !== "archived") throw invalidResponse("project.status");
      return {
        id: boundedString(record.id, "project.id"),
        accountId: boundedString(record.teamId, "project.teamId"),
        name: boundedString(record.name, "project.name", 512),
        slug: boundedString(record.id, "project.id", 128),
        status,
        bindingCount: 0,
        candidateCount: 0,
        sharedAssetCount: 0,
        updatedAt: parseTimestamp(record.updatedAt, "project.updatedAt")
      };
    });
  }

  async bindWorkspace(
    teamId: string,
    projectId: string,
    workspaceFingerprint: string,
    _idempotencyKey: string
  ): Promise<WorkspaceBindingPayload> {
    const value = asRecord(await this.#request(
      `/teams/${encodeURIComponent(teamId)}/workspace-bindings/current`,
      {
        method: "PUT",
        body: JSON.stringify({ workspaceId: workspaceFingerprint, projectId })
      }
    ));
    return {
      state: "bound",
      workspaceId: boundedString(value.workspaceId, "binding.workspaceId"),
      enterpriseProjectId: boundedString(value.projectId, "binding.projectId"),
      enterpriseProjectName: boundedString(value.projectName, "binding.projectName", 512),
      accountId: boundedString(value.teamId, "binding.teamId"),
      boundAt: parseTimestamp(value.updatedAt, "binding.updatedAt")
    };
  }

  async getWorkspaceBinding(
    teamId: string,
    workspaceFingerprint: string
  ): Promise<WorkspaceBindingPayload | undefined> {
    const response = await this.#request(
      `/teams/${encodeURIComponent(teamId)}/workspace-bindings/current?workspaceId=${encodeURIComponent(workspaceFingerprint)}`,
      { method: "GET" }
    );
    if (response === null) return undefined;
    const value = asRecord(response);
    return {
      state: "bound",
      workspaceId: boundedString(value.workspaceId, "binding.workspaceId"),
      enterpriseProjectId: boundedString(value.projectId, "binding.projectId"),
      enterpriseProjectName: boundedString(value.projectName, "binding.projectName", 512),
      accountId: boundedString(value.teamId, "binding.teamId"),
      boundAt: parseTimestamp(value.updatedAt, "binding.updatedAt")
    };
  }

  async createExperienceCandidate(
    teamId: string,
    input: EnterpriseCandidateSubmissionInput
  ): Promise<EnterpriseCandidateSubmissionReceipt> {
    const value = asRecord(await this.#request(
      `/teams/${encodeURIComponent(teamId)}/candidates`,
      {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: input.idempotencyKey,
          projectId: input.projectId,
          kind: "experience",
          title: input.title,
          summary: input.strategy.slice(0, 2_000),
          content: JSON.stringify(input)
        })
      }
    ));
    if (value.status !== "pending") throw invalidResponse("candidate.status");
    const createdAt = parseTimestamp(value.createdAt, "candidate.createdAt");
    return {
      id: boundedString(value.id, "candidate.id"),
      status: "candidate",
      createdAt,
      updatedAt: createdAt
    };
  }

  async searchSharedExperiences(
    teamId: string,
    projectId: string,
    query: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<SharedExperienceSearchItem[]> {
    const value = await this.#request(
      `/teams/${encodeURIComponent(teamId)}/shared-assets/search`,
      {
        method: "POST",
        body: JSON.stringify({ projectId, kind: "experience", query, limit }),
        ...(signal === undefined ? {} : { signal })
      }
    );
    return parseSharedExperienceSearchResponse(value);
  }

  async getSharedExperience(
    teamId: string,
    assetId: string,
    signal?: AbortSignal
  ): Promise<SharedExperienceDetail> {
    const value = await this.#request(
      `/teams/${encodeURIComponent(teamId)}/shared-assets/${encodeURIComponent(assetId)}`,
      { method: "GET", ...(signal === undefined ? {} : { signal }) }
    );
    return parseSharedExperienceDetail(value);
  }

  async searchSharedSops(
    teamId: string,
    projectId: string,
    query: string,
    limit = 1,
    signal?: AbortSignal
  ): Promise<SharedSopSearchItem[]> {
    const value = await this.#request(
      `/teams/${encodeURIComponent(teamId)}/shared-assets/search`,
      {
        method: "POST",
        body: JSON.stringify({
          projectId,
          kind: "sop",
          query,
          limit: Math.max(1, Math.min(2, Math.floor(limit)))
        }),
        ...(signal === undefined ? {} : { signal })
      }
    );
    return parseSharedSopSearchResponse(value);
  }

  async getSharedSop(
    teamId: string,
    assetId: string,
    signal?: AbortSignal
  ): Promise<SharedSopDetail> {
    const value = await this.#request(
      `/teams/${encodeURIComponent(teamId)}/shared-assets/${encodeURIComponent(assetId)}`,
      { method: "GET", ...(signal === undefined ? {} : { signal }) }
    );
    return parseSharedSopDetail(value);
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

  async authorizeProject(userId: string, teamId: string, projectId: string, signal?: AbortSignal) {
    const startedAt = Date.now(), startedMonotonic = performance.now();
    const value = await this.#request(`/teams/${encodeURIComponent(teamId)}/projects/${encodeURIComponent(projectId)}/authorization`, {
      method: "GET", ...(signal === undefined ? {} : { signal })
    });
    return parseScopeAuthorization(value, { userId, teamId, projectId }, startedAt, startedMonotonic);
  }
  async authorizeTeam(userId: string, teamId: string, signal?: AbortSignal) {
    const startedAt = Date.now(), startedMonotonic = performance.now();
    const value = await this.#request(`/teams/${encodeURIComponent(teamId)}/authorization`, {
      method: "GET", ...(signal === undefined ? {} : { signal })
    });
    return parseScopeAuthorization(value, { userId, teamId, projectId: null }, startedAt, startedMonotonic);
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    return this.#requestUrl(`${this.#apiBase}${path}`, init);
  }

  async syncKnowledge(expected: KnowledgeSyncExpectation, signal?: AbortSignal): Promise<KnowledgeSyncResponse> {
    const scope = { ...expected };
    const base = `/teams/${encodeURIComponent(scope.teamId)}`;
    const path = scope.scopeKind === "team" ? `${base}/shared-assets/sync`
      : `${base}/projects/${encodeURIComponent(scope.scopeId)}/shared-assets/sync`;
    const query = new URLSearchParams({ cursor: scope.cursor, limit: String(scope.limit) });
    if (scope.epoch !== null) query.set("epoch", scope.epoch);
    // The private reader supplies this type only after the trust-boundary decoder.
    return await this.#requestUrl(`${this.#apiBase}${path}?${query}`, {
      method: "GET", ...(signal === undefined ? {} : { signal })
    }, (response, requestSignal) => readKnowledgeSyncResponse(response, scope, requestSignal)) as KnowledgeSyncResponse;
  }

  async #requestRoot(path: string, init: RequestInit): Promise<unknown> {
    return this.#requestUrl(`${this.#rootBase}${path}`, init);
  }

  async #requestUrl(url: string, init: RequestInit, readResponse?: (response: Response, signal: AbortSignal) => Promise<unknown>): Promise<unknown> {
    return requestNewMoney(url, init, {
      ...(this.accessToken === undefined ? {} : { accessToken: this.accessToken }),
      ...(readResponse === undefined ? {} : { readResponse })
    });
  }
}

function credentialFromSession(
  record: Record<string, unknown>,
  endpoint: string
): EnterpriseAccessCredential {
  const user = asRecord(record.user);
  return {
    endpoint,
    accessToken: boundedString(record.accessToken, "accessToken", 16_384),
    refreshToken: boundedString(record.refreshToken, "refreshToken", 16_384),
    accountId: boundedString(record.activeTeamId, "activeTeamId"),
    userId: boundedString(user.id, "user.id"),
    ...(user.displayName === null || user.displayName === undefined
      ? {}
      : { displayName: boundedString(user.displayName, "user.displayName", 512) }),
    expiresAt: parseTimestamp(record.expiresAt, "expiresAt")
  };
}
