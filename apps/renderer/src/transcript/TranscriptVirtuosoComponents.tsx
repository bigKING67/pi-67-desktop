import type { SessionMessageView } from "@pi67/domain";
import { lazy, Suspense } from "react";
import type {
  Components,
  ScrollSeekConfiguration,
  ScrollSeekPlaceholderProps
} from "react-virtuoso";
import { DeferredMessageCard, DeferredTranscriptProcessGroup } from "./DeferredTranscriptRows.js";
import type { TranscriptContext } from "./transcript-context.js";
import type { TranscriptRow } from "./transcript-rows.js";
import styles from "./Transcript.module.css";

const TurnActivity = lazy(() => import("../operation/TurnActivity.js").then((module) => ({
  default: module.TurnActivity
})));

export const TRANSCRIPT_SCROLL_SEEK: ScrollSeekConfiguration = {
  enter: (velocity) => Math.abs(velocity) > 600,
  exit: (velocity) => Math.abs(velocity) < 100
};

export const TRANSCRIPT_COMPONENTS: Components<TranscriptRow, TranscriptContext> = {
  Header: OlderMessagesHeader,
  Footer: LiveTurnFooter,
  ScrollSeekPlaceholder: TranscriptScrollSeekPlaceholder
};

function TranscriptScrollSeekPlaceholder({ height }: ScrollSeekPlaceholderProps) {
  return <div aria-hidden="true" style={{ height }} />;
}

function OlderMessagesHeader({ context }: { context: TranscriptContext }) {
  if (!context.hasOlder && !context.loadingOlder && !context.conversationError) return null;
  return (
    <div className={styles.pagination} role="status">
      <button
        className="small-button"
        data-testid="load-older-messages"
        disabled={context.loadingOlder}
        onClick={() => void context.loadOlderMessages()}
        type="button"
      >
        {context.loadingOlder ? "正在加载更早消息" : "加载更早消息"}
      </button>
      {context.conversationError ? <span role="alert">{context.conversationError}</span> : null}
    </div>
  );
}

function LiveTurnFooter({ context }: { context: TranscriptContext }) {
  if (!context.pendingUserTurn && !context.hasTurnActivity && !context.hasLiveTurn) return null;
  return (
    <>
      {context.pendingUserTurn ? (
        <DeferredMessageCard
          deliveryStatus={context.pendingUserTurn.status}
          localImages={context.pendingUserTurn.attachments.flatMap((attachment) => (
            attachment.kind === "image" && attachment.previewUrl
              ? [{
                  mimeType: attachment.mimeType,
                  name: attachment.name,
                  objectUrl: attachment.previewUrl
                }]
              : []
          ))}
          message={context.pendingUserTurn.message}
          onRetry={context.pendingUserTurn.retryableVisionAssistance
            ? context.retryPendingVisualAssistance
            : undefined}
        />
      ) : null}
      {context.liveProcess ? (
        <DeferredTranscriptProcessGroup
          liveThinking={context.liveThinking}
          operation={context.liveProcess.operation}
          row={context.liveProcess.row}
          running={context.liveProcess.running}
          {...(context.liveProcess.timeline === undefined
            ? {}
            : { timeline: context.liveProcess.timeline })}
        />
      ) : context.hasTurnActivity ? (
        <Suspense fallback={<TranscriptActivityLoading />}>
          <TurnActivity />
        </Suspense>
      ) : null}
      {context.liveText
        ? <DeferredMessageCard message={liveMessage(context.liveText)} streaming />
        : null}
    </>
  );
}

function TranscriptActivityLoading() {
  return (
    <div aria-busy="true" aria-label="正在加载任务状态" className={styles.rowLoading} role="status">
      <span className="loading-line" />
    </div>
  );
}

function liveMessage(text: string): SessionMessageView {
  return {
    id: "live-assistant-message",
    role: "assistant",
    parts: [{ type: "text", text }]
  };
}
