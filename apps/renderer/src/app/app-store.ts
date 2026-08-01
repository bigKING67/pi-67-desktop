import { create } from "zustand";
import {
  handleConnected,
  handleHostFailure,
  handlePowerResume,
  handleSequenceGap,
  handleTeardown
} from "../connection/connection-state.js";
import { INITIAL_RUNTIME_STATE } from "./app-state-projection.js";
import { handleAgentEvent } from "./app-events.js";
import { handleProjectionEvent } from "./incremental-projection.js";
import {
  recoverSessionImportTerminalWithoutBootstrap
} from "./session-import-bootstrap-recovery.js";
import type { AppState } from "./app-store.types.js";
import { DEFAULT_APPROVAL_MODE } from "@pi67/domain";

export const useAppStore = create<AppState>((set, get) => ({
  connectionIdentity: undefined,
  hostEpoch: undefined,
  connected: false,
  runtime: INITIAL_RUNTIME_STATE,
  workspace: undefined,
  trust: "unknown",
  trustUpdating: false,
  sessionTransitionPending: false,
  sessionBootstrapTransitionPending: false,
  approvalMode: DEFAULT_APPROVAL_MODE,
  operation: undefined,
  operationDetail: undefined,
  operationProgress: undefined,

  handleAgentConnected(identity) {
    handleConnected(get, set, identity);
  },

  handleAgentTeardown(error) {
    handleTeardown(get, set, error);
  },

  handleSequenceGap(gap) {
    handleSequenceGap(get, set, gap);
  },

  handleAgentHostFailed(state) {
    handleHostFailure(get, set, state);
  },

  handlePowerResume() {
    handlePowerResume(get, set);
  },

  receiveAgentEvent(event, envelope) {
    if (handleProjectionEvent(event, envelope, get, set)) return;
    handleAgentEvent(event, envelope, get, set, (terminal, terminalEnvelope) => {
      recoverSessionImportTerminalWithoutBootstrap(terminal, terminalEnvelope, get, set);
    });
  }
}));
