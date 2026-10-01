import { create } from "zustand";

/** A Work conversation offered for hand-off; only its title and Workspace identity. */
export interface TeamChatHandoffSource {
  workspaceId: string;
  title: string;
}

/** Reviewed starting text for a team-scoped Work draft. */
export interface TeamChatStartWorkSource {
  text: string;
}

interface TeamChatDialogState {
  handoff: TeamChatHandoffSource | undefined;
  startWork: TeamChatStartWorkSource | undefined;
  openHandoff: (source: TeamChatHandoffSource) => void;
  openStartWork: (source: TeamChatStartWorkSource) => void;
  close: () => void;
}

export const useTeamChatDialogStore = create<TeamChatDialogState>((set) => ({
  handoff: undefined,
  startWork: undefined,
  openHandoff: (handoff) => set({ handoff, startWork: undefined }),
  openStartWork: (startWork) => set({ startWork, handoff: undefined }),
  close: () => set({ handoff: undefined, startWork: undefined })
}));
