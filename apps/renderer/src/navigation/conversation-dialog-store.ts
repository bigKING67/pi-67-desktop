import type { SessionSummary, WorkspaceId } from "@pi67/domain";
import { create } from "zustand";

interface ConversationRenameTarget {
  workspaceId: WorkspaceId;
  fileIdentity: string;
  path: string;
  title: string;
  nameSource: SessionSummary["nameSource"];
}

interface ConversationDraftDiscardTarget {
  taskId: string;
  title: string;
}

interface ConversationDialogState {
  renameTarget: ConversationRenameTarget | undefined;
  draftDiscardTarget: ConversationDraftDiscardTarget | undefined;
  archivedWorkspaceId: WorkspaceId | undefined;
  openRename: (target: ConversationRenameTarget) => void;
  closeRename: () => void;
  openDraftDiscard: (target: ConversationDraftDiscardTarget) => void;
  closeDraftDiscard: () => void;
  openArchived: (workspaceId: WorkspaceId) => void;
  closeArchived: () => void;
}

export const useConversationDialogStore = create<ConversationDialogState>((set) => ({
  renameTarget: undefined,
  draftDiscardTarget: undefined,
  archivedWorkspaceId: undefined,
  openRename: (renameTarget) => set({ renameTarget }),
  closeRename: () => set({ renameTarget: undefined }),
  openDraftDiscard: (draftDiscardTarget) => set({ draftDiscardTarget }),
  closeDraftDiscard: () => set({ draftDiscardTarget: undefined }),
  openArchived: (archivedWorkspaceId) => set({ archivedWorkspaceId }),
  closeArchived: () => set({ archivedWorkspaceId: undefined })
}));
