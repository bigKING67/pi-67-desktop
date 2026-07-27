import type { OperationView, RuntimeIdentity } from "@pi67/domain";
import type { ProtocolError } from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import { OperationTerminalLedger } from "./operation-terminal-ledger.js";

describe("OperationTerminalLedger", () => {
  it("keeps a bounded insertion-ordered terminal window", () => {
    const ledger = new OperationTerminalLedger(7, 2);

    ledger.remember(operation("operation-1", 1), identity("session-1", 1), {
      lifecycle: "completed",
      settledAt: 11
    });
    ledger.remember(operation("operation-2", 2), identity("session-1", 1), {
      lifecycle: "cancelled",
      settledAt: 12,
      reason: "Cancelled by the user."
    });
    const latest = ledger.remember(operation("operation-3", 3), identity("session-1", 1), {
      lifecycle: "lost",
      settledAt: 13,
      reason: "Host connection was lost."
    });

    expect(ledger.get("operation-1")).toBeUndefined();
    expect(ledger.get("operation-2")).toMatchObject({ lifecycle: "cancelled" });
    expect(ledger.latest()).toEqual(latest);
  });

  it("binds a completed Session import to the resulting Runtime identity", () => {
    const ledger = new OperationTerminalLedger(7, 2);
    const terminal = ledger.remember(
      operation("operation-import", 10, "session-import", "session-before", 2),
      identity("session-after", 3),
      { lifecycle: "completed", settledAt: 20 }
    );

    expect(terminal).toMatchObject({
      hostEpoch: 7,
      sessionId: "session-after",
      sessionGeneration: 3,
      operationKind: "session-import",
      lifecycle: "completed"
    });
  });

  it("keeps only the structured redacted failure receipt", () => {
    const ledger = new OperationTerminalLedger(7, 2);
    const error: ProtocolError = {
      code: "INTERNAL",
      message: "The operation failed.",
      recoverable: true,
      details: { category: "runtime" }
    };
    const source = {
      ...operation("operation-failed", 10),
      prompt: "raw prompt must not be retained",
      command: "raw command must not be retained"
    } as OperationView;

    const terminal = ledger.remember(source, identity("session-1", 1), {
      lifecycle: "failed",
      settledAt: 20,
      error
    });

    expect(terminal).toMatchObject({ lifecycle: "failed", error });
    expect(Object.keys(terminal).sort()).toEqual([
      "cancellable",
      "error",
      "hostEpoch",
      "kind",
      "lifecycle",
      "operationId",
      "operationKind",
      "sessionGeneration",
      "sessionId",
      "settledAt",
      "startedAt"
    ]);
    expect(JSON.stringify(terminal)).not.toContain("raw prompt");
    expect(JSON.stringify(terminal)).not.toContain("raw command");
  });
});

function operation(
  operationId: string,
  startedAt: number,
  kind: OperationView["kind"] = "command",
  sessionId = "session-1",
  sessionGeneration = 1
): OperationView {
  return {
    operationId,
    kind,
    lifecycle: "running",
    cancellable: true,
    sessionId,
    sessionGeneration,
    startedAt
  };
}

function identity(sessionId: string, sessionGeneration: number): RuntimeIdentity {
  return { sessionId, sessionGeneration };
}
