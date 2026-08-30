import type { LocatedMessageWindow, SessionMessageView } from "@pi67/domain";
import { CircleAlert, MessageSquareText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../app/app-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSessionGeneration, selectSessionId } from "../session/session-projection-selectors.js";
import { requestComposerPrefill } from "../composer/composer-events.js";
import { retryPendingVisualAssistance } from "../composer/prompt-submission-controller.js";
import { loadOlderConversation } from "../conversation/conversation-controller.js";
import { useCommittedConversationProjection } from "../conversation/conversation-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { messages as messagesCatalog } from "../localization/message-catalog.js";
import { isActiveOperationLifecycle } from "../operation/operation-lifecycle.js";
import {
  timelineMatchesOperation,
  useOperationActivityTimelineStore
} from "../operation/operation-activity-timeline-store.js";
import {
  hasVisibleOperationTimeline,
  hasVisibleTurnActivity
} from "../operation/turn-activity-visibility.js";
import {
  continueRendererSessionFrom,
  editRendererUserMessage,
  restoreRendererMessageEdit,
  sessionForkActionBlockedReason,
  submitRendererEditedMessage
} from "../session/session-lifecycle-controller.js";
import {
  selectedWorkbenchTask,
  useWorkbenchStore
} from "../workbench/workbench-store.js";
import { DeferredMessageCard, DeferredTranscriptProcessGroup } from "./DeferredTranscriptRows.js";
import { DeferredPlanProposalCard } from "./DeferredPlanProposalCard.js";
import { DeferredTranscriptList } from "./DeferredTranscriptList.js";
import { editableUserMessageText } from "./message-actions.js";
import { useTranscriptMessageFocus } from "./transcript-message-focus.js";
import { subscribeTranscriptMessageJump } from "./transcript-navigation.js";
import {
  createLiveProcessRow,
  findTranscriptRowIndexByMessageId,
  hasFinalAnswerAfterLatestUser,
  hasProcessGroupAfterLatestUser,
  projectTranscriptRows,
  transcriptRowContainsMessage
} from "./transcript-rows.js";
import styles from "./Transcript.module.css";
import { ConversationFindBar } from "../search/ConversationFindBar.js";
import { SessionCompatibilityBanner } from "./SessionCompatibilityBanner.js";
import {
  conversationReadPositionKey
} from "./conversation-read-position-store.js";
import {
  TRANSCRIPT_COMPONENTS,
  TRANSCRIPT_SCROLL_SEEK
} from "./TranscriptVirtuosoComponents.js";
import { useTranscriptScrollController } from "./use-transcript-scroll-controller.js";

export function Transcript() {
  const selectedTask = useWorkbenchStore(selectedWorkbenchTask);
  const [messageEdit, setMessageEdit] = useState<InlineMessageEditState>();
  const [historicalWindow, setHistoricalWindow] = useState<LocatedMessageWindow>();
  const [highlightedMessageId, setHighlightedMessageId] = useState<string>();
  const [focusHighlightedMessage, setFocusHighlightedMessage] = useState(true);
  const transcriptRegionRef = useRef<HTMLDivElement>(null);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const runtime = useAppStore((state) => state.runtime);
  const operation = useAppStore((state) => state.operation);
  const operationTimeline = useOperationActivityTimelineStore((state) => state.timeline);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const {
    messages,
    pendingUserTurn,
    page,
    streaming,
    loadingOlder,
    firstItemIndex,
    error: conversationError
  } = useCommittedConversationProjection();
  const textChunks = useLiveTurnStore((state) => state.textChunks);
  const thinkingChunks = useLiveTurnStore((state) => state.thinkingChunks);
  const liveText = useMemo(() => textChunks.join(""), [textChunks]);
  const liveThinking = useMemo(() => thinkingChunks.join(""), [thinkingChunks]);
  const hasLiveTurn = Boolean(liveText || liveThinking);
  const currentEdit = messageEdit?.taskId === selectedTask?.id ? messageEdit : undefined;
  const transcriptMessages = useMemo(() => (
    currentEdit && !messages.some((message) => message.id === currentEdit.message.id)
      ? [...messages, currentEdit.message]
      : messages
  ), [currentEdit, messages]);
  const visibleMessages = historicalWindow?.messages ?? transcriptMessages;
  const transcriptRows = useMemo(() => projectTranscriptRows(visibleMessages), [visibleMessages]);
  const readKey = conversationReadPositionKey(
    selectedTask?.workspaceId,
    selectedTask?.sessionFileIdentity
  );
  const transcriptFirstItemIndex = historicalWindow
    ? 0
    : firstItemIndex + transcriptMessages.length - transcriptRows.length;
  const historicalAnchorRowIndex = historicalWindow
    ? Math.max(0, findTranscriptRowIndexByMessageId(transcriptRows, historicalWindow.anchorId))
    : undefined;
  const hasCurrentProcessGroup = !pendingUserTurn && hasProcessGroupAfterLatestUser(transcriptRows);
  const hasCurrentFinalAnswer = !pendingUserTurn
    && operation?.kind === "prompt"
    && hasFinalAnswerAfterLatestUser(transcriptRows);
  const currentProcessGroupKey = hasCurrentProcessGroup
    ? [...transcriptRows].reverse().find((row) => row.kind === "process-group")?.key
    : undefined;
  const operationMatchesSession = operation !== undefined
    && operation.sessionId === sessionId
    && operation.sessionGeneration === sessionGeneration;
  const matchingOperationTimeline = timelineMatchesOperation(
    operationTimeline,
    operation,
    sessionId,
    sessionGeneration
  ) ? operationTimeline : undefined;
  const currentProcessRunning = operationMatchesSession
    && isActiveOperationLifecycle(operation.lifecycle);
  const hasTurnActivity = !hasCurrentProcessGroup && (
    hasVisibleTurnActivity(runtime.phase, operation, sessionId, sessionGeneration)
    || (
      hasVisibleOperationTimeline(operationTimeline, operation, sessionId, sessionGeneration)
    )
  );
  const liveProcess = hasTurnActivity
    && operationMatchesSession
    && (operation.kind === "prompt" || operation.kind === "command")
    ? {
      row: createLiveProcessRow(operation, Boolean(liveText) || hasCurrentFinalAnswer),
      operation,
      timeline: matchingOperationTimeline,
      running: currentProcessRunning
    }
    : undefined;
  const messageActionDisabledReason = currentEdit
    ? messagesCatalog.transcript.finishMessageEdit
    : historicalWindow
      ? "正在查看较早消息，请先回到最新消息。"
      : sessionForkActionBlockedReason();
  const {
    atBottom,
    bindScroller,
    handleAtBottomStateChange,
    handleRangeChanged,
    handleTotalListHeightChanged,
    restoredAnchorRowIndex,
    returnToLatest: restoreLatestScroll,
    stopFollowingLatest,
    unseenRowCount,
    virtuosoRef: transcriptRef
  } = useTranscriptScrollController({
    firstItemIndex: transcriptFirstItemIndex,
    historical: Boolean(historicalWindow),
    readKey,
    rows: transcriptRows
  });

  const returnToLatest = useCallback(() => {
    setHistoricalWindow(undefined);
    setHighlightedMessageId(undefined);
    restoreLatestScroll();
  }, [restoreLatestScroll]);

  useEffect(() => subscribeTranscriptMessageJump((target) => {
    stopFollowingLatest();
    if (target.window) setHistoricalWindow(target.window);
    setFocusHighlightedMessage(target.focus !== "preserve");
    setHighlightedMessageId(target.id);
  }), [stopFollowingLatest]);

  useEffect(() => {
    setHistoricalWindow(undefined);
    setHighlightedMessageId(undefined);
  }, [sessionId]);

  useEffect(() => {
    if (!pendingUserTurn) return;
    returnToLatest();
  }, [pendingUserTurn, returnToLatest]);

  useTranscriptMessageFocus({
    focusMessage: focusHighlightedMessage,
    highlightedMessageId,
    regionRef: transcriptRegionRef,
    rows: transcriptRows,
    setHighlightedMessageId,
    virtuosoRef: transcriptRef
  });

  if (!sessionId || (sessionTransitionPending && !currentEdit)) {
    if (runtime.phase === "failed") {
      return (
        <div className={styles.error} role="alert">
          <CircleAlert size={22} />
          <strong>无法创建会话</strong>
          <span>{runtime.detail}</span>
        </div>
      );
    }
    return <div className={styles.loading}><span className="loading-line" />{runtime.detail}</div>;
  }

  if (transcriptMessages.length === 0 && !pendingUserTurn && !hasLiveTurn && !hasTurnActivity) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}><MessageSquareText size={22} /></div>
        <h2>从一个具体任务开始</h2>
        <p>描述目标、相关文件和验收标准。Pi 会使用当前工作区、模型和已加载资源。</p>
        <div className={styles.starterPrompts}>
          {STARTER_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => requestComposerPrefill(prompt)}>{prompt}</button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.region}
      data-has-live-turn={hasLiveTurn}
      data-has-turn-activity={hasTurnActivity}
      data-message-count={transcriptMessages.length}
      data-pending-user-turn={pendingUserTurn ? "true" : "false"}
      data-session-id={sessionId}
      data-historical-window={historicalWindow ? "true" : "false"}
      data-transcript-region="true"
      ref={transcriptRegionRef}
    >
      {selectedTask ? <ConversationFindBar task={selectedTask} /> : null}
      <SessionCompatibilityBanner />
      {historicalWindow ? (
        <div className={styles.historicalBanner} role="status">
          <span>正在查看较早消息</span>
          <button
            type="button"
            onClick={returnToLatest}
          >回到最新消息</button>
        </div>
      ) : null}
      {/* Explicit paging avoids Virtuoso chaining requests while a prepend preserves the top anchor. */}
      <DeferredTranscriptList
        key={`${sessionId}:${historicalWindow?.anchorId ?? "latest"}`}
        virtuosoRef={transcriptRef}
        components={TRANSCRIPT_COMPONENTS}
        context={{
          hasLiveTurn: historicalWindow ? false : hasLiveTurn,
          hasTurnActivity: historicalWindow ? false : hasTurnActivity,
          pendingUserTurn: historicalWindow ? undefined : pendingUserTurn,
          liveText: historicalWindow ? "" : liveText,
          liveThinking: historicalWindow ? "" : liveThinking,
          hasOlder: historicalWindow ? false : page.hasOlder,
          loadingOlder: historicalWindow ? false : loadingOlder,
          conversationError: historicalWindow ? undefined : conversationError,
          liveProcess: historicalWindow ? undefined : liveProcess,
          loadOlderMessages: loadOlderConversation,
          retryPendingVisualAssistance
        }}
        data={transcriptRows}
        computeItemKey={(_index, row) => row.key}
        defaultItemHeight={120}
        firstItemIndex={transcriptFirstItemIndex}
        followOutput={!historicalWindow && (streaming || hasTurnActivity) ? "auto" : false}
        increaseViewportBy={{ top: 400, bottom: 100 }}
        scrollerRef={bindScroller}
        scrollSeekConfiguration={TRANSCRIPT_SCROLL_SEEK}
        totalListHeightChanged={handleTotalListHeightChanged}
        initialTopMostItemIndex={historicalAnchorRowIndex === undefined
          ? restoredAnchorRowIndex >= 0
            ? { index: restoredAnchorRowIndex, align: "start" }
            : { index: "LAST", align: "end" }
          : { index: historicalAnchorRowIndex, align: "center" }}
        atBottomStateChange={handleAtBottomStateChange}
        rangeChanged={handleRangeChanged}
        itemContent={(_index, row) => {
          if (row.kind === "plan-proposal") {
            return <DeferredPlanProposalCard plan={row.plan} />;
          }
          if (row.kind === "process-group") {
            const current = row.key === currentProcessGroupKey;
            const currentOperation = current && operationMatchesSession ? operation : undefined;
            return (
              <DeferredTranscriptProcessGroup
                highlighted={highlightedMessageId === undefined
                  ? false
                  : transcriptRowContainsMessage(row, highlightedMessageId)}
                liveThinking={current ? liveThinking : ""}
                row={row}
                running={current && currentProcessRunning}
                {...(currentOperation === undefined ? {} : { operation: currentOperation })}
                {...(!current || matchingOperationTimeline === undefined
                  ? {}
                  : { timeline: matchingOperationTimeline })}
              />
            );
          }
          const message = row.message;
          return (
            <DeferredMessageCard
              actionDisabledReason={messageActionDisabledReason}
              highlighted={highlightedMessageId === message.id}
              edit={!historicalWindow && currentEdit?.message.id === message.id ? {
                value: currentEdit.value,
                phase: currentEdit.phase,
                ...(currentEdit.error === undefined ? {} : { error: currentEdit.error }),
                onChange: (value) => setMessageEdit((current) => current?.taskId === currentEdit.taskId
                  ? { ...current, value, error: undefined }
                  : current),
                onCancel: () => void cancelMessageEdit(currentEdit),
                onSubmit: () => void submitMessageEdit(currentEdit)
              } : undefined}
              message={message}
              onContinue={!historicalWindow && message.role === "assistant"
                ? () => continueRendererSessionFrom(message.id)
                : undefined}
              onEditStart={!historicalWindow && message.role === "user"
                ? () => beginMessageEdit(message)
                : undefined}
            />
          );
        }}
      />
      {!historicalWindow && !atBottom ? (
        <button className={styles.latestButton} onClick={returnToLatest} type="button">
          回到最新{unseenRowCount > 0 ? ` · ${unseenRowCount} 条新内容` : ""}
        </button>
      ) : null}
    </div>
  );

  function beginMessageEdit(message: SessionMessageView): void {
    const text = editableUserMessageText(message);
    if (!selectedTask?.sessionPath || !text) return;
    setMessageEdit({
      taskId: selectedTask.id,
      sourceSessionPath: selectedTask.sessionPath,
      message,
      value: text,
      phase: "editing"
    });
  }

  async function submitMessageEdit(edit: InlineMessageEditState): Promise<void> {
    if (edit.phase === "submitting" || !edit.value.trim()) return;
    setMessageEdit((current) => current?.taskId === edit.taskId
      ? { ...current, phase: "submitting", error: undefined }
      : current);
    const result = edit.phase === "prepared"
      ? await submitRendererEditedMessage(edit.taskId, edit.value)
      : await editRendererUserMessage(edit.taskId, edit.message.id, edit.value);
    if (result.status === "accepted") {
      setMessageEdit((current) => current?.taskId === edit.taskId ? undefined : current);
      return;
    }
    setMessageEdit((current) => current?.taskId === edit.taskId ? {
      ...current,
      phase: result.status === "prepared" ? "prepared" : "editing",
      error: result.status === "prepared"
        ? `${messagesCatalog.transcript.editPreparedRetry} ${result.error}`
        : result.error
    } : current);
  }

  async function cancelMessageEdit(edit: InlineMessageEditState): Promise<void> {
    if (edit.phase === "submitting") return;
    if (edit.phase === "prepared") {
      setMessageEdit((current) => current?.taskId === edit.taskId
        ? { ...current, phase: "submitting", error: undefined }
        : current);
      if (!await restoreRendererMessageEdit(edit.taskId, edit.sourceSessionPath)) {
        setMessageEdit((current) => current?.taskId === edit.taskId ? {
          ...current,
          phase: "prepared",
          error: messagesCatalog.transcript.restoreEditFailed
        } : current);
        return;
      }
    }
    setMessageEdit((current) => current?.taskId === edit.taskId ? undefined : current);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(edit.message.id)}"] [aria-label="${messagesCatalog.transcript.editMessage}"]`
      )?.focus();
    });
  }
}

interface InlineMessageEditState {
  taskId: string;
  sourceSessionPath: string;
  message: SessionMessageView;
  value: string;
  phase: "editing" | "submitting" | "prepared";
  error?: string | undefined;
}

const STARTER_PROMPTS = [
  "解释这个项目的运行入口",
  "检查当前 Git 改动并找出风险",
  "实现一个有测试覆盖的小功能"
] as const;
