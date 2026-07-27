import type { AgentEvent } from "@pi67/protocol";
import { doctorStore } from "../doctor/doctor-store.js";
import { prepareRendererSessionTransaction } from "./renderer-session-transaction.js";
import type { AppEventState, EventStoreSet } from "./app-event-state.js";

export function reduceRuntimeEvent<TState extends AppEventState>(
  event: AgentEvent,
  set: EventStoreSet<TState>
): boolean {
  switch (event.type) {
    case "runtime.statusChanged":
      set({ runtime: event.payload } as Partial<TState>);
      return true;
    case "runtime.crashed":
      prepareRendererSessionTransaction("runtime-crashed");
      set({
        sessionTransitionPending: false,
        operation: undefined,
        operationDetail: undefined,
        operationProgress: undefined,
        runtime: { phase: "failed", detail: event.payload.detail, recoverable: event.payload.recoverable }
      } as unknown as Partial<TState>);
      return true;
    case "diagnostics.progress":
      return true;
    case "doctor.completed":
      doctorStore.getState().complete(event.payload);
      return true;
    default:
      return false;
  }
}
