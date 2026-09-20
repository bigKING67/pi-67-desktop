import type {
  ContextMemoryConfiguration,
  ContextRecallMetrics,
  ContextRecallItem,
  ContextRuntimeStatus,
  ContextSessionStatus,
  EnterpriseIdentityStatus,
  EnterpriseProjectSummary,
  EnterpriseTeamSummary,
  EnterpriseWorkspaceBinding,
  ExperienceCandidateSummary,
  MemoryEntrySummary,
  RecallFeedbackKind
} from "@pi67/domain";
import type {
  ContextMemoryConfigurationUpdate,
  ExperienceCandidateReview
} from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { invalidateNewMoneyIdentity, publishNewMoneyIdentity, refreshNewMoneyIdentity } from "./new-money-account-store.js";

const APP_CONTEXT = { scope: "app" as const };
let accountMutationGeneration = 0;

export interface ContextMemoryOverview {
  status: ContextRuntimeStatus;
  configuration: ContextMemoryConfiguration;
  identity: EnterpriseIdentityStatus;
  binding?: EnterpriseWorkspaceBinding;
}

export function selectEnterpriseProjectId(
  overview: ContextMemoryOverview,
  projects: EnterpriseProjectSummary[]
): string | undefined {
  return overview.binding?.enterpriseProjectId
    ?? projects.find((project) => project.status === "active")?.id;
}

export async function loadContextMemoryOverview(workspaceId?: string, probeRemote = true): Promise<ContextMemoryOverview> {
  await ensureAgentConnection();
  const [status, configuration, identity] = await Promise.all([
    probeRemote
      ? agentConnectionController.request("context.status.get", {}, [], { context: APP_CONTEXT })
      : agentConnectionController.request("context.runtime.doctor", { probeRemote: false }, [], { context: APP_CONTEXT }).then((report) => report.status),
    agentConnectionController.request("context.config.get", {}, [], { context: APP_CONTEXT }),
    loadEnterpriseIdentity()
  ]);
  const binding = workspaceId !== undefined
    && identity.state === "signed-in"
    && identity.accountId !== undefined
    ? await agentConnectionController.request(
        "enterprise.workspace.get",
        { teamId: identity.accountId },
        [],
        { context: { scope: "workspace", workspaceId } }
      ).catch(() => undefined)
    : undefined;
  return { status, configuration, identity, ...(binding === undefined ? {} : { binding }) };
}

export async function saveContextMemoryConfiguration(
  input: ContextMemoryConfigurationUpdate
): Promise<ContextMemoryConfiguration> {
  await ensureAgentConnection();
  return agentConnectionController.request("context.config.update", input, [], { context: APP_CONTEXT });
}

export async function beginEnterpriseAuthorization() {
  const generation = ++accountMutationGeneration;
  invalidateNewMoneyIdentity();
  await ensureAgentConnection();
  const authorization = await agentConnectionController.request("enterprise.auth.begin", {}, [], { context: APP_CONTEXT });
  if (generation === accountMutationGeneration) publishNewMoneyIdentity({ state: "pending", expiresAt: authorization.expiresAt });
  return authorization;
}

export async function pollEnterpriseAuthorization(authorizationId: string) {
  const generation = accountMutationGeneration;
  await ensureAgentConnection();
  const identity = await agentConnectionController.request("enterprise.auth.poll", { authorizationId }, [], {
    context: APP_CONTEXT
  });
  if (generation === accountMutationGeneration) publishNewMoneyIdentity(identity);
  return identity;
}

export async function disconnectEnterpriseAccount(): Promise<EnterpriseIdentityStatus> {
  const generation = ++accountMutationGeneration;
  invalidateNewMoneyIdentity();
  await ensureAgentConnection();
  const identity = await agentConnectionController.request("enterprise.auth.disconnect", {}, [], {
    context: APP_CONTEXT
  });
  if (generation === accountMutationGeneration) publishNewMoneyIdentity(identity);
  return identity;
}

export function loadEnterpriseIdentity(refresh = false): Promise<EnterpriseIdentityStatus> {
  if (refresh) invalidateNewMoneyIdentity();
  return refreshNewMoneyIdentity(async () => {
    await ensureAgentConnection();
    return agentConnectionController.request("enterprise.identity.get", refresh ? { refresh: true } : {}, [], { context: APP_CONTEXT });
  });
}

export async function loadEnterpriseTeams(): Promise<EnterpriseTeamSummary[]> {
  await ensureAgentConnection();
  const result = await agentConnectionController.request("enterprise.team.list", {}, [], {
    context: APP_CONTEXT
  });
  return result.items;
}

export async function loadEnterpriseProjects(teamId: string): Promise<EnterpriseProjectSummary[]> {
  await ensureAgentConnection();
  const result = await agentConnectionController.request("enterprise.project.list", { teamId }, [], {
    context: APP_CONTEXT
  });
  return result.items;
}

export async function syncEnterpriseKnowledge(teamId: string, projectId: string | undefined, signal: AbortSignal) {
  await ensureAgentConnection();
  signal.throwIfAborted();
  return agentConnectionController.request("enterprise.knowledge.sync", {
    teamId, ...(projectId === undefined ? {} : { projectId })
  }, [], { context: APP_CONTEXT, signal });
}

export async function buildEnterpriseKnowledgeIndex(teamId: string, projectId: string | undefined, signal: AbortSignal) {
  await ensureAgentConnection();
  signal.throwIfAborted();
  return agentConnectionController.request("enterprise.knowledge.index", {
    teamId, ...(projectId === undefined ? {} : { projectId })
  }, [], { context: APP_CONTEXT, signal });
}

export async function loadEnterpriseWorkspaceBinding(
  workspaceId: string,
  teamId: string
): Promise<EnterpriseWorkspaceBinding> {
  await ensureAgentConnection();
  return agentConnectionController.request("enterprise.workspace.get", { teamId }, [], {
    context: { scope: "workspace", workspaceId }
  });
}

export async function bindEnterpriseWorkspace(
  workspaceId: string,
  teamId: string,
  enterpriseProjectId: string
): Promise<EnterpriseWorkspaceBinding> {
  await ensureAgentConnection();
  return agentConnectionController.request("enterprise.workspace.bind", { teamId, enterpriseProjectId }, [], {
    context: { scope: "workspace", workspaceId }
  });
}

export async function runContextMemoryDoctor() {
  await ensureAgentConnection();
  return agentConnectionController.request("context.runtime.doctor", { probeRemote: true }, [], {
    context: APP_CONTEXT
  });
}

export async function loadContextSession(
  workspaceId: string,
  sessionId: string
): Promise<ContextSessionStatus> {
  await ensureAgentConnection();
  return agentConnectionController.request("context.session.get", { sessionId }, [], {
    context: { scope: "workspace", workspaceId }
  });
}

export async function commitContextSession(workspaceId: string, sessionId: string) {
  await ensureAgentConnection();
  return agentConnectionController.request("context.session.commit", {
    submissionId: globalThis.crypto.randomUUID(),
    sessionId
  }, [], { context: { scope: "workspace", workspaceId } });
}

export async function loadRecallItems(
  workspaceId: string,
  sessionId?: string
): Promise<ContextRecallItem[]> {
  await ensureAgentConnection();
  const result = await agentConnectionController.request("context.recall.list", {
    ...(sessionId === undefined ? {} : { sessionId }),
    limit: 20
  }, [], { context: { scope: "workspace", workspaceId } });
  return result.items;
}

export async function loadRecallMetrics(workspaceId: string): Promise<ContextRecallMetrics> {
  await ensureAgentConnection();
  return agentConnectionController.request("context.recall.metrics", {}, [], {
    context: { scope: "workspace", workspaceId }
  });
}

export async function submitRecallFeedback(
  workspaceId: string,
  id: string,
  feedback: RecallFeedbackKind,
  sessionId?: string
): Promise<{ id: string; feedback: RecallFeedbackKind; recordedAt: number }> {
  await ensureAgentConnection();
  return agentConnectionController.request("context.recall.feedback", {
    id,
    feedback,
    ...(sessionId === undefined ? {} : { sessionId })
  }, [], { context: { scope: "workspace", workspaceId } });
}

export async function searchPrivateMemories(
  workspaceId: string,
  query: string
): Promise<MemoryEntrySummary[]> {
  await ensureAgentConnection();
  const result = await agentConnectionController.request("memory.search", {
    query,
    scope: "workspace",
    limit: 20
  }, [], { context: { scope: "workspace", workspaceId } });
  return result.items;
}

export async function loadPrivateExperiences(
  workspaceId: string
): Promise<ExperienceCandidateSummary[]> {
  await ensureAgentConnection();
  const result = await agentConnectionController.request("experience.private.list", { limit: 20 }, [], {
    context: { scope: "workspace", workspaceId }
  });
  return result.items;
}

export async function reviewExperienceCandidate(
  workspaceId: string,
  review: ExperienceCandidateReview
): Promise<ExperienceCandidateSummary> {
  await ensureAgentConnection();
  return agentConnectionController.request("experience.candidate.review", review, [], {
    context: { scope: "workspace", workspaceId }
  });
}

export async function submitExperienceCandidate(
  workspaceId: string,
  candidateId: string
) {
  await ensureAgentConnection();
  return agentConnectionController.request("experience.candidate.promote", {
    submissionId: globalThis.crypto.randomUUID(),
    id: candidateId
  }, [], { context: { scope: "workspace", workspaceId } });
}

export async function rejectExperienceCandidate(
  workspaceId: string,
  candidateId: string,
  reason: string
): Promise<ExperienceCandidateSummary> {
  await ensureAgentConnection();
  return agentConnectionController.request("experience.candidate.reject", {
    id: candidateId,
    reason
  }, [], { context: { scope: "workspace", workspaceId } });
}
