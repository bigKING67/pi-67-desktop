import type { FixtureAgentState, FixtureWindow } from "./pi67-renderer-fixture-types.js";

export type MockOperationViewFactory = (
  operationId: string,
  kind: string,
  lifecycle: string,
  state: FixtureAgentState
) => Record<string, unknown>;

export type MockProjectionAcknowledgementFactory = (
  state: FixtureAgentState,
  hostEpoch: number
) => Record<string, unknown>;

export function installMockOperationFactories(): void {
  const testWindow = window as FixtureWindow & {
    __pi67MockOperationView?: MockOperationViewFactory;
    __pi67MockProjectionAcknowledgement?: MockProjectionAcknowledgementFactory;
  };
  testWindow.__pi67MockOperationView = (operationId, kind, lifecycle, state) => ({
    operationId,
    kind,
    lifecycle,
    cancellable: kind === "prompt" || kind === "compaction",
    sessionId: String(state.snapshot.sessionId),
    sessionGeneration: state.sessionGeneration,
    startedAt: Date.now()
  });
  testWindow.__pi67MockProjectionAcknowledgement = (state, hostEpoch) => ({
    accepted: true,
    hostEpoch,
    sessionId: String(state.snapshot.sessionId),
    sessionGeneration: state.sessionGeneration,
    eventSequence: state.sequence
  });
}
