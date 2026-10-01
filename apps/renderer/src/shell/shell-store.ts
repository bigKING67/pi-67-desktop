import { create } from "zustand";

type ShellContextTab = "files" | "changes" | "messages" | "agents" | "context";
type ShellContextDetailTab = "session" | "memory" | "experience";

interface SessionChangeFocusRequest {
  toolCallId: string;
  revision: number;
}

export type WorkspaceMode = "work" | "chat";

interface ShellState {
  /** Work (local Pi Sessions) or Chat (New Money Team Chat); layout state only. */
  workspaceMode: WorkspaceMode;
  navigationVisible: boolean;
  sessionSearchFocusRevision: number;
  sessionSearchHandledRevision: number;
  modelPickerRequestRevision: number;
  modelPickerHandledRevision: number;
  contextVisible: boolean;
  contextTab: ShellContextTab;
  contextDetailTab: ShellContextDetailTab;
  sessionChangeFocusRequest: SessionChangeFocusRequest | undefined;
  sessionChangeFocusHandledRevision: number;
  sessionTreeDialogOpen: boolean;
  commandPaletteOpen: boolean;
  keyboardShortcutsDialogOpen: boolean;
  workspaceConversationSearchDialogOpen: boolean;
  workspaceContentSearchDialogOpen: boolean;
  doctorDialogOpen: boolean;
  credentialDialogOpen: boolean;
  credentialDialogProviderId: string | undefined;
  updateDialogOpen: boolean;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setNavigationVisible: (visible: boolean) => void;
  openSessionCatalog: () => void;
  acknowledgeSessionSearchFocus: (revision: number) => void;
  requestModelPicker: () => void;
  acknowledgeModelPickerRequest: (revision: number) => void;
  setContextVisible: (visible: boolean) => void;
  setContextTab: (tab: ShellContextTab) => void;
  setContextDetailTab: (tab: ShellContextDetailTab) => void;
  focusSessionChange: (toolCallId: string) => void;
  acknowledgeSessionChangeFocus: (revision: number) => void;
  setSessionTreeDialogOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setKeyboardShortcutsDialogOpen: (open: boolean) => void;
  setWorkspaceConversationSearchDialogOpen: (open: boolean) => void;
  setWorkspaceContentSearchDialogOpen: (open: boolean) => void;
  setDoctorDialogOpen: (open: boolean) => void;
  setCredentialDialogOpen: (open: boolean, providerId?: string) => void;
  setUpdateDialogOpen: (open: boolean) => void;
  closeNonBlockingDialogs: () => void;
  closeRuntimeBoundDialogs: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  workspaceMode: "work",
  navigationVisible: true,
  sessionSearchFocusRevision: 0,
  sessionSearchHandledRevision: 0,
  modelPickerRequestRevision: 0,
  modelPickerHandledRevision: 0,
  contextVisible: true,
  contextTab: "files",
  contextDetailTab: "session",
  sessionChangeFocusRequest: undefined,
  sessionChangeFocusHandledRevision: 0,
  sessionTreeDialogOpen: false,
  commandPaletteOpen: false,
  keyboardShortcutsDialogOpen: false,
  workspaceConversationSearchDialogOpen: false,
  workspaceContentSearchDialogOpen: false,
  doctorDialogOpen: false,
  credentialDialogOpen: false,
  credentialDialogProviderId: undefined,
  updateDialogOpen: false,
  setWorkspaceMode(workspaceMode) { set({ workspaceMode }); },
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
  setContextDetailTab(contextDetailTab) { set({ contextDetailTab }); },
  focusSessionChange(toolCallId) {
    set((state) => ({
      contextVisible: true,
      contextTab: "changes",
      sessionChangeFocusRequest: {
        toolCallId,
        revision: (state.sessionChangeFocusRequest?.revision ?? 0) + 1
      }
    }));
  },
  acknowledgeSessionChangeFocus(revision) {
    set((state) => ({
      sessionChangeFocusHandledRevision: Math.max(state.sessionChangeFocusHandledRevision, revision)
    }));
  },
  setSessionTreeDialogOpen(sessionTreeDialogOpen) { set({ sessionTreeDialogOpen }); },
  setCommandPaletteOpen(commandPaletteOpen) { set({ commandPaletteOpen }); },
  setKeyboardShortcutsDialogOpen(keyboardShortcutsDialogOpen) { set({ keyboardShortcutsDialogOpen }); },
  setWorkspaceConversationSearchDialogOpen(workspaceConversationSearchDialogOpen) {
    set({ workspaceConversationSearchDialogOpen });
  },
  setWorkspaceContentSearchDialogOpen(workspaceContentSearchDialogOpen) {
    set({ workspaceContentSearchDialogOpen });
  },
  setDoctorDialogOpen(doctorDialogOpen) { set({ doctorDialogOpen }); },
  setCredentialDialogOpen(credentialDialogOpen, credentialDialogProviderId) {
    set({
      credentialDialogOpen,
      credentialDialogProviderId: credentialDialogOpen ? credentialDialogProviderId : undefined
    });
  },
  setUpdateDialogOpen(updateDialogOpen) { set({ updateDialogOpen }); },
  closeNonBlockingDialogs() {
    set({
      commandPaletteOpen: false,
      keyboardShortcutsDialogOpen: false,
      workspaceConversationSearchDialogOpen: false,
      workspaceContentSearchDialogOpen: false,
      doctorDialogOpen: false,
      credentialDialogOpen: false,
      credentialDialogProviderId: undefined,
      updateDialogOpen: false,
      sessionTreeDialogOpen: false
    });
  },
  closeRuntimeBoundDialogs() {
    set({
      credentialDialogOpen: false,
      credentialDialogProviderId: undefined,
      sessionTreeDialogOpen: false
    });
  }
}));
