import type { ContextMemoryConfiguration, EnterpriseIdentityStatus } from "@pi67/domain";
import type { CommandResults, EnterpriseAccessCredential } from "@pi67/protocol";
import type { HostEventChannel } from "../host-event-channel.js";
import { HostCommandError } from "../protocol-error.js";
import { appContextAuthority } from "./context-memory-support.js";
import type { ContextMemoryConfigurationStore } from "./context-memory-configuration.js";
import type { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import { syncSharedKnowledge } from "./shared-knowledge-sync.js";
import { enterprisePowerEpoch } from "./enterprise-power-epoch.js";
import type { Duplex } from "node:stream";
import { attachNativeTeamModelChannel } from "./native-team-model-channel.js";
import type { TeamModelPortAdmission } from "./team-model-port-admission.js";
import type { TeamWorkerBrokerClient } from "./team-worker-broker-client.js";
import { runSharedKnowledgeIndex } from "./shared-knowledge-index.js";
import { verifySharedKnowledgeIndexHead, observeSharedKnowledgeIndexHead } from "./shared-knowledge-index-head.js";
import type { TeamIndexModels } from "./team-index-model-source.js";
import { EnterpriseTeamQueries } from "./enterprise-team-query.js";

type NativeChannelOptions = Parameters<typeof attachNativeTeamModelChannel>[1];
export type EnterpriseTeamModelChannelInput = Omit<NativeChannelOptions, "gateway" | "scope"> & {
  teamId: string; projectId: string | null; workspaceId?: string;
};
type TeamIndexInput = Pick<EnterpriseTeamModelChannelInput, "teamId" | "projectId" | "workspaceId" | "signal">
  & (TeamIndexModels | { loadModels(this: void, signal: AbortSignal): Promise<TeamIndexModels> });

interface PendingEnterpriseAuthorization {
  endpoint: string;
  deviceSecret: string;
  expiresAt: number;
  generation: number;
}

export class EnterpriseAuthorizationController {
  private identity: EnterpriseIdentityStatus = { state: "signed-out" };
  private readonly pendingAuthorizations = new Map<string, PendingEnterpriseAuthorization>();
  private authorizationGeneration = 0;
  private accessBlocked = false;
  private credentialMutation: Promise<void> = Promise.resolve();
  private credentialRefresh: Promise<EnterpriseAccessCredential> | undefined;
  // Cosmetic data only: updating a name must not retire credential-bound team work.
  private profile: { generation: number; endpoint: string; userId: string; displayName: string } | undefined;
  private profileRead = 0;
  private readonly syncRuns = new Set<AbortController>();
  private readonly teamModelChannels = new Map<Duplex, { workspaceId: string | undefined; stop(): void }>();
  private readonly teamModelReservations = new Map<AbortController, string | undefined>();
  private readonly teamIndexRuns = new Map<AbortController, string | undefined>();
  private readonly teamQueries: EnterpriseTeamQueries;
  private readonly indexHeadRuns = new Set<AbortController>();

  constructor(
    private readonly configuration: ContextMemoryConfigurationStore,
    private readonly events: HostEventChannel,
    private readonly credentials?: EnterpriseCredentialBrokerClient
  ) {
    this.teamQueries = new EnterpriseTeamQueries({ configuration, credentials,
      activeCredential: value => this.activeCredential(value), isAvailable: () => !this.accessBlocked });
  }

  shutdown(): void {
    this.retireTeamModelChannels();
    for (const run of this.syncRuns) run.abort();
    this.authorizationGeneration += 1;
    this.accessBlocked = true;
    this.credentialRefresh = undefined;
    this.pendingAuthorizations.clear();
    this.credentials?.shutdown();
  }

  currentIdentity(): EnterpriseIdentityStatus {
    if (this.accessBlocked) return this.identity;
    const credential = this.credentials?.snapshot().credential;
    if (!credential) return this.identity;
    if (credential.expiresAt <= Date.now() && !credential.refreshToken) {
      this.identity = { ...identityForCredential(credential), state: "expired" };
      return this.identity;
    }
    this.identity = identityForCredential(credential);
    if (this.profile?.generation === this.authorizationGeneration
      && this.profile.endpoint === credential.endpoint && this.profile.userId === credential.userId) {
      this.identity = { ...this.identity, displayName: this.profile.displayName };
    }
    return this.identity;
  }

  async refreshIdentity(): Promise<EnterpriseIdentityStatus> {
    if (this.accessBlocked || !this.credentials?.snapshot().credential) return this.currentIdentity();
    const generation = this.authorizationGeneration;
    const read = ++this.profileRead;
    const configuration = await this.configuration.read();
    if (generation !== this.authorizationGeneration || this.accessBlocked) throw obsoleteAuthorization();
    const credential = await this.activeCredential(configuration);
    const profile = await new EnterpriseContextGatewayClient(credential.endpoint, credential.accessToken).readProfile();
    const latestConfiguration = await this.configuration.read();
    const latest = this.credentials.snapshot().credential;
    if (generation !== this.authorizationGeneration || this.accessBlocked || read !== this.profileRead
      || latestConfiguration.enterpriseGatewayEndpoint !== credential.endpoint
      || latest?.endpoint !== credential.endpoint || latest.userId !== credential.userId) throw obsoleteAuthorization();
    if (profile.userId !== credential.userId) throw new HostCommandError(
      "RUNTIME_NOT_READY", "New Money returned a different account identity.", false);
    await this.mutateCredentials(async () => {
      const current = this.credentials!.snapshot().credential;
      if (generation !== this.authorizationGeneration || this.accessBlocked || read !== this.profileRead
        || current?.userId !== credential.userId || current.endpoint !== credential.endpoint
        || (await this.configuration.read()).enterpriseGatewayEndpoint !== credential.endpoint) throw obsoleteAuthorization();
      await this.credentials!.updateDisplayName(profile.displayName);
      if (generation !== this.authorizationGeneration || this.accessBlocked || read !== this.profileRead) throw obsoleteAuthorization();
      this.profile = { generation, endpoint: credential.endpoint, ...profile };
    });
    const identity = this.currentIdentity();
    this.emitIdentity();
    return identity;
  }

  async activeCredential(
    configuration: ContextMemoryConfiguration
  ): Promise<EnterpriseAccessCredential> {
    if (this.accessBlocked) throw obsoleteAuthorization();
    const credential = this.credentials?.snapshot().credential;
    if (!credential) {
      throw new HostCommandError("RUNTIME_NOT_READY", "Sign in to New Money first.", true);
    }
    if (!configuration.enterpriseGatewayEndpoint || credential.endpoint !== configuration.enterpriseGatewayEndpoint) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "The New Money endpoint changed. Disconnect and sign in again.",
        true
      );
    }
    if (credential.expiresAt > Date.now() + 30_000) return credential;
    if (!credential.refreshToken) {
      throw new HostCommandError("RUNTIME_NOT_READY", "Your New Money sign-in has expired.", true);
    }
    if (!this.credentialRefresh) {
      const generation = this.authorizationGeneration;
      const current = () => !this.accessBlocked && generation === this.authorizationGeneration;
      const refresh = new EnterpriseContextGatewayClient(
        configuration.enterpriseGatewayEndpoint
      ).refreshCredential(credential.refreshToken).then(async (next) => {
        await this.mutateCredentials(async () => {
          if (!current()) throw obsoleteAuthorization();
          const profile = this.profile;
          if (profile?.generation === generation && profile.endpoint === next.endpoint && profile.userId === next.userId) {
            next.displayName = profile.displayName;
          }
          await this.credentials!.store(next);
          if (!current()) {
            await this.credentials!.clear();
            throw obsoleteAuthorization();
          }
          this.currentIdentity();
          this.emitIdentity();
        });
        if (!current()) throw obsoleteAuthorization();
        return next;
      });
      this.credentialRefresh = refresh;
      void refresh.finally(() => {
        if (this.credentialRefresh === refresh) this.credentialRefresh = undefined;
      }).catch(() => undefined);
    }
    return this.credentialRefresh;
  }

  async beginAuthorization(): Promise<CommandResults["enterprise.auth.begin"]> {
    this.retireTeamModelChannels();
    for (const run of this.syncRuns) run.abort();
    const generation = ++this.authorizationGeneration;
    this.accessBlocked = true;
    this.credentialRefresh = undefined;
    this.pendingAuthorizations.clear();
    const configuration = await this.configuration.read();
    const endpoint = configuration.enterpriseGatewayEndpoint;
    if (!endpoint) {
      throw new HostCommandError(
        "UNSUPPORTED",
        "Configure the New Money endpoint before signing in.",
        true
      );
    }
    if (this.credentials?.snapshot().storage !== "available") {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "System secure storage is unavailable; New Money sign-in is disabled.",
        true
      );
    }
    const authorization = await new EnterpriseContextGatewayClient(endpoint)
      .startDeviceAuthorization();
    if (generation !== this.authorizationGeneration) {
      throw new HostCommandError("RUNTIME_NOT_READY", "New Money authorization was superseded or cancelled.", true);
    }
    this.pendingAuthorizations.set(authorization.authorizationId, {
      generation,
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
    const current = () => pending.generation === this.authorizationGeneration
      && this.pendingAuthorizations.get(authorizationId) === pending;
    if (!current()) return this.currentIdentity();
    if (exchange.state === "pending" || !exchange.credential) return this.identity;
    const credential = exchange.credential;
    await this.mutateCredentials(async () => {
      if (!current()) return;
      await this.credentials!.store(credential);
      if (!current()) {
        await this.credentials!.clear();
        return;
      }
      this.pendingAuthorizations.delete(authorizationId);
      this.accessBlocked = false;
      this.identity = identityForCredential(credential);
      this.emitIdentity();
    });
    return this.currentIdentity();
  }

  async disconnect(): Promise<EnterpriseIdentityStatus> {
    this.retireTeamModelChannels();
    for (const run of this.syncRuns) run.abort();
    const generation = ++this.authorizationGeneration;
    this.accessBlocked = true;
    this.credentialRefresh = undefined;
    this.identity = { state: "signed-out" };
    this.pendingAuthorizations.clear();
    const credential = this.credentials?.snapshot().credential;
    try {
      if (credential) await new EnterpriseContextGatewayClient(
        credential.endpoint,
        credential.accessToken
      ).revokeSession();
    } catch {
      // Disconnect must still clear the local secure credential when the server is unreachable.
    }
    await this.mutateCredentials(async () => {
      if (generation === this.authorizationGeneration) await this.credentials?.clear();
    });
    if (generation === this.authorizationGeneration) {
      this.identity = { state: "signed-out" };
      this.emitIdentity();
    }
    return this.currentIdentity();
  }

  private mutateCredentials(action: () => Promise<void>): Promise<void> {
    const operation = this.credentialMutation.then(action);
    this.credentialMutation = operation.catch(() => undefined);
    return operation;
  }

  /** Internal worker owner only, never a Renderer route. Scope and models are trusted
   * selections; user/service are captured from the current credential, not native input.
   * The Main worker owner must terminate its process when the channel closes.
   */
  attachTeamModelChannel(channel: Duplex, input: EnterpriseTeamModelChannelInput) {
    const credential = this.credentials?.snapshot().credential;
    if (this.accessBlocked || !credential || !this.credentials || this.credentials.signal.aborted
      || channel.destroyed || this.teamModelChannels.has(channel) || this.teamModelChannels.size >= 4) {
      throw new HostCommandError("RUNTIME_NOT_READY", "Team model channel is unavailable or busy.", true);
    }
    const generation = this.authorizationGeneration;
    const signal = AbortSignal.any([input.signal, this.credentials.signal, enterprisePowerEpoch.signal,
      AbortSignal.timeout(Math.max(0, Math.min(2_147_483_647, credential.expiresAt - Date.now())))]);
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (this.accessBlocked || generation !== this.authorizationGeneration || credential.expiresAt <= Date.now()) throw obsoleteAuthorization();
    };
    assertCurrent();
    const gateway = async (requestSignal?: AbortSignal) => {
      assertCurrent(); requestSignal?.throwIfAborted();
      const configuration = await this.configuration.read(); assertCurrent();
      const current = await this.activeCredential(configuration); assertCurrent(); requestSignal?.throwIfAborted();
      if (current.userId !== credential.userId || current.endpoint !== credential.endpoint) throw obsoleteAuthorization();
      return new EnterpriseContextGatewayClient(current.endpoint, current.accessToken);
    };
    const handle = attachNativeTeamModelChannel(channel, { ...input, signal,
      scope: { userId: credential.userId, teamId: input.teamId, projectId: input.projectId },
      gateway: {
        authorizeTeam: async (userId, teamId, requestSignal) => (await gateway(requestSignal)).authorizeTeam(userId, teamId, requestSignal),
        authorizeProject: async (userId, teamId, projectId, requestSignal) => (await gateway(requestSignal)).authorizeProject(userId, teamId, projectId, requestSignal)
      }
    });
    const stop = () => { this.teamModelChannels.delete(channel); handle.stop(); };
    this.teamModelChannels.set(channel, { workspaceId: input.workspaceId, stop });
    channel.once("close", () => { this.teamModelChannels.delete(channel); });
    return { stop };
  }

  reserveTeamModelPort(admission: TeamModelPortAdmission, input: EnterpriseTeamModelChannelInput, phase: "port" | "worker" = "port") {
    if (this.accessBlocked) throw obsoleteAuthorization();
    const selection = { ...input, models: { embedding: { ...input.models.embedding }, extraction: { ...input.models.extraction } } };
    const owner = new AbortController();
    const signal = AbortSignal.any([owner.signal, input.signal, this.credentials?.signal ?? AbortSignal.abort(), enterprisePowerEpoch.signal]);
    const reservation = admission.reserve(channel => this.attachTeamModelChannel(channel, { ...selection, signal }), signal, phase);
    this.teamModelReservations.set(owner, selection.workspaceId);
    void reservation.connected.finally(() => this.teamModelReservations.delete(owner)).catch(() => undefined);
    return reservation;
  }

  retireTeamModelChannels(workspaceId?: string): void {
    this.teamQueries.retire(workspaceId);
    for (const owner of this.indexHeadRuns) owner.abort();
    for (const [owner, workspace] of this.teamIndexRuns) {
      if (workspaceId === undefined || workspaceId === workspace) owner.abort();
    }
    for (const [owner, workspace] of this.teamModelReservations) {
      if (workspaceId === undefined || workspaceId === workspace) { this.teamModelReservations.delete(owner); owner.abort(); }
    }
    for (const [channel, handle] of this.teamModelChannels) {
      if (workspaceId === undefined || handle.workspaceId === workspaceId) {
        this.teamModelChannels.delete(channel); handle.stop();
      }
    }
  }

  async observeIndexHead(input: import("@pi67/protocol").SharedKnowledgeIndexHeadCheck, caller: AbortSignal) {
    if (this.accessBlocked || this.indexHeadRuns.size >= 4) throw obsoleteAuthorization();
    const selection = structuredClone(input), owner = new AbortController(), generation = this.authorizationGeneration;
    const signal = AbortSignal.any([caller, owner.signal, this.credentials?.signal ?? AbortSignal.abort(), enterprisePowerEpoch.signal]);
    const check = () => { signal.throwIfAborted(); if (this.accessBlocked || generation !== this.authorizationGeneration) throw obsoleteAuthorization(); };
    const release = () => { this.indexHeadRuns.delete(owner); owner.abort(); };
    this.indexHeadRuns.add(owner);
    try {
      check(); const configuration = await this.configuration.read(); check();
      const credential = await this.activeCredential(configuration); check();
      if (credential.userId !== selection.owner.userId || credential.endpoint !== selection.owner.endpoint) throw obsoleteAuthorization();
      const { teamId, scopeId, scopeKind } = selection.owner;
      const observation = await observeSharedKnowledgeIndexHead(new EnterpriseContextGatewayClient(credential.endpoint, credential.accessToken), {
        userId: credential.userId, scope: { teamId, scopeId, scopeKind }, models: selection.models,
        snapshot: selection.snapshot, permissionRevision: selection.permissionRevision
      }, signal);
      check(); observation.assertValid();
      const validUntil = Math.min(observation.validUntil, credential.expiresAt);
      return { validUntil, signal, release, assertValid: () => {
        check(); observation.assertValid(); if (Date.now() >= validUntil) throw obsoleteAuthorization();
      } };
    } catch (error) { release(); throw error; }
  }

  async indexKnowledge(admission: TeamModelPortAdmission, workers: Pick<TeamWorkerBrokerClient, "start">,
    input: TeamIndexInput) {
    if (this.accessBlocked || this.teamIndexRuns.size >= 4) throw obsoleteAuthorization();
    const request = { teamId: input.teamId, projectId: input.projectId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }) };
    const modelSource = "loadModels" in input ? input.loadModels : undefined;
    const supplied = "models" in input ? { ...input, models: { embedding: { ...input.models.embedding }, extraction: { ...input.models.extraction } } } : undefined;
    const owner = new AbortController(), generation = this.authorizationGeneration;
    const signal = AbortSignal.any([owner.signal, input.signal, this.credentials?.signal ?? AbortSignal.abort(),
      enterprisePowerEpoch.signal, AbortSignal.timeout(480_000)]);
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (this.accessBlocked || generation !== this.authorizationGeneration) throw obsoleteAuthorization();
    };
    this.teamIndexRuns.set(owner, request.workspaceId);
    try {
      assertCurrent();
      const configuration = await this.configuration.read(); assertCurrent();
      const credential = await this.activeCredential(configuration); assertCurrent();
      const resolved = modelSource ? await modelSource(signal) : supplied!; assertCurrent();
      const selection = { ...request, embeddingDimension: resolved.embeddingDimension, invoke: resolved.invoke,
        models: { embedding: { ...resolved.models.embedding }, extraction: { ...resolved.models.extraction } } };
      const receipts = this.credentials?.sharedKnowledgeReceipts();
      if (!receipts) throw obsoleteAuthorization();
      const gateway = new EnterpriseContextGatewayClient(credential.endpoint, credential.accessToken);
      const authorizationSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
      const grant = selection.projectId === null
        ? await gateway.authorizeTeam(credential.userId, selection.teamId, authorizationSignal)
        : await gateway.authorizeProject(credential.userId, selection.teamId, selection.projectId, authorizationSignal);
      assertCurrent(); authorizationSignal.throwIfAborted();
      grant.assertModel("embedding", selection.models.embedding);
      grant.assertModel("extraction", selection.models.extraction);
      const scope: Parameters<typeof runSharedKnowledgeIndex>[0]["scope"] = {
        teamId: selection.teamId, scopeKind: selection.projectId === null ? "team" : "project", scopeId: selection.projectId ?? selection.teamId };
      const models = { embedding: { endpoint: selection.models.embedding.baseUrl, model: selection.models.embedding.id, dimension: selection.embeddingDimension },
        extraction: { endpoint: selection.models.extraction.baseUrl, model: selection.models.extraction.id } };
      // Catch up under the same captured identity/lifetime before opening the
      // index handle. No model reservation or short Main handoff exists yet.
      await syncSharedKnowledge({ gateway, receipts, userId: credential.userId, scope, assertCurrent,
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), maxPages: 10 });
      assertCurrent(); grant.assertValid();
      return await runSharedKnowledgeIndex({ receipts, workers, signal, assertCurrent,
        scope, models, revalidate: (snapshot, requestSignal) => verifySharedKnowledgeIndexHead(gateway, { userId: credential.userId, scope, models, snapshot }, requestSignal),
        reserve: requestSignal => this.reserveTeamModelPort(admission, { ...selection, signal: requestSignal }, "worker") });
    } finally { owner.abort(); this.teamIndexRuns.delete(owner); }
  }

  embedKnowledgeQuery(...args: Parameters<EnterpriseTeamQueries["embed"]>) { return this.teamQueries.embed(...args); }
  searchKnowledge(...args: Parameters<EnterpriseTeamQueries["search"]>) { return this.teamQueries.search(...args); }
  readKnowledge(...args: Parameters<EnterpriseTeamQueries["read"]>) { return this.teamQueries.read(...args); }
  searchSessionKnowledge(...args: Parameters<EnterpriseTeamQueries["searchSession"]>) { return this.teamQueries.searchSession(...args); }
  readSessionKnowledge(...args: Parameters<EnterpriseTeamQueries["readSession"]>) { return this.teamQueries.readSession(...args); }

  async syncKnowledge(input: import("@pi67/protocol").ContextMemoryCommandPayloads["enterprise.knowledge.sync"], callerSignal?: AbortSignal): Promise<CommandResults["enterprise.knowledge.sync"]> {
    if (this.syncRuns.size >= 4) throw new HostCommandError("RUNTIME_NOT_READY", "Shared knowledge synchronization is busy.", true);
    const selection = { ...input }, generation = this.authorizationGeneration;
    const run = new AbortController(); this.syncRuns.add(run);
    const signal = AbortSignal.any([run.signal, enterprisePowerEpoch.signal, AbortSignal.timeout(60_000), ...(callerSignal ? [callerSignal] : [])]);
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (this.accessBlocked || generation !== this.authorizationGeneration) throw obsoleteAuthorization();
    };
    try {
      assertCurrent();
      const configuration = await this.configuration.read(); assertCurrent();
      const credential = await this.activeCredential(configuration); assertCurrent();
      const receipts = this.credentials?.sharedKnowledgeReceipts();
      if (!receipts) throw new HostCommandError("RUNTIME_NOT_READY", "Shared knowledge receipt service is unavailable.", true);
      return await syncSharedKnowledge({ gateway: new EnterpriseContextGatewayClient(credential.endpoint, credential.accessToken),
        receipts, userId: credential.userId, scope: { teamId: selection.teamId,
          scopeKind: selection.projectId === undefined ? "team" : "project", scopeId: selection.projectId ?? selection.teamId },
        assertCurrent, signal, maxPages: selection.maxPages ?? 10 });
    } finally { this.syncRuns.delete(run); }
  }

  private emitIdentity(): void {
    this.events.sendFor({ type: "enterprise.authChanged", payload: this.identity }, appContextAuthority());
  }
}

function obsoleteAuthorization(): HostCommandError {
  return new HostCommandError("RUNTIME_NOT_READY", "New Money authorization was superseded or cancelled.", true);
}

function identityForCredential(credential: Pick<EnterpriseAccessCredential, "accountId" | "userId" | "displayName" | "expiresAt">): EnterpriseIdentityStatus {
  return {
    state: "signed-in",
    accountId: credential.accountId,
    userId: credential.userId,
    ...(credential.displayName === undefined ? {} : { displayName: credential.displayName }),
    expiresAt: credential.expiresAt
  };
}
