import type { ExperienceCandidateSummary } from "@pi67/domain";
import type { CommandResults, ExperienceCandidateReview } from "@pi67/protocol";
import type { HostEventChannel } from "../host-event-channel.js";
import { HostCommandError } from "../protocol-error.js";
import type { EnterpriseContextController } from "./enterprise-context-controller.js";
import {
  getPrivateExperienceSummary,
  listPrivateExperienceSummaries,
  reconcileExperienceCandidates,
  rejectExperienceCandidate,
  reviewExperienceCandidate
} from "./experience-candidate-assembler.js";
import type { ExperienceCandidateStore } from "./experience-candidate-store.js";
import type { OpenVikingClient } from "./openviking-client.js";

export class ExperienceGovernanceController {
  constructor(
    private readonly store: ExperienceCandidateStore,
    private readonly enterprise: EnterpriseContextController,
    private readonly events: HostEventChannel
  ) {}

  async list(
    client: OpenVikingClient,
    workspaceId: string,
    status: ExperienceCandidateSummary["status"] | undefined,
    limit: number
  ): Promise<CommandResults["experience.private.list"]> {
    await reconcileExperienceCandidates({
      store: this.store,
      client,
      workspaceId,
      onCreated: (candidate) => this.emit(workspaceId, {
        type: "experience.candidateCreated",
        payload: candidate
      }),
      onFailed: (receipt, detail) => this.emit(workspaceId, {
        type: "experience.candidateAssemblyFailed",
        payload: { sourceSessionIdHash: receipt.sourceSessionIdHash, failedAt: Date.now(), detail }
      })
    });
    const stored = await this.store.listCandidates(workspaceId);
    const sourceUris = new Set(stored.map((item) => item.source.experienceUri));
    const privateItems = await listPrivateExperienceSummaries(client, workspaceId, limit);
    const items = [
      ...stored.map((item) => item.summary),
      ...privateItems.filter((item) => !sourceUris.has(item.id))
    ].filter((item) => status === undefined || item.status === status).slice(0, limit);
    return { items, total: items.length };
  }

  async get(
    client: OpenVikingClient,
    workspaceId: string,
    id: string
  ): Promise<ExperienceCandidateSummary> {
    const stored = await this.store.getCandidate(id, workspaceId);
    if (stored) return stored.summary;
    if (!id.startsWith("viking://")) {
      throw new HostCommandError("RESOURCE_NOT_FOUND", "The Experience candidate is not available locally.", true);
    }
    return getPrivateExperienceSummary(client, workspaceId, id);
  }

  async review(workspaceId: string, review: ExperienceCandidateReview): Promise<ExperienceCandidateSummary> {
    const candidate = await this.store.updateCandidate(
      review.id,
      workspaceId,
      review.expectedUpdatedAt,
      (current) => reviewExperienceCandidate(current, review)
    );
    this.emit(workspaceId, { type: "experience.candidateValidated", payload: candidate.summary });
    return candidate.summary;
  }

  async submit(
    workspaceId: string,
    candidateId: string,
    submissionId: string,
    operationId: string
  ): Promise<void> {
    try {
      const stored = await this.store.getCandidate(candidateId, workspaceId);
      if (!stored) {
        throw new HostCommandError("RESOURCE_NOT_FOUND", "The Experience candidate is not available locally.", true);
      }
      const receipt = await this.enterprise.submitExperienceCandidate({
        workspaceId,
        candidate: stored.summary,
        workspaceFingerprint: stored.source.workspaceFingerprint,
        sourceSessionIdHash: stored.source.sourceSessionIdHash,
        idempotencyKey: submissionId
      });
      const saved = await this.store.updateCandidate(
        stored.summary.id,
        workspaceId,
        stored.summary.updatedAt,
        (current) => ({
          ...current,
          summary: {
            ...current.summary,
            status: "submitted",
            enterpriseCandidateId: receipt.id,
            submittedAt: receipt.createdAt,
            updatedAt: Math.max(receipt.updatedAt, current.summary.updatedAt + 1)
          }
        })
      );
      this.emit(workspaceId, {
        type: "experience.candidatePromoted",
        payload: { operationId, candidate: saved.summary }
      });
    } catch (error) {
      this.emit(workspaceId, {
        type: "experience.candidatePromotionFailed",
        payload: {
          operationId,
          candidateId,
          failedAt: Date.now(),
          detail: error instanceof Error ? error.message : "Enterprise Experience candidate submission failed."
        }
      });
      throw error;
    }
  }

  async reject(workspaceId: string, candidateId: string, reason: string): Promise<ExperienceCandidateSummary> {
    const candidate = await this.store.updateCandidate(
      candidateId,
      workspaceId,
      undefined,
      (current) => rejectExperienceCandidate(current, reason)
    );
    this.emit(workspaceId, { type: "experience.candidateRejected", payload: candidate.summary });
    return candidate.summary;
  }

  private emit(workspaceId: string, event: Parameters<HostEventChannel["sendFor"]>[0]): void {
    this.events.sendFor(event, {
      runtime: undefined,
      operations: undefined,
      context: { scope: "workspace", workspaceId }
    });
  }
}
