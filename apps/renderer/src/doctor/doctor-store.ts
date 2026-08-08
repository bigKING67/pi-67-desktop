import type { DoctorReport } from "@pi67/domain";
import type {
  DesktopRecoverySnapshot,
  RendererAcknowledgementDiagnostics,
  RuntimeDiagnostics
} from "@pi67/protocol";
import { createStore } from "zustand/vanilla";

export interface DoctorState {
  report: DoctorReport | undefined;
  diagnostics: RuntimeDiagnostics | undefined;
  recovery: DesktopRecoverySnapshot | undefined;
  renderer: RendererAcknowledgementDiagnostics | undefined;
  running: boolean;
  recoveryLoading: boolean;
  error: string | undefined;
  recoveryError: string | undefined;
  begin: () => void;
  complete: (report: DoctorReport) => void;
  completeDiagnostics: (diagnostics: RuntimeDiagnostics) => void;
  completeRecovery: (recovery: DesktopRecoverySnapshot) => void;
  completeRenderer: (renderer: RendererAcknowledgementDiagnostics) => void;
  finish: () => void;
  fail: (error: string) => void;
  failRecovery: (error: string) => void;
}

export const doctorStore = createStore<DoctorState>((set) => ({
  report: undefined,
  diagnostics: undefined,
  recovery: undefined,
  renderer: undefined,
  running: false,
  recoveryLoading: false,
  error: undefined,
  recoveryError: undefined,
  begin() {
    set({
      report: undefined,
      diagnostics: undefined,
      recovery: undefined,
      renderer: undefined,
      running: true,
      recoveryLoading: true,
      error: undefined,
      recoveryError: undefined
    });
  },
  complete(report) {
    set({ report });
  },
  completeDiagnostics(diagnostics) {
    set({ diagnostics });
  },
  completeRecovery(recovery) {
    set({ recovery, recoveryLoading: false, recoveryError: undefined });
  },
  completeRenderer(renderer) {
    set({ renderer });
  },
  finish() {
    set({ running: false, error: undefined });
  },
  fail(error) {
    set({ running: false, error });
  },
  failRecovery(recoveryError) {
    set({ recoveryLoading: false, recoveryError });
  }
}));
