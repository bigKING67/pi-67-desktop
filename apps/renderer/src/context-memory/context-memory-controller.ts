import type {
  ContextMemoryConfiguration,
  ContextRecallMetrics,
  ContextRecallItem,
  ContextRuntimeStatus,
  ContextSessionStatus,
  EnterpriseIdentityStatus,
  EnterpriseProjectSummary,
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

const APP_CONTEXT = { scope: "app" as const };

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

export async function loadContextMemoryOverview(workspaceId?: string): Promise<ContextMemoryOverview> {
  await ensureAgentConnection();
  const [status, configuration, identity, binding] = await Promise.all([
    agentConnectionController.request("context.status.get", {}, [], { context: APP_CONTEXT }),
    agentConnectionController.request("context.config.get", {}, [], { context: APP_CONTEXT }),
    agentConnectionController.request("enterprise.identity.get", {}, [], { context: APP_CONTEXT }),
    workspaceId === undefined
      ? Promise.resolve(undefined)
      : agentConnectionController.request("enterprise.workspace.get", {}, [], {
          context: { scope: "workspace", workspaceId }
        }).catch(() => undefined)
  ]);
  return { status, configuration, identity, ...(binding === undefined ? {} : { binding }) };
}

export async function saveContextMemoryConfiguration(
  input: ContextMemoryConfigurationUpdate
): Promise<ContextMemoryConfiguration> {
  await ensureAgentConnection();
  return agentConnectionController.request("context.config.update", input, [], { context: APP_CONTEXT });
}

export async function beginEnterpriseAuthorization() {
  await ensureAgentConnection();
  return agentConnectionController.request("enterprise.auth.begin", {}, [], { context: APP_CONTEXT });
}

export async function pollEnterpriseAuthorization(authorizationId: string) {
  await ensureAgentConnection();
  return agentConnectionController.request("enterprise.auth.poll", { authorizationId }, [], {
    context: APP_CONTEXT
  });
}

export async function disconnectEnterpriseAccount(): Promise<EnterpriseIdentityStatus> {
  await ensureAgentConnection();
  return agentConnectionController.request("enterprise.auth.disconnect", {}, [], {
    context: APP_CONTEXT
  });
}

export async function loadEnterpriseProjects(): Promise<EnterpriseProjectSummary[]> {
  await ensureAgentConnection();
  const result = await agentConnectionController.request("enterprise.project.list", {}, [], {
    context: APP_CONTEXT
  });
  return result.items;
}

export async function bindEnterpriseWorkspace(
  workspaceId: string,
  enterpriseProjectId: string
): Promise<EnterpriseWorkspaceBinding> {
  await ensureAgentConnection();
  return agentConnectionController.request("enterprise.workspace.bind", { enterpriseProjectId }, [], {
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
