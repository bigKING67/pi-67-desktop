import type { OperationView, RuntimeIdentity } from "@pi67/domain";
import type { OperationSettled, ProtocolError } from "@pi67/protocol";

export type OperationTerminalDetails =
  | { lifecycle: "completed"; settledAt: number }
  | { lifecycle: "failed"; settledAt: number; error: ProtocolError }
  | { lifecycle: "cancelled" | "lost"; settledAt: number; reason: string };

export class OperationTerminalLedger {
  private readonly terminals = new Map<string, OperationSettled>();

  constructor(
    private readonly hostEpoch: number,
    private readonly maxTerminals: number
  ) {}

  get(operationId: string): OperationSettled | undefined {
    return this.terminals.get(operationId);
  }

  latest(): OperationSettled | undefined {
    let latest: OperationSettled | undefined;
    for (const terminal of this.terminals.values()) latest = terminal;
    return latest;
  }

  remember(
    operation: OperationView,
    current: RuntimeIdentity,
    details: OperationTerminalDetails
  ): OperationSettled {
    return this.insert(this.create(operation, current, details));
  }

  create(
    operation: OperationView,
    current: RuntimeIdentity,
    details: OperationTerminalDetails
  ): OperationSettled {
    const authority = current.sessionId
      && current.sessionFileIdentity
      ? {
          sessionId: current.sessionId,
          sessionFileIdentity: current.sessionFileIdentity,
          sessionGeneration: current.sessionGeneration
        }
      : {
          sessionId: operation.sessionId,
          sessionFileIdentity: operation.sessionFileIdentity,
          sessionGeneration: operation.sessionGeneration
        };
    const base = {
      kind: "settled" as const,
      operationId: operation.operationId,
      operationKind: operation.kind,
      cancellable: false as const,
      hostEpoch: this.hostEpoch,
      sessionId: authority.sessionId,
      sessionFileIdentity: authority.sessionFileIdentity,
      sessionGeneration: authority.sessionGeneration,
      startedAt: operation.startedAt,
      settledAt: details.settledAt
    };
    const terminal: OperationSettled = details.lifecycle === "failed"
      ? { ...base, lifecycle: details.lifecycle, error: details.error }
      : details.lifecycle === "completed"
        ? { ...base, lifecycle: details.lifecycle }
        : { ...base, lifecycle: details.lifecycle, reason: details.reason };
    return terminal;
  }

  restore(terminal: OperationSettled): OperationSettled {
    const restored = {
      ...terminal,
      hostEpoch: this.hostEpoch
    } as OperationSettled;
    return this.insert(restored);
  }

  private insert(terminal: OperationSettled): OperationSettled {
    this.terminals.delete(terminal.operationId);
    this.terminals.set(terminal.operationId, terminal);
    while (this.terminals.size > this.maxTerminals) {
      const oldest = this.terminals.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.terminals.delete(oldest);
    }
    return terminal;
  }
}
