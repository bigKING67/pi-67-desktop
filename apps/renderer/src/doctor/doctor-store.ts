import type { DoctorReport } from "@pi67/domain";
import { createStore } from "zustand/vanilla";

export interface DoctorState {
  report: DoctorReport | undefined;
  running: boolean;
  error: string | undefined;
  begin: () => void;
  complete: (report: DoctorReport) => void;
  fail: (error: string) => void;
}

export const doctorStore = createStore<DoctorState>((set) => ({
  report: undefined,
  running: false,
  error: undefined,
  begin() {
    set({ report: undefined, running: true, error: undefined });
  },
  complete(report) {
    set({ report, running: false, error: undefined });
  },
  fail(error) {
    set({ running: false, error });
  }
}));
