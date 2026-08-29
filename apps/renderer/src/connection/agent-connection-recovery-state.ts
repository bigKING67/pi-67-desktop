import {
  ProtocolRequestError,
  type AgentConnectionIdentity,
  type RendererAcknowledgementDiagnostics,
  type RendererConnectionTeardownReason
} from "@pi67/protocol";

interface FutureConnectionSubscriber {
  onConnected?: (identity: AgentConnectionIdentity) => void;
  onTeardown?: (error: Error) => void;
}

interface FutureConnectionWaitInput {
  afterGeneration: number;
  timeoutMs: number;
  current: () => {
    disposed: boolean;
    generation: number;
    identity: AgentConnectionIdentity | undefined;
  };
  subscribe: (subscriber: FutureConnectionSubscriber) => () => void;
}

export class AgentConnectionRecoveryDiagnostics {
  private teardownCount = 0;
  private futureGenerationWaitCount = 0;
  private futureGenerationWaitTimeoutCount = 0;
  private priorGenerationTeardownIgnoredCount = 0;
  private lastTeardownAt: number | undefined;
  private lastTeardownCode: string | undefined;
  private lastTeardownReason: RendererConnectionTeardownReason | undefined;

  constructor(private readonly now: () => number) {}

  snapshot(connectionGeneration: number): Partial<RendererAcknowledgementDiagnostics> {
    return {
      connectionGeneration,
      teardownCount: this.teardownCount,
      futureGenerationWaitCount: this.futureGenerationWaitCount,
      futureGenerationWaitTimeoutCount: this.futureGenerationWaitTimeoutCount,
      priorGenerationTeardownIgnoredCount: this.priorGenerationTeardownIgnoredCount,
      ...(this.lastTeardownAt === undefined ? {} : { lastTeardownAt: this.lastTeardownAt }),
      ...(this.lastTeardownCode === undefined ? {} : { lastTeardownCode: this.lastTeardownCode }),
      ...(this.lastTeardownReason === undefined ? {} : { lastTeardownReason: this.lastTeardownReason })
    };
  }

  beginFutureGenerationWait(): void {
    this.futureGenerationWaitCount = increment(this.futureGenerationWaitCount);
  }

  recordFutureGenerationWaitTimeout(): void {
    this.futureGenerationWaitTimeoutCount = increment(this.futureGenerationWaitTimeoutCount);
  }

  recordPriorGenerationTeardownIgnored(): void {
    this.priorGenerationTeardownIgnoredCount = increment(this.priorGenerationTeardownIgnoredCount);
  }

  recordTeardown(error: Error, reason: RendererConnectionTeardownReason): void {
    this.teardownCount = increment(this.teardownCount);
    this.lastTeardownAt = Math.max(0, Math.round(this.now()));
    this.lastTeardownCode = error instanceof ProtocolRequestError ? error.code : undefined;
    this.lastTeardownReason = reason;
  }
}

export function waitForFutureConnection(
  input: FutureConnectionWaitInput,
  diagnostics: AgentConnectionRecoveryDiagnostics
): Promise<AgentConnectionIdentity> {
  const initial = input.current();
  if (initial.disposed) return Promise.reject(connectionError("Agent connection controller has been disposed."));
  if (!Number.isSafeInteger(input.afterGeneration) || input.afterGeneration < 0) {
    return Promise.reject(new RangeError("generation must be a non-negative safe integer."));
  }
  if (initial.identity && initial.generation > input.afterGeneration) {
    return Promise.resolve(initial.identity);
  }
  diagnostics.beginFutureGenerationWait();
  return new Promise<AgentConnectionIdentity>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      diagnostics.recordFutureGenerationWaitTimeout();
      unsubscribe();
      reject(connectionError("Timed out waiting for a replacement Pi runtime service connection."));
    }, input.timeoutMs);
    const unsubscribe = input.subscribe({
      onConnected: (identity) => {
        if (input.current().generation <= input.afterGeneration) return;
        globalThis.clearTimeout(timeout);
        unsubscribe();
        resolve(identity);
      },
      onTeardown: (error) => {
        if (input.current().generation <= input.afterGeneration) {
          diagnostics.recordPriorGenerationTeardownIgnored();
          return;
        }
        globalThis.clearTimeout(timeout);
        unsubscribe();
        reject(error);
      }
    });
  });
}

function increment(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}

function connectionError(message: string): ProtocolRequestError {
  return new ProtocolRequestError({ code: "CONNECTION_CLOSED", message, recoverable: true });
}
