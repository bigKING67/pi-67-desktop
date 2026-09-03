import { createHash } from "node:crypto";
import type {
  ContextMemoryConfiguration,
  ExperienceCandidateSummary,
  EnterpriseIdentityStatus,
  EnterpriseProjectSummary,
  EnterpriseWorkspaceBinding,
  SharedExperienceDetail,
  SharedExperienceSearchItem,
  SharedSopDetail,
  SharedSopSearchItem
} from "@pi67/domain";
import { enterpriseCandidateEligibility, experienceMethodComplete } from "@pi67/domain";
import type { CommandResults } from "@pi67/protocol";
import type { HostEventChannel } from "../host-event-channel.js";
import { HostCommandError } from "../protocol-error.js";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";
import { appContextAuthority } from "./context-memory-support.js";
import type { ContextMemoryConfigurationStore } from "./context-memory-configuration.js";
import type { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import type { EnterpriseCandidateSubmissionReceipt } from "./enterprise-context-gateway-client.js";
import { validateEnterpriseExperienceMethod } from "./experience-enterprise-method.js";
import type { RecallObservationStore } from "./recall-observation-store.js";

interface PendingEnterpriseAuthorization {
  endpoint: string;
  deviceSecret: string;
  expiresAt: number;
}

export class EnterpriseContextController {
  private identity: EnterpriseIdentityStatus = { state: "signed-out" };
  private readonly workspaceBindings = new Map<string, EnterpriseWorkspaceBinding>();
  private readonly pendingAuthorizations = new Map<string, PendingEnterpriseAuthorization>();

  constructor(
    private readonly configuration: ContextMemoryConfigurationStore,
    private readonly workspaces: WorkspaceContextRegistry,
    private readonly events: HostEventChannel,
    private readonly credentials?: EnterpriseCredentialBrokerClient,
    private readonly recall?: RecallObservationStore
  ) {}

  shutdown(): void {
    this.credentials?.shutdown();
  }

  currentIdentity(): EnterpriseIdentityStatus {
    const credential = this.credentials?.snapshot().credential;
    if (!credential) return this.identity;
    if (credential.expiresAt <= Date.now()) {
      this.identity = {
        state: "expired",
        accountId: credential.accountId,
        userId: credential.userId,
        ...(credential.displayName === undefined ? {} : { displayName: credential.displayName }),
        expiresAt: credential.expiresAt
      };
      return this.identity;
    }
    this.identity = identityForCredential(credential);
    return this.identity;
  }

  async beginAuthorization(): Promise<CommandResults["enterprise.auth.begin"]> {
    const configuration = await this.configuration.read();
    const endpoint = configuration.enterpriseGatewayEndpoint;
    if (!endpoint) {
      throw new HostCommandError(
        "UNSUPPORTED",
        "Configure the Enterprise Context Gateway endpoint before signing in.",
        true
      );
    }
    if (this.credentials?.snapshot().storage !== "available") {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "System secure storage is unavailable; enterprise sign-in is disabled.",
        true
      );
    }
    const authorization = await new EnterpriseContextGatewayClient(endpoint)
      .startDeviceAuthorization();
    this.pendingAuthorizations.set(authorization.authorizationId, {
      endpoint,
      deviceSecret: authorization.deviceSecret,
      expiresAt: authorization.expiresAt
    });
    this.identity = { state: "pending", expiresAt: authorization.expiresAt };
    this.emitIdentity();
    return {
      authorizationId: authorization.authorizationId,
      verificationUri: authorization.verificationUri,
      userCode: authorization.userCode,
      expiresAt: authorization.expiresAt,
      intervalSeconds: authorization.intervalSeconds
    };
  }

  async pollAuthorization(
    authorizationId: string
  ): Promise<CommandResults["enterprise.auth.poll"]> {
    const pending = this.pendingAuthorizations.get(authorizationId);
    if (!pending) return this.currentIdentity();
    if (pending.expiresAt <= Date.now()) {
      this.pendingAuthorizations.delete(authorizationId);
      this.identity = { state: "expired", expiresAt: pending.expiresAt };
      this.emitIdentity();
      return this.identity;
    }
    const exchange = await new EnterpriseContextGatewayClient(pending.endpoint)
      .exchangeDeviceAuthorization(authorizationId, pending.deviceSecret);
    if (exchange.state === "pending" || !exchange.credential) return this.identity;
    await this.credentials!.store(exchange.credential);
    this.pendingAuthorizations.delete(authorizationId);
    this.identity = identityForCredential(exchange.credential);
    this.emitIdentity();
    return this.identity;
  }

  async disconnect(): Promise<EnterpriseIdentityStatus> {
    await this.credentials?.clear();
    this.identity = { state: "signed-out" };
    this.pendingAuthorizations.clear();
    this.workspaceBindings.clear();
    this.emitIdentity();
    return this.identity;
  }

  async listProjects(): Promise<{ items: EnterpriseProjectSummary[]; total: number }> {
    const configuration = await this.configuration.read();
    const credential = this.requireCredential(configuration);
    const items = await new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).listProjects();
    return { items, total: items.length };
  }

  async getWorkspaceBinding(workspaceId: string): Promise<EnterpriseWorkspaceBinding> {
    const cached = this.workspaceBindings.get(workspaceId);
    if (cached) return cached;
    const configuration = await this.configuration.read();
    const credential = this.credentials?.snapshot().credential;
    if (
      !credential
      || credential.expiresAt <= Date.now()
      || !configuration.enterpriseGatewayEndpoint
      || credential.endpoint !== configuration.enterpriseGatewayEndpoint
    ) return { state: "unbound", workspaceId };
    const gateway = new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    );
    const remote = await gateway.getWorkspaceBinding(workspaceFingerprint(workspaceId));
    const binding = remote
      ? gateway.toDesktopBinding(workspaceId, remote)
      : { state: "unbound" as const, workspaceId };
    this.workspaceBindings.set(workspaceId, binding);
    return binding;
  }

  async bindWorkspace(
    workspaceId: string,
    enterpriseProjectId: string,
    idempotencyKey: string
  ): Promise<EnterpriseWorkspaceBinding> {
    const configuration = await this.configuration.read();
    const credential = this.requireCredential(configuration);
    const workspace = this.workspaces.require(workspaceId);
    if (workspace.initialization.trust !== "trusted") {
      throw new HostCommandError(
        "WORKSPACE_NOT_TRUSTED",
        "Trust this Workspace before binding it to an enterprise project.",
        true
      );
    }
    const gateway = new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    );
    const binding = gateway.toDesktopBinding(
      workspaceId,
      await gateway.bindWorkspace(
        enterpriseProjectId,
        workspaceFingerprint(workspaceId),
        idempotencyKey
      )
    );
    this.workspaceBindings.set(workspaceId, binding);
    this.events.sendFor({
      type: "enterprise.workspaceBindingChanged",
      payload: binding
    }, {
      runtime: undefined,
      operations: undefined,
      context: { scope: "workspace", workspaceId }
    });
    return binding;
  }

  async submitExperienceCandidate(input: {
    workspaceId: string;
    candidate: ExperienceCandidateSummary;
    workspaceFingerprint: string;
    sourceSessionIdHash: string;
    idempotencyKey: string;
  }): Promise<EnterpriseCandidateSubmissionReceipt> {
    const configuration = await this.configuration.read();
    const credential = this.requireCredential(configuration);
    const workspace = this.workspaces.require(input.workspaceId);
    const binding = await this.getWorkspaceBinding(input.workspaceId);
    const eligibility = enterpriseCandidateEligibility({
      identity: this.currentIdentity(),
      workspace: binding,
      privacyMode: configuration.defaultPrivacyMode,
      workspaceTrusted: workspace.initialization.trust === "trusted",
      result: input.candidate.result,
      evidenceCount: input.candidate.evidence.length,
      redactionStatus: input.candidate.redactionStatus,
      sensitivity: input.candidate.sensitivity,
      methodComplete: experienceMethodComplete(input.candidate.method)
    });
    if (!eligibility.eligible) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        `The Experience candidate is not eligible for enterprise review: ${eligibility.reasons.join(", ")}.`,
        true
      );
    }
    if (
      binding.state !== "bound"
      || !binding.enterpriseProjectId
      || input.workspaceFingerprint !== workspaceFingerprint(input.workspaceId)
      || input.candidate.result !== "success"
      || input.candidate.redactionStatus !== "passed"
      || input.candidate.sensitivity === "private"
    ) {
      throw new HostCommandError("INVALID_PAYLOAD", "The Experience candidate source binding is invalid.", false);
    }
    return new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).createExperienceCandidate({
      idempotencyKey: input.idempotencyKey,
      projectId: binding.enterpriseProjectId,
      workspaceFingerprint: input.workspaceFingerprint,
      sourceSessionIdHash: input.sourceSessionIdHash,
      candidateKind: "experience",
      taskType: input.candidate.taskType,
      title: input.candidate.title,
      problem: input.candidate.problem,
      strategy: input.candidate.strategy,
      method: validateEnterpriseExperienceMethod(input.candidate.method),
      result: input.candidate.result,
      confidence: input.candidate.confidence,
      sensitivity: input.candidate.sensitivity,
      applicableWhen: input.candidate.applicableWhen,
      notApplicableWhen: input.candidate.notApplicableWhen,
      evidence: input.candidate.evidence.map((item) => ({
        kind: item.kind,
        label: item.label,
        hash: evidenceHash(item.reference),
        verifiedAt: new Date(item.verifiedAt).toISOString()
      })),
      redactionStatus: input.candidate.redactionStatus
    });
  }

  async searchSharedExperiences(
    workspaceId: string,
    query: string,
    requestedLimit?: number,
    signal?: AbortSignal
  ): Promise<{ items: SharedExperienceSearchItem[]; total: number }> {
    const configuration = await this.configuration.read();
    if (configuration.sharedExperienceLimit <= 0) return { items: [], total: 0 };
    const credential = this.requireCredential(configuration);
    const binding = await this.requireBoundWorkspace(workspaceId);
    const limit = Math.min(
      configuration.sharedExperienceLimit,
      Math.max(1, Math.floor(requestedLimit ?? configuration.sharedExperienceLimit)),
      5
    );
    const startedAt = Date.now();
    const serverLimit = Math.min(5, limit + 2);
    const candidates = await new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).searchSharedExperiences(workspaceFingerprint(workspaceId), query, serverLimit, signal);
    if (candidates.some((item) => item.projectId !== binding.enterpriseProjectId)) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "Enterprise Context Gateway returned a shared Experience outside the bound project.",
        false
      );
    }
    const items = (this.recall
      ? await this.recall.applyEnterpriseFeedback(workspaceId, "enterprise-experience", candidates)
      : candidates).slice(0, limit);
    await this.recall?.recordEnterprise({
      workspaceId,
      query,
      route: "enterprise-experience",
      durationMs: Date.now() - startedAt,
      candidateCount: candidates.length,
      items
    });
    return { items, total: items.length };
  }

  async getSharedExperience(
    workspaceId: string,
    assetId: string,
    signal?: AbortSignal
  ): Promise<SharedExperienceDetail> {
    const configuration = await this.configuration.read();
    const credential = this.requireCredential(configuration);
    const binding = await this.requireBoundWorkspace(workspaceId);
    const item = await new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).getSharedExperience(workspaceFingerprint(workspaceId), assetId, signal);
    if (item.projectId !== binding.enterpriseProjectId) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "Enterprise Context Gateway returned a shared Experience outside the bound project.",
        false
      );
    }
    return item;
  }

  async searchSharedSops(
    workspaceId: string,
    query: string,
    signal?: AbortSignal
  ): Promise<{ items: SharedSopSearchItem[]; total: number }> {
    const configuration = await this.configuration.read();
    const credential = this.requireCredential(configuration);
    const binding = await this.requireBoundWorkspace(workspaceId);
    const startedAt = Date.now();
    const candidates = await new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).searchSharedSops(workspaceFingerprint(workspaceId), query, 2, signal);
    if (candidates.length > 2 || candidates.some((item) => item.projectId !== binding.enterpriseProjectId)) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "Enterprise Context Gateway returned an invalid SOP set for the bound project.",
        false
      );
    }
    const items = (this.recall
      ? await this.recall.applyEnterpriseFeedback(workspaceId, "enterprise-sop", candidates)
      : candidates).slice(0, 1);
    await this.recall?.recordEnterprise({
      workspaceId,
      query,
      route: "enterprise-sop",
      durationMs: Date.now() - startedAt,
      candidateCount: candidates.length,
      items
    });
    return { items, total: items.length };
  }

  async getSharedSop(
    workspaceId: string,
    assetId: string,
    signal?: AbortSignal
  ): Promise<SharedSopDetail> {
    const configuration = await this.configuration.read();
    const credential = this.requireCredential(configuration);
    const binding = await this.requireBoundWorkspace(workspaceId);
    const item = await new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).getSharedSop(workspaceFingerprint(workspaceId), assetId, signal);
    if (item.projectId !== binding.enterpriseProjectId) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "Enterprise Context Gateway returned an SOP outside the bound project.",
        false
      );
    }
    return item;
  }

  private async requireBoundWorkspace(workspaceId: string): Promise<EnterpriseWorkspaceBinding & {
    state: "bound";
    enterpriseProjectId: string;
  }> {
    const binding = await this.getWorkspaceBinding(workspaceId);
    if (binding.state !== "bound" || !binding.enterpriseProjectId) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "Bind this Workspace to an enterprise project before searching shared enterprise knowledge.",
        true
      );
    }
    return binding as EnterpriseWorkspaceBinding & {
      state: "bound";
      enterpriseProjectId: string;
    };
  }

  private requireCredential(configuration: ContextMemoryConfiguration) {
    const credential = this.credentials?.snapshot().credential;
    if (!credential || credential.expiresAt <= Date.now()) {
      throw new HostCommandError("RUNTIME_NOT_READY", "Sign in to the enterprise Context Gateway first.", true);
    }
    if (!configuration.enterpriseGatewayEndpoint || credential.endpoint !== configuration.enterpriseGatewayEndpoint) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "The enterprise Gateway endpoint changed. Disconnect and sign in again.",
        true
      );
    }
    return credential;
  }

  private emitIdentity(): void {
    this.events.sendFor({ type: "enterprise.authChanged", payload: this.identity }, appContextAuthority());
  }
}

function workspaceFingerprint(workspaceId: string): string {
  return createHash("sha256").update(`pi67-workspace:${workspaceId}`).digest("hex");
}

function evidenceHash(reference: string): string {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(reference);
  if (!match) {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      "Enterprise evidence references must use sha256:<64 lowercase hex>.",
      false
    );
  }
  return match[1]!;
}

function identityForCredential(credential: {
  accountId: string;
  userId: string;
  displayName?: string;
  expiresAt: number;
}): EnterpriseIdentityStatus {
  return {
    state: "signed-in",
    accountId: credential.accountId,
    userId: credential.userId,
    ...(credential.displayName === undefined ? {} : { displayName: credential.displayName }),
    expiresAt: credential.expiresAt
  };
}
