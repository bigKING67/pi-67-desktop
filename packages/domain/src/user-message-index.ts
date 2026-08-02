import type { ConversationPage } from "./session-view.js";

export interface UserMessageIndexItem {
  id: string;
  ordinal: number;
  preview: string;
  createdAt?: number;
  imageCount: number;
  attachmentCount: number;
}

export interface UserMessageIndexPage {
  sessionId: string;
  revision: number;
  total: number;
  offset: number;
  items: UserMessageIndexItem[];
}

export interface LocatedMessageWindow extends ConversationPage {
  anchorId: string;
  revision: number;
}
