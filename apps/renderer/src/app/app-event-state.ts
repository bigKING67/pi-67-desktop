import type { OperationView, RuntimeStatus } from "@pi67/domain";

export interface AppEventState {
  connected: boolean;
  hostEpoch: number | undefined;
  runtime: RuntimeStatus;
  operation: OperationView | undefined;
  operationDetail: string | undefined;
  operationProgress: string | undefined;
  sessionTransitionPending: boolean;
}

export type EventStoreSet<TState extends AppEventState> = (
  partial: Partial<TState> | ((state: TState) => Partial<TState>)
) => void;

export type EventStoreGet<TState extends AppEventState> = () => TState;
