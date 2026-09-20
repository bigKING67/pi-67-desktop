import { createHash } from "node:crypto";
import type {
  ExperienceCandidateSummary,
  EnterpriseIdentityStatus,
  EnterpriseProjectSummary,
  EnterpriseTeamSummary,
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
import { EnterpriseAuthorizationController } from "./enterprise-authorization-controller.js";
import type { ContextMemoryConfigurationStore } from "./context-memory-configuration.js";
import type { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import type { EnterpriseCandidateSubmissionReceipt } from "./enterprise-context-gateway-client.js";
import { validateEnterpriseExperienceMethod, enterpriseEvidenceHash } from "./experience-enterprise-method.js";
import type { RecallObservationStore } from "./recall-observation-store.js";
import { resolveSharedReadScope } from "./enterprise-shared-session-scope.js";
import { enterprisePowerEpoch } from "./enterprise-power-epoch.js";
import { assertSopUnexpired } from "./enterprise-context-gateway-shared-knowledge.js";

export class EnterpriseContextController {
  private readonly workspaceBindings = new Map<string, EnterpriseWorkspaceBinding>();
  private readonly authorization: EnterpriseAuthorizationController;
  private accessGeneration = 0;
  private readonly bindingGenerations = new Map<string, number>();

  constructor(
    private readonly configuration: ContextMemoryConfigurationStore,
    private readonly workspaces: WorkspaceContextRegistry,
    private readonly events: HostEventChannel,
    private readonly credentials?: EnterpriseCredentialBrokerClient,
    private readonly recall?: RecallObservationStore
  ) {
    this.authorization = new EnterpriseAuthorizationController(configuration, events, credentials);
  }

  shutdown(): void { this.invalidateAccess(); this.authorization.shutdown(); }
  async authorizeTeamSession(scope: import("@pi67/domain").TeamSessionScope, model?: { baseUrl: string; id: string }, signal?: AbortSignal) {
    const assertPower = enterprisePowerEpoch.capture();
    const generation = this.accessGeneration;
    const configuration = await this.configuration.read();
    const credential = await this.authorization.activeCredential(configuration);
    const lease = await new EnterpriseContextGatewayClient(configuration.enterpriseGatewayEndpoint, credential.accessToken)
      .authorizeProject(credential.userId, scope.teamId, scope.projectId, signal);
    const assertValid = () => {
      assertPower();
      if (generation !== this.accessGeneration) throw new Error("Team Session authorization changed during admission.");
      lease.assertValid();
      if (model !== undefined) lease.assertAgentModel(model);
    };
    assertValid();
    return { identity: { ...scope, userId: credential.userId, endpoint: configuration.enterpriseGatewayEndpoint }, assertValid };
  }
  currentIdentity(): EnterpriseIdentityStatus { return this.authorization.currentIdentity(); }
  refreshIdentity(): Promise<EnterpriseIdentityStatus> { return this.authorization.refreshIdentity(); }
  attachTeamModelChannel(...args: Parameters<EnterpriseAuthorizationController["attachTeamModelChannel"]>) {
    return this.authorization.attachTeamModelChannel(...args);
  }
  reserveTeamModelPort(...args: Parameters<EnterpriseAuthorizationController["reserveTeamModelPort"]>) { return this.authorization.reserveTeamModelPort(...args); }
  indexKnowledge(...args: Parameters<EnterpriseAuthorizationController["indexKnowledge"]>) { return this.authorization.indexKnowledge(...args); }
  embedKnowledgeQuery(...args: Parameters<EnterpriseAuthorizationController["embedKnowledgeQuery"]>) { return this.authorization.embedKnowledgeQuery(...args); }
  searchKnowledge(...args: Parameters<EnterpriseAuthorizationController["searchKnowledge"]>) { return this.authorization.searchKnowledge(...args); }
  readKnowledge(...args: Parameters<EnterpriseAuthorizationController["readKnowledge"]>) { return this.authorization.readKnowledge(...args); }
  searchSessionKnowledge(...args: Parameters<EnterpriseAuthorizationController["searchSessionKnowledge"]>) { return this.authorization.searchSessionKnowledge(...args); }
  readSessionKnowledge(...args: Parameters<EnterpriseAuthorizationController["readSessionKnowledge"]>) { return this.authorization.readSessionKnowledge(...args); }
  observeIndexHead(...args: Parameters<EnterpriseAuthorizationController["observeIndexHead"]>) { return this.authorization.observeIndexHead(...args); }
  retireTeamModelChannels(): void { this.authorization.retireTeamModelChannels(); }
  syncKnowledge(input: import("@pi67/protocol").ContextMemoryCommandPayloads["enterprise.knowledge.sync"], signal?: AbortSignal) { return this.authorization.syncKnowledge(input, signal); }
  beginAuthorization(): Promise<CommandResults["enterprise.auth.begin"]> {
    this.invalidateAccess();
    return this.authorization.beginAuthorization();
  }
  pollAuthorization(authorizationId: string): Promise<CommandResults["enterprise.auth.poll"]> {
    return this.authorization.pollAuthorization(authorizationId);
  }
  disconnect(): Promise<EnterpriseIdentityStatus> {
    this.invalidateAccess();
    return this.authorization.disconnect();
  }

  async listTeams(): Promise<{ items: EnterpriseTeamSummary[]; total: number }> {
    const configuration = await this.configuration.read();
    const credential = await this.authorization.activeCredential(configuration);
    const items = await new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).listTeams();
    return { items, total: items.length };
  }

  async listProjects(teamId: string): Promise<{ items: EnterpriseProjectSummary[]; total: number }> {
    const configuration = await this.configuration.read();
    const credential = await this.authorization.activeCredential(configuration);
    const items = await new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).listProjects(teamId);
    if (items.some((item) => item.accountId !== teamId)) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "New Money returned a project outside the selected team.",
        false
      );
    }
    return { items, total: items.length };
  }

  async getWorkspaceBinding(workspaceId: string, teamId: string): Promise<EnterpriseWorkspaceBinding> {
    const assertCurrent = this.accessGuard(workspaceId);
    const configuration = await this.configuration.read();
    assertCurrent();
    if (!this.credentials?.snapshot().credential) return { state: "unbound", workspaceId };
    const credential = await this.authorization.activeCredential(configuration);
    assertCurrent();
    const cached = this.workspaceBindings.get(workspaceId);
    if (cached?.accountId === teamId) return cached;
    const gateway = new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    );
    const remote = await gateway.getWorkspaceBinding(teamId, workspaceFingerprint(workspaceId));
    assertCurrent();
    const binding = remote
      ? gateway.toDesktopBinding(workspaceId, remote)
      : { state: "unbound" as const, workspaceId };
    this.workspaceBindings.set(workspaceId, binding);
    return binding;
  }

  async bindWorkspace(
    workspaceId: string,
    teamId: string,
    enterpriseProjectId: string,
    idempotencyKey: string
  ): Promise<EnterpriseWorkspaceBinding> {
    this.authorization.retireTeamModelChannels(workspaceId);
    this.bindingGenerations.set(workspaceId, (this.bindingGenerations.get(workspaceId) ?? 0) + 1);
    this.workspaceBindings.delete(workspaceId);
    const assertCurrent = this.accessGuard(workspaceId);
    const configuration = await this.configuration.read();
    const credential = await this.authorization.activeCredential(configuration);
    assertCurrent();
    const workspace = this.workspaces.require(workspaceId);
    if (workspace.initialization.trust !== "trusted") {
      throw new HostCommandError(
        "WORKSPACE_NOT_TRUSTED",
        "Trust this Workspace before binding it to a New Money project.",
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
        teamId,
        enterpriseProjectId,
        workspaceFingerprint(workspaceId),
        idempotencyKey
      )
    );
    assertCurrent();
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
    const credential = await this.authorization.activeCredential(configuration);
    const workspace = this.workspaces.require(input.workspaceId);
    const binding = await this.requireBoundWorkspace(input.workspaceId);
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
        `The Experience candidate is not eligible for New Money team review: ${eligibility.reasons.join(", ")}.`,
        true
      );
    }
    if (
      input.workspaceFingerprint !== workspaceFingerprint(input.workspaceId)
      || input.candidate.result !== "success"
      || input.candidate.redactionStatus !== "passed"
      || input.candidate.sensitivity === "private"
    ) {
      throw new HostCommandError("INVALID_PAYLOAD", "The Experience candidate source binding is invalid.", false);
    }
    return new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).createExperienceCandidate(binding.accountId!, {
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
        hash: enterpriseEvidenceHash(item.reference),
        verifiedAt: new Date(item.verifiedAt).toISOString()
      })),
      redactionStatus: input.candidate.redactionStatus
    });
  }

  async searchSharedExperiences(
    workspaceId: string,
    query: string,
    requestedLimit?: number,
    signal?: AbortSignal,
    model?: { baseUrl: string; id: string; scope?: import("@pi67/domain").TeamSessionIdentity } | null
  ): Promise<{ items: SharedExperienceSearchItem[]; total: number }> {
    const assertCurrent = this.accessGuard(workspaceId);
    const configuration = await this.configuration.read();
    if (configuration.sharedExperienceLimit <= 0) return { items: [], total: 0 };
    const credential = await this.authorization.activeCredential(configuration);
    const binding = await resolveSharedReadScope(model, credential.userId, configuration.enterpriseGatewayEndpoint, () => this.requireBoundWorkspace(workspaceId));
    const lease = await new EnterpriseContextGatewayClient(configuration.enterpriseGatewayEndpoint, credential.accessToken)
      .authorizeProject(credential.userId, binding.accountId, binding.enterpriseProjectId, signal);
    assertCurrent();
    if (model !== undefined) lease.assertAgentModel(model);
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
    ).searchSharedExperiences(
      binding.accountId!,
      binding.enterpriseProjectId,
      query,
      serverLimit,
      signal
    );
    assertCurrent(binding.workspaceBinding);
    if (candidates.some((item) => item.projectId !== binding.enterpriseProjectId)) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "New Money returned a shared Experience outside the bound project.",
        false
      );
    }
    const items = (this.recall
      ? await this.recall.applyEnterpriseFeedback(workspaceId, "enterprise-experience", candidates, { userId: credential.userId, endpoint: configuration.enterpriseGatewayEndpoint, teamId: binding.accountId, projectId: binding.enterpriseProjectId })
      : candidates).slice(0, limit);
    assertCurrent(binding.workspaceBinding);
    await this.recall?.recordEnterprise({
      workspaceId,
      query,
      route: "enterprise-experience",
      identity: { userId: credential.userId, endpoint: configuration.enterpriseGatewayEndpoint, teamId: binding.accountId, projectId: binding.enterpriseProjectId },
      durationMs: Date.now() - startedAt,
      candidateCount: candidates.length,
      items
    });
    assertCurrent(binding.workspaceBinding); lease.assertValid();
    return { items, total: items.length };
  }

  async getSharedExperience(
    workspaceId: string,
    assetId: string,
    signal?: AbortSignal,
    model?: { baseUrl: string; id: string; scope?: import("@pi67/domain").TeamSessionIdentity } | null
  ): Promise<SharedExperienceDetail> {
    const assertCurrent = this.accessGuard(workspaceId);
    const configuration = await this.configuration.read();
    const credential = await this.authorization.activeCredential(configuration);
    const binding = await resolveSharedReadScope(model, credential.userId, configuration.enterpriseGatewayEndpoint, () => this.requireBoundWorkspace(workspaceId));
    const lease = await new EnterpriseContextGatewayClient(configuration.enterpriseGatewayEndpoint, credential.accessToken)
      .authorizeProject(credential.userId, binding.accountId, binding.enterpriseProjectId, signal);
    assertCurrent();
    if (model !== undefined) lease.assertAgentModel(model);
    const item = await new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).getSharedExperience(binding.accountId!, assetId, signal);
    assertCurrent(binding.workspaceBinding);
    if (item.projectId !== binding.enterpriseProjectId) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "New Money returned a shared Experience outside the bound project.",
        false
      );
    }
    lease.assertValid();
    return item;
  }

  async searchSharedSops(
    workspaceId: string,
    query: string,
    signal?: AbortSignal,
    model?: { baseUrl: string; id: string; scope?: import("@pi67/domain").TeamSessionIdentity } | null
  ): Promise<{ items: SharedSopSearchItem[]; total: number }> {
    const assertCurrent = this.accessGuard(workspaceId);
    const configuration = await this.configuration.read();
    const credential = await this.authorization.activeCredential(configuration);
    const binding = await resolveSharedReadScope(model, credential.userId, configuration.enterpriseGatewayEndpoint, () => this.requireBoundWorkspace(workspaceId));
    const lease = await new EnterpriseContextGatewayClient(configuration.enterpriseGatewayEndpoint, credential.accessToken)
      .authorizeProject(credential.userId, binding.accountId, binding.enterpriseProjectId, signal);
    assertCurrent();
    if (model !== undefined) lease.assertAgentModel(model);
    const startedAt = Date.now();
    const candidates = await new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).searchSharedSops(binding.accountId!, binding.enterpriseProjectId, query, 2, signal);
    assertCurrent(binding.workspaceBinding);
    if (candidates.length > 2 || candidates.some((item) => item.projectId !== binding.enterpriseProjectId)) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "New Money returned an invalid SOP set for the bound project.",
        false
      );
    }
    const items = (this.recall
      ? await this.recall.applyEnterpriseFeedback(workspaceId, "enterprise-sop", candidates, { userId: credential.userId, endpoint: configuration.enterpriseGatewayEndpoint, teamId: binding.accountId, projectId: binding.enterpriseProjectId })
      : candidates).slice(0, 1);
    assertCurrent(binding.workspaceBinding);
    await this.recall?.recordEnterprise({
      workspaceId,
      query,
      route: "enterprise-sop",
      identity: { userId: credential.userId, endpoint: configuration.enterpriseGatewayEndpoint, teamId: binding.accountId, projectId: binding.enterpriseProjectId },
      durationMs: Date.now() - startedAt,
      candidateCount: candidates.length,
      items
    });
    assertCurrent(binding.workspaceBinding); lease.assertValid();
    items.forEach(assertSopUnexpired);
    return { items, total: items.length };
  }

  async getSharedSop(
    workspaceId: string,
    assetId: string,
    signal?: AbortSignal,
    model?: { baseUrl: string; id: string; scope?: import("@pi67/domain").TeamSessionIdentity } | null
  ): Promise<SharedSopDetail> {
    const assertCurrent = this.accessGuard(workspaceId);
    const configuration = await this.configuration.read();
    const credential = await this.authorization.activeCredential(configuration);
    const binding = await resolveSharedReadScope(model, credential.userId, configuration.enterpriseGatewayEndpoint, () => this.requireBoundWorkspace(workspaceId));
    const lease = await new EnterpriseContextGatewayClient(configuration.enterpriseGatewayEndpoint, credential.accessToken)
      .authorizeProject(credential.userId, binding.accountId, binding.enterpriseProjectId, signal);
    assertCurrent();
    if (model !== undefined) lease.assertAgentModel(model);
    const item = await new EnterpriseContextGatewayClient(
      configuration.enterpriseGatewayEndpoint,
      credential.accessToken
    ).getSharedSop(binding.accountId!, assetId, signal);
    assertCurrent(binding.workspaceBinding);
    if (item.projectId !== binding.enterpriseProjectId) {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "New Money returned an SOP outside the bound project.",
        false
      );
    }
    lease.assertValid();
    assertSopUnexpired(item);
    return item;
  }

  private invalidateAccess(): void {
    this.accessGeneration += 1;
    this.workspaceBindings.clear();
  }

  private accessGuard(workspaceId: string) {
    const assertPower = enterprisePowerEpoch.capture();
    const generation = this.accessGeneration, bindingGeneration = this.bindingGenerations.get(workspaceId);
    return (binding?: EnterpriseWorkspaceBinding) => {
      assertPower();
      if (generation !== this.accessGeneration || bindingGeneration !== this.bindingGenerations.get(workspaceId)
        || (binding && this.workspaceBindings.get(workspaceId) !== binding)) {
        throw new HostCommandError("RUNTIME_NOT_READY", "New Money identity or project changed. Retry in the current scope.", true);
      }
    };
  }

  private async requireBoundWorkspace(workspaceId: string): Promise<EnterpriseWorkspaceBinding & {
    state: "bound";
    enterpriseProjectId: string;
    accountId: string;
  }> {
    const cached = this.workspaceBindings.get(workspaceId);
    const configuration = await this.configuration.read();
    const credential = await this.authorization.activeCredential(configuration);
    const binding = cached ?? await this.getWorkspaceBinding(workspaceId, credential.accountId);
    if (binding.state !== "bound" || !binding.enterpriseProjectId || !binding.accountId) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "Bind this Workspace to a New Money project before searching shared team knowledge.",
        true
      );
    }
    return binding as EnterpriseWorkspaceBinding & {
      state: "bound";
      enterpriseProjectId: string;
      accountId: string;
    };
  }

}

function workspaceFingerprint(workspaceId: string): string {
  return createHash("sha256").update(`pi67-workspace:${workspaceId}`).digest("hex");
}
