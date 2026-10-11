import { create } from "zustand";
import type { HandoffPicture } from "./team-chat-work-bridge.js";

/**
 * What is offered for hand-off: a Work conversation (its title and Workspace identity, offered
 * as references) or an image project's pictures, sent after the card in one message.
 */
export interface TeamChatHandoffSource {
  title: string;
  workspaceId?: string;
  /** Pictures to list, and the files made on 发送 (undefined when the person stopped it, e.g. at the text check). */
  images?: { labels: string[]; prepare: () => Promise<HandoffPicture[] | undefined> };
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
