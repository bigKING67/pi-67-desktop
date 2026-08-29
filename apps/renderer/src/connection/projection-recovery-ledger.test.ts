import type { OperationView } from "@pi67/domain";
import type { OperationSettled } from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import type { AppState } from "../app/app-store.types.js";
import { ProjectionRecoveryLedger } from "./projection-recovery-ledger.js";

describe("ProjectionRecoveryLedger", () => {
  it("fences recovery attempts by both Host epoch and local revision", () => {
    const ledger = new ProjectionRecoveryLedger();
    const first = ledger.invalidate();
    const state = appState();

    expect(ledger.isCurrent(state, 7, first)).toBe(true);
    expect(ledger.isCurrent(state, 8, first)).toBe(false);

    const second = ledger.invalidate();
    expect(ledger.isRevisionCurrent(first)).toBe(false);
    expect(ledger.isRevisionCurrent(second)).toBe(true);
    expect(ledger.isCurrent(state, 7, first)).toBe(false);
    expect(ledger.isCurrent(state, 7, second)).toBe(true);
    expect(ledger.isCurrent({ ...state, connected: false }, 7, second)).toBe(false);
  });

  it("records only an interruptible active Operation across connection loss", () => {
    const ledger = new ProjectionRecoveryLedger();
    const revision = ledger.beginConnectionLoss(appState(operation("operation-running", "running")));

    expect(revision).toBe(1);
    expect(ledger.matchingInterruptedTerminal(terminal("operation-running"))).toBeDefined();
    expect(ledger.matchingInterruptedTerminal(terminal("operation-other"))).toBeUndefined();

    ledger.beginConnectionLoss(appState(operation("operation-completed", "completed")));
    expect(ledger.matchingInterruptedTerminal(terminal("operation-completed"))).toBeUndefined();
  });

  it("admits one interruption notice until recovery convergence", () => {
    const ledger = new ProjectionRecoveryLedger();
    const recovering = {
      ...appState(),
      connected: false,
      sessionTransitionPending: true,
      runtime: { phase: "recovering", detail: "恢复中", recoverable: true }
    } as AppState;
    const first = ledger.beginConnectionLoss(appState());
    const repeated = ledger.beginConnectionLoss(recovering);

    expect(ledger.claimConnectionLossNotification(first)).toBe(true);
    expect(ledger.claimConnectionLossNotification(repeated)).toBe(false);

    ledger.completeConnectionLoss();
    const later = ledger.beginConnectionLoss(appState());
    expect(ledger.claimConnectionLossNotification(later)).toBe(true);
  });

  it("supports explicit resync ownership and clears it on Host replacement", () => {
    const ledger = new ProjectionRecoveryLedger();
    ledger.captureInterruptedOperation(appState(), "operation-explicit");
    expect(ledger.matchingInterruptedTerminal(terminal("operation-explicit"))).toBeDefined();

    ledger.prepareHostReplacement();
    expect(ledger.matchingInterruptedTerminal(terminal("operation-explicit"))).toBeUndefined();
  });
});

function appState(operation?: OperationView): AppState {
  return {
    connected: true,
    hostEpoch: 7,
    workspace: "/workspace",
    operation
  } as AppState;
}

function operation(
  operationId: string,
  lifecycle: OperationView["lifecycle"]
): OperationView {
  return {
    operationId,
    kind: "prompt",
    lifecycle,
    cancellable: lifecycle !== "completed",
    sessionId: "session-1",
    sessionFileIdentity: "session-file-session-1",
    sessionGeneration: 3,
    startedAt: 10
  };
}

function terminal(operationId: string): OperationSettled {
  return {
    kind: "settled",
    operationId,
    operationKind: "prompt",
    lifecycle: "completed",
    cancellable: false,
    hostEpoch: 7,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-session-1",
    sessionGeneration: 3,
    startedAt: 10,
    settledAt: 20
  };
}
