import { createHash } from "node:crypto";
import type { ContextMemoryConfiguration } from "@pi67/domain";
import type { PrivateMemoryCommitResult } from "@pi67/pi-runtime";
import type { HostEventChannel } from "../host-event-channel.js";
import { HostCommandError } from "../protocol-error.js";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";
import type { EnterpriseContextController } from "./enterprise-context-controller.js";
import { captureSessionCommitProvenance } from "./experience-candidate-provenance.js";
import type { CandidateCommitReceipt, ExperienceCandidateStore } from "./experience-candidate-store.js";
import { detectMemoryOwnerConflicts } from "./memory-conflict-detector.js";
export type PrivateSessionCommit = (workspaceId: string, sessionId: string) => Promise<PrivateMemoryCommitResult>;

export class ContextSessionCommitController {
  constructor(
    private readonly agentDir: string,
    private readonly workspaces: WorkspaceContextRegistry,
    private readonly enterprise: EnterpriseContextController,
    private readonly candidates: ExperienceCandidateStore,
    private readonly events: HostEventChannel,
    private readonly commitPrivateSession?: PrivateSessionCommit
  ) {}

  async commit(input: {
    workspaceId: string;
    submissionId: string;
    sessionId: string;
    operationId: string;
    configuration: ContextMemoryConfiguration;
  }): Promise<void> {
    let candidateReceipt: CandidateCommitReceipt | undefined;
    try {
      await this.assertLocalMemoryAvailable(input.configuration);
      if (!this.commitPrivateSession) throw new HostCommandError("RUNTIME_NOT_READY", "Open the Session with its private memory owner before Commit.", true);
      candidateReceipt = await this.prepareCandidateCommit(input);
      if (candidateReceipt && candidateReceipt.state !== "prepared") {
        if (["tracking", "completed", "skipped"].includes(candidateReceipt.state)) {
          this.emitCompleted(input);
          return;
        }
        throw new HostCommandError(
          "RESOURCE_CHANGED_EXTERNALLY",
          "A previous candidate Commit with this submission identity is ambiguous or failed. Use a new explicit Commit.",
          true
        );
      }
      const result = await this.commitPrivateSession(input.workspaceId, input.sessionId);
      if (candidateReceipt) {
        candidateReceipt = result.archived && result.task_id
          ? await this.candidates.markCommitTracking(candidateReceipt.submissionId, result.task_id)
          : await this.candidates.markCommitTerminal(
              candidateReceipt.submissionId,
              "skipped",
              "OpenViking did not return an external candidate task receipt."
            );
      }
      this.emitCompleted(input, result);
    } catch (error) {
      if (candidateReceipt?.state === "prepared") {
        await this.candidates.markCommitTerminal(
          candidateReceipt.submissionId,
          "ambiguous",
          "The OpenViking Commit did not produce a durable task receipt."
        ).catch(() => undefined);
      }
      this.emit(input.workspaceId, {
        type: "context.commitFailed",
        payload: {
          operationId: input.operationId,
          sessionId: input.sessionId,
          detail: error instanceof Error ? error.message : "OpenViking commit failed."
        }
      });
      throw error;
    }
  }

  private async assertLocalMemoryAvailable(configuration: ContextMemoryConfiguration): Promise<void> {
    if (configuration.defaultPrivacyMode === "off" || configuration.defaultPrivacyMode === "read-only") {
      throw new HostCommandError("RUNTIME_NOT_READY", "Private memory Commit is unavailable in read-only or off mode.", true);
    }
    const conflicts = await detectMemoryOwnerConflicts(this.agentDir);
    if (!configuration.enabled || conflicts.length > 0) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        conflicts.length > 0
          ? `Memory Runtime is disabled because multiple Context owners were found: ${conflicts.join(", ")}.`
          : "OpenViking memory is disabled.",
        true
      );
    }
  }

  private async prepareCandidateCommit(input: {
    workspaceId: string;
    submissionId: string;
    sessionId: string;
    configuration: ContextMemoryConfiguration;
  }): Promise<CandidateCommitReceipt | undefined> {
    const workspace = this.workspaces.require(input.workspaceId);
    if (input.configuration.defaultPrivacyMode !== "full-learning") return undefined;
    if (workspace.initialization.trust !== "trusted") return undefined;
    const identity = this.enterprise.currentIdentity();
    if (identity.state !== "signed-in" || !identity.accountId) return undefined;
    const binding = await this.enterprise.getWorkspaceBinding(input.workspaceId, identity.accountId);
    if (binding.state !== "bound") return undefined;
    try {
      const provenance = await captureSessionCommitProvenance(
        this.workspaces,
        input.workspaceId,
        input.sessionId
      );
      return (await this.candidates.prepareCommit(input.submissionId, provenance)).receipt;
    } catch (error) {
      this.emit(input.workspaceId, {
        type: "experience.candidateAssemblyFailed",
        payload: {
          sourceSessionIdHash: createHash("sha256").update(input.sessionId).digest("hex"),
          failedAt: Date.now(),
          detail: error instanceof Error ? error.message : "Pi JSONL candidate provenance capture failed."
        }
      });
      return undefined;
    }
  }

  private emitCompleted(input: { workspaceId: string; operationId: string; sessionId: string }, result?: PrivateMemoryCommitResult): void {
    const outcome = result?.archived
      ? result.extraction === "completed" ? "extracted" : result.extraction === "failed" ? "extraction-failed" : "unconfirmed"
      : result?.status === "skipped"
        ? result.reason === "all_within_keep_window" ? "retained" : result.reason === "no_messages" ? "empty" : "skipped"
        : "unconfirmed";
    this.emit(input.workspaceId, {
      type: "context.commitCompleted",
      payload: { operationId: input.operationId, sessionId: input.sessionId, outcome }
    });
  }

  private emit(workspaceId: string, event: Parameters<HostEventChannel["sendFor"]>[0]): void {
    this.events.sendFor(event, {
      runtime: undefined,
      operations: undefined,
      context: { scope: "workspace", workspaceId }
    });
  }
}
