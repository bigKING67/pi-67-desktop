import type { EnterpriseAccessCredential } from "@pi67/protocol";
import type { TeamSessionIdentity } from "@pi67/domain";
import type { ContextMemoryConfigurationStore } from "./context-memory-configuration.js";
import type { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import { enterprisePowerEpoch } from "./enterprise-power-epoch.js";
import { runSharedKnowledgeQuery, SharedKnowledgeQueryError } from "./shared-knowledge-query.js";
import { runSharedKnowledgeRead } from "./shared-knowledge-read.js";
import { assertTeamQueryText, type TeamQueryEmbedding, type TeamQueryModel } from "./team-query-embedding.js";

export interface TeamQueryInput {
  teamId: string; projectId: string | null; workspaceId?: string;
  query: string; signal: AbortSignal;
  loadEmbedding(this: void, signal: AbortSignal): Promise<TeamQueryEmbedding>;
}
export type TeamKnowledgeReadInput = Pick<TeamQueryInput, "teamId" | "projectId" | "workspaceId" | "signal">
  & Pick<Parameters<typeof runSharedKnowledgeRead>[0], "snapshot" | "assetId" | "contentRevision">;
interface SessionAdmission { identity: TeamSessionIdentity; model: { baseUrl: string; id: string }; }
type SessionInput<T> = Omit<T, "teamId" | "projectId"> & SessionAdmission & { scope: "team" | "project" };
const unavailable = () => new Error("Team query embedding or search unavailable.");
class DisabledTeamMemoryError extends Error {
  constructor() { super("Team knowledge is disabled in memory settings."); }
}

/** Shared lifetime owner. Only explicit Session entry points additionally admit
 * an Agent model; neither transport path proves Pi provenance or prior selection. */
export class EnterpriseTeamQueries {
  readonly #runs = new Map<AbortController, string | undefined>();
  constructor(private readonly dependencies: {
    configuration: ContextMemoryConfigurationStore;
    credentials: EnterpriseCredentialBrokerClient | undefined;
    activeCredential(configuration: Awaited<ReturnType<ContextMemoryConfigurationStore["read"]>>): Promise<EnterpriseAccessCredential>;
    isAvailable(): boolean;
  }) {}
  retire(workspaceId?: string): void {
    for (const [owner, workspace] of this.#runs) if (workspaceId === undefined || workspaceId === workspace) owner.abort();
  }
  embed(input: TeamQueryInput & { expectedModel: TeamQueryModel }) {
    const expected = { ...input.expectedModel }, query = input.query;
    return this.#run(input, async ({ embed, signal, check }) => {
      const vector = await embed(query, expected, signal); check();
      return { vector, model: expected };
    });
  }
  search(input: TeamQueryInput & { limit: number }) {
    return this.#search(input);
  }
  searchSession(input: SessionInput<TeamQueryInput & { limit: number }>) {
    const admission = captureAdmission(input);
    return this.#search({ ...input, teamId: admission.identity.teamId,
      projectId: input.scope === "team" ? null : admission.identity.projectId }, admission);
  }
  readSession(input: SessionInput<TeamKnowledgeReadInput>) {
    const admission = captureAdmission(input);
    return this.#read({ ...input, teamId: admission.identity.teamId,
      projectId: input.scope === "team" ? null : admission.identity.projectId }, admission);
  }
  #search(input: TeamQueryInput & { limit: number }, admission?: SessionAdmission) {
    const { query, limit, teamId, projectId } = input;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return Promise.reject(unavailable());
    return this.#run(input, async ({ embed, signal, check }) => {
      const receipts = this.dependencies.credentials?.sharedKnowledgeReceipts();
      if (!receipts) throw unavailable();
      return runSharedKnowledgeQuery({ receipts, query, limit, signal, assertCurrent: check, embed,
        scope: { teamId, scopeKind: projectId === null ? "team" : "project", scopeId: projectId ?? teamId } });
    }, admission);
  }
  read(input: TeamKnowledgeReadInput) {
    return this.#read(input);
  }
  #read(input: TeamKnowledgeReadInput, admission?: SessionAdmission) {
    const { teamId, projectId, assetId, contentRevision } = input, snapshot = input.snapshot === "current" ? "current" : { ...input.snapshot };
    return this.#run(input, async ({ signal, check }) => {
      const receipts = this.dependencies.credentials?.sharedKnowledgeReceipts();
      if (!receipts) throw unavailable();
      return runSharedKnowledgeRead({ receipts, assetId, contentRevision, snapshot, signal, assertCurrent: check,
        scope: { teamId, scopeKind: projectId === null ? "team" : "project", scopeId: projectId ?? teamId } });
    }, admission);
  }
  async #run<T>(input: TeamQueryInput | TeamKnowledgeReadInput, perform: (context: {
    signal: AbortSignal; check(this: void): void;
    embed(this: void, query: string, expected: TeamQueryModel, signal: AbortSignal): Promise<readonly number[]>;
  }) => Promise<T>, admission?: SessionAdmission): Promise<T> {
    if (!this.dependencies.isAvailable() || this.#runs.size >= 4) throw unavailable();
    if ("query" in input) assertTeamQueryText(input.query);
    const { teamId, projectId, workspaceId } = input, loadEmbedding = "loadEmbedding" in input ? input.loadEmbedding : undefined;
    const owner = new AbortController(), started = Date.now(), monotonic = performance.now();
    let lastWall = started;
    const signal = AbortSignal.any([input.signal, owner.signal, this.dependencies.credentials?.signal ?? AbortSignal.abort(),
      enterprisePowerEpoch.signal, AbortSignal.timeout(60_000)]);
    const check = () => {
      signal.throwIfAborted(); const now = Date.now(), elapsed = performance.now() - monotonic;
      if (!this.dependencies.isAvailable() || now < lastWall || now >= started + 60_000 || elapsed < 0 || elapsed >= 60_000) throw unavailable();
      lastWall = now;
    };
    this.#runs.set(owner, workspaceId);
    try {
      check(); const configuration = await this.dependencies.configuration.read(); check();
      if (configuration.enabled === false || configuration.defaultPrivacyMode === "off") {
        throw new DisabledTeamMemoryError();
      }
      const credential = await this.dependencies.activeCredential(configuration); check();
      const remaining = credential.expiresAt - Date.now(); if (remaining <= 0) throw unavailable();
      let requestSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.min(remaining, 60_000))]);
      let agentGrant: Awaited<ReturnType<EnterpriseContextGatewayClient["authorizeProject"]>> | undefined;
      const current = () => {
        check(); requestSignal.throwIfAborted(); if (Date.now() >= credential.expiresAt) throw unavailable();
        if (admission) agentGrant?.assertAgentModel(admission.model);
      };
      if (admission) {
        const { identity } = admission;
        if (credential.userId !== identity.userId || new URL(credential.endpoint).href !== new URL(identity.endpoint).href) throw unavailable();
        // Even team-wide reads must belong to a currently authorized birth project.
        // Use this run's credential, never a separate facade grant that can race login.
        agentGrant = await new EnterpriseContextGatewayClient(credential.endpoint, credential.accessToken)
          .authorizeProject(identity.userId, identity.teamId, identity.projectId, requestSignal);
        current();
        requestSignal = AbortSignal.any([requestSignal, AbortSignal.timeout(Math.max(0, Math.ceil(agentGrant.deadline - Date.now())))]);
      }
      current();
      const result = await perform({ signal: requestSignal, check: current, embed: async (query, expected, caller) => {
        current(); caller.throwIfAborted();
        if (!loadEmbedding) throw unavailable();
        const source = await loadEmbedding(caller); current(); caller.throwIfAborted();
        if (source.model.endpoint !== expected.endpoint || source.model.model !== expected.model || source.model.dimension !== expected.dimension) throw unavailable();
        const vector = await source.embed(query, new EnterpriseContextGatewayClient(credential.endpoint, credential.accessToken),
          { userId: credential.userId, teamId, projectId }, caller);
        current(); caller.throwIfAborted(); return vector;
      } });
      current(); return result;
    } catch (error) { throw error instanceof DisabledTeamMemoryError || error instanceof SharedKnowledgeQueryError ? error : unavailable(); }
    finally { owner.abort(); this.#runs.delete(owner); }
  }
}

function captureAdmission(input: SessionAdmission): SessionAdmission {
  return { identity: { ...input.identity }, model: { ...input.model } };
}
