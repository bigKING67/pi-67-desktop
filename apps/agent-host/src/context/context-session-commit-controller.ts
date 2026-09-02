import { createHash } from "node:crypto";
import type { ContextMemoryConfiguration } from "@pi67/domain";
import type { HostEventChannel } from "../host-event-channel.js";
import { HostCommandError } from "../protocol-error.js";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";
import type { EnterpriseContextController } from "./enterprise-context-controller.js";
import { captureSessionCommitProvenance } from "./experience-candidate-provenance.js";
import type { CandidateCommitReceipt, ExperienceCandidateStore } from "./experience-candidate-store.js";
import { detectMemoryOwnerConflicts } from "./memory-conflict-detector.js";
import type { OpenVikingClient } from "./openviking-client.js";

export class ContextSessionCommitController {
  constructor(
    private readonly agentDir: string,
    private readonly workspaces: WorkspaceContextRegistry,
    private readonly enterprise: EnterpriseContextController,
    private readonly candidates: ExperienceCandidateStore,
    private readonly events: HostEventChannel
  ) {}

  async commit(input: {
    workspaceId: string;
    submissionId: string;
    sessionId: string;
    operationId: string;
    configuration: ContextMemoryConfiguration;
    client: OpenVikingClient;
  }): Promise<void> {
    let candidateReceipt: CandidateCommitReceipt | undefined;
    try {
      await this.assertLocalMemoryAvailable(input.configuration);
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
      const result = await input.client.commitSession(input.sessionId);
      if (candidateReceipt) {
        candidateReceipt = result.archived && result.task_id
          ? await this.candidates.markCommitTracking(candidateReceipt.submissionId, result.task_id)
          : await this.candidates.markCommitTerminal(
              candidateReceipt.submissionId,
              "skipped",
              result.reason ?? "OpenViking did not archive new messages."
            );
      }
      this.emitCompleted(input);
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
    if (this.enterprise.currentIdentity().state !== "signed-in") return undefined;
    const binding = await this.enterprise.getWorkspaceBinding(input.workspaceId);
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

  private emitCompleted(input: { workspaceId: string; operationId: string; sessionId: string }): void {
    this.emit(input.workspaceId, {
      type: "context.commitCompleted",
      payload: { operationId: input.operationId, sessionId: input.sessionId }
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
