import { create } from "zustand";

type ShellContextTab = "changes" | "session" | "context";

interface ShellState {
  contextVisible: boolean;
  contextTab: ShellContextTab;
  commandPaletteOpen: boolean;
  doctorDialogOpen: boolean;
  credentialDialogOpen: boolean;
  updateDialogOpen: boolean;
  setContextVisible: (visible: boolean) => void;
  setContextTab: (tab: ShellContextTab) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setDoctorDialogOpen: (open: boolean) => void;
  setCredentialDialogOpen: (open: boolean) => void;
  setUpdateDialogOpen: (open: boolean) => void;
  closeRuntimeBoundDialogs: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  contextVisible: true,
  contextTab: "changes",
  commandPaletteOpen: false,
  doctorDialogOpen: false,
  credentialDialogOpen: false,
  updateDialogOpen: false,
  setContextVisible(contextVisible) { set({ contextVisible }); },
  setContextTab(contextTab) { set({ contextTab }); },
  setCommandPaletteOpen(commandPaletteOpen) { set({ commandPaletteOpen }); },
  setDoctorDialogOpen(doctorDialogOpen) { set({ doctorDialogOpen }); },
  setCredentialDialogOpen(credentialDialogOpen) { set({ credentialDialogOpen }); },
  setUpdateDialogOpen(updateDialogOpen) { set({ updateDialogOpen }); },
  closeRuntimeBoundDialogs() { set({ credentialDialogOpen: false }); }
}));
