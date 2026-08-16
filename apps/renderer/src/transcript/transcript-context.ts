import type { OperationView } from "@pi67/domain";
import type { PendingUserTurn } from "../conversation/conversation-store.js";
import type { OperationActivityTimeline } from "../operation/operation-activity-timeline-store.js";
import type { TranscriptRow } from "./transcript-rows.js";

export interface TranscriptContext {
  hasLiveTurn: boolean;
  hasTurnActivity: boolean;
  pendingUserTurn: PendingUserTurn | undefined;
  liveText: string;
  liveThinking: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  conversationError: string | undefined;
  liveProcess: {
    row: Extract<TranscriptRow, { kind: "process-group" }>;
    operation: OperationView;
    timeline: OperationActivityTimeline | undefined;
    running: boolean;
  } | undefined;
  loadOlderMessages: () => Promise<void>;
  retryPendingVisualAssistance: () => Promise<boolean>;
}
