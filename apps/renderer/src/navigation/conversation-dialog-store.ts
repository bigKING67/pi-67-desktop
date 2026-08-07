import type { SessionSummary, WorkspaceId } from "@pi67/domain";
import { create } from "zustand";

interface ConversationRenameTarget {
  workspaceId: WorkspaceId;
  fileIdentity: string;
  path: string;
  title: string;
  nameSource: SessionSummary["nameSource"];
}

interface ConversationDialogState {
  renameTarget: ConversationRenameTarget | undefined;
  archivedWorkspaceId: WorkspaceId | undefined;
  openRename: (target: ConversationRenameTarget) => void;
  closeRename: () => void;
  openArchived: (workspaceId: WorkspaceId) => void;
  closeArchived: () => void;
}

export const useConversationDialogStore = create<ConversationDialogState>((set) => ({
  renameTarget: undefined,
  archivedWorkspaceId: undefined,
  openRename: (renameTarget) => set({ renameTarget }),
  closeRename: () => set({ renameTarget: undefined }),
  openArchived: (archivedWorkspaceId) => set({ archivedWorkspaceId }),
  closeArchived: () => set({ archivedWorkspaceId: undefined })
}));
