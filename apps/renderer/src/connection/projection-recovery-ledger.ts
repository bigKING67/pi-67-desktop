import type { OperationSettled } from "@pi67/protocol";
import type { AppState } from "../app/app-store.types.js";

export class ProjectionRecoveryLedger {
  private revision = 0;
  private interruptedOperationId: string | undefined;
  private connectionLossIncidentActive = false;
  private connectionLossNoticeRevision: number | undefined;

  invalidate(): number {
    this.revision += 1;
    return this.revision;
  }

  captureInterruptedOperation(state: AppState, operationId?: string): void {
    this.interruptedOperationId = operationId ?? activeOperationId(state);
  }

  beginConnectionLoss(state: AppState): number {
    const revision = this.invalidate();
    const stableBeforeLoss = state.connected
      && !state.sessionTransitionPending
      && state.runtime?.phase !== "recovering";
    if (!this.connectionLossIncidentActive || stableBeforeLoss) {
      this.connectionLossIncidentActive = true;
      this.connectionLossNoticeRevision = revision;
    }
    this.interruptedOperationId = state.workspace
      ? activeOperationId(state)
      : undefined;
    return revision;
  }

  claimConnectionLossNotification(revision: number): boolean {
    if (this.connectionLossNoticeRevision !== revision) return false;
    this.connectionLossNoticeRevision = undefined;
    return true;
  }

  completeConnectionLoss(): void {
    this.connectionLossIncidentActive = false;
    this.connectionLossNoticeRevision = undefined;
  }

  prepareHostReplacement(): void {
    this.invalidate();
    this.interruptedOperationId = undefined;
  }

  isCurrent(state: AppState, hostEpoch: number, revision: number): boolean {
    return state.connected
      && state.hostEpoch === hostEpoch
      && this.isRevisionCurrent(revision);
  }

  isRevisionCurrent(revision: number): boolean {
    return this.revision === revision;
  }

  matchingInterruptedTerminal(
    terminal: OperationSettled | undefined
  ): OperationSettled | undefined {
    return terminal?.operationId === this.interruptedOperationId
      ? terminal
      : undefined;
  }

  clearInterruptedOperation(): void {
    this.interruptedOperationId = undefined;
  }
}

export const projectionRecoveryLedger = new ProjectionRecoveryLedger();

export function completeRendererConnectionRecovery(): void {
  projectionRecoveryLedger.completeConnectionLoss();
}

function activeOperationId(state: AppState): string | undefined {
  const operation = state.operation;
  if (!operation) return undefined;
  return operation.lifecycle === "submitting"
    || operation.lifecycle === "accepted"
    || operation.lifecycle === "running"
    || operation.lifecycle === "waiting-input"
    ? operation.operationId
    : undefined;
}
