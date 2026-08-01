import { create } from "zustand";

type ShellContextTab = "changes" | "session" | "context";

interface ShellState {
  navigationVisible: boolean;
  sessionSearchFocusRevision: number;
  sessionSearchHandledRevision: number;
  modelPickerRequestRevision: number;
  modelPickerHandledRevision: number;
  contextVisible: boolean;
  contextTab: ShellContextTab;
  commandPaletteOpen: boolean;
  doctorDialogOpen: boolean;
  credentialDialogOpen: boolean;
  updateDialogOpen: boolean;
  setNavigationVisible: (visible: boolean) => void;
  openSessionCatalog: () => void;
  acknowledgeSessionSearchFocus: (revision: number) => void;
  requestModelPicker: () => void;
  acknowledgeModelPickerRequest: (revision: number) => void;
  setContextVisible: (visible: boolean) => void;
  setContextTab: (tab: ShellContextTab) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setDoctorDialogOpen: (open: boolean) => void;
  setCredentialDialogOpen: (open: boolean) => void;
  setUpdateDialogOpen: (open: boolean) => void;
  closeRuntimeBoundDialogs: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  navigationVisible: true,
  sessionSearchFocusRevision: 0,
  sessionSearchHandledRevision: 0,
  modelPickerRequestRevision: 0,
  modelPickerHandledRevision: 0,
  contextVisible: true,
  contextTab: "changes",
  commandPaletteOpen: false,
  doctorDialogOpen: false,
  credentialDialogOpen: false,
  updateDialogOpen: false,
  setNavigationVisible(navigationVisible) { set({ navigationVisible }); },
  openSessionCatalog() {
    set((state) => ({
      navigationVisible: true,
      sessionSearchFocusRevision: state.sessionSearchFocusRevision + 1
    }));
  },
  acknowledgeSessionSearchFocus(revision) {
    set((state) => ({
      sessionSearchHandledRevision: Math.max(state.sessionSearchHandledRevision, revision)
    }));
  },
  requestModelPicker() {
    set((state) => ({ modelPickerRequestRevision: state.modelPickerRequestRevision + 1 }));
  },
  acknowledgeModelPickerRequest(revision) {
    set((state) => ({
      modelPickerHandledRevision: Math.max(state.modelPickerHandledRevision, revision)
    }));
  },
  setContextVisible(contextVisible) { set({ contextVisible }); },
  setContextTab(contextTab) { set({ contextTab }); },
  setCommandPaletteOpen(commandPaletteOpen) { set({ commandPaletteOpen }); },
  setDoctorDialogOpen(doctorDialogOpen) { set({ doctorDialogOpen }); },
  setCredentialDialogOpen(credentialDialogOpen) { set({ credentialDialogOpen }); },
  setUpdateDialogOpen(updateDialogOpen) { set({ updateDialogOpen }); },
  closeRuntimeBoundDialogs() { set({ credentialDialogOpen: false }); }
}));
