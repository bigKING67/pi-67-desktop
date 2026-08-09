import type { LocatedMessageWindow, SessionMessageView } from "@pi67/domain";
import { CircleAlert, MessageSquareText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ListRange, VirtuosoHandle } from "react-virtuoso";
import { useAppStore } from "../app/app-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSessionGeneration, selectSessionId } from "../session/session-projection-selectors.js";
import { requestComposerPrefill } from "../composer/composer-events.js";
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
import { DeferredTranscriptList } from "./DeferredTranscriptList.js";
import { editableUserMessageText } from "./message-actions.js";
import { PlanProposalCard } from "./PlanProposalCard.js";
import { useTranscriptMessageFocus } from "./transcript-message-focus.js";
import { subscribeTranscriptMessageJump } from "./transcript-navigation.js";
import {
  createLiveProcessRow,
  hasProcessGroupAfterLatestUser,
  projectTranscriptRows
} from "./transcript-rows.js";
import styles from "./Transcript.module.css";
import { ConversationFindBar } from "../search/ConversationFindBar.js";
import { SessionCompatibilityBanner } from "./SessionCompatibilityBanner.js";
import {
  conversationReadPositionKey,
  useConversationReadPositionStore
} from "./conversation-read-position-store.js";
import {
  TRANSCRIPT_COMPONENTS,
  TRANSCRIPT_SCROLL_SEEK
} from "./TranscriptVirtuosoComponents.js";

export function Transcript() {
  const selectedTask = useWorkbenchStore(selectedWorkbenchTask);
  const [messageEdit, setMessageEdit] = useState<InlineMessageEditState>();
  const [historicalWindow, setHistoricalWindow] = useState<LocatedMessageWindow>();
  const [highlightedMessageId, setHighlightedMessageId] = useState<string>();
  const [atBottom, setAtBottom] = useState(true);
  const [unseenRowCount, setUnseenRowCount] = useState(0);
  const transcriptRegionRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<VirtuosoHandle>(null);
  const previousRowsRef = useRef<{
    readKey: string | undefined;
    count: number;
    lastKey: string | undefined;
  } | undefined>(undefined);
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
  const savedReadPosition = readKey
    ? useConversationReadPositionStore.getState().positions[readKey]
    : undefined;
  const transcriptFirstItemIndex = historicalWindow
    ? 0
    : firstItemIndex + transcriptMessages.length - transcriptRows.length;
  const restoredAnchorRowIndex = !historicalWindow && savedReadPosition && !savedReadPosition.atBottom
    ? transcriptRows.findIndex((row) => row.key === savedReadPosition.anchorKey)
    : -1;
  const historicalAnchorRowIndex = historicalWindow
    ? Math.max(0, transcriptRows.findIndex((row) => (
      row.kind === "message" && row.message.id === historicalWindow.anchorId
    )))
    : undefined;
  const hasCurrentProcessGroup = !pendingUserTurn && hasProcessGroupAfterLatestUser(transcriptRows);
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
  const currentProcessInterrupted = operationMatchesSession
    && (operation.lifecycle === "failed" || operation.lifecycle === "cancelled" || operation.lifecycle === "lost");
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
      row: createLiveProcessRow(operation, currentProcessInterrupted, Boolean(liveText)),
      operation,
      timeline: matchingOperationTimeline,
      running: currentProcessRunning,
      interrupted: currentProcessInterrupted,
      completed: operation.lifecycle === "completed"
    }
    : undefined;
  const messageActionDisabledReason = currentEdit
    ? messagesCatalog.transcript.finishMessageEdit
    : historicalWindow
      ? "正在查看较早消息，请先回到最新消息。"
      : sessionForkActionBlockedReason();

  useEffect(() => subscribeTranscriptMessageJump((target) => {
    if (target.window) setHistoricalWindow(target.window);
    setHighlightedMessageId(target.id);
  }), []);

  useEffect(() => {
    setHistoricalWindow(undefined);
    setHighlightedMessageId(undefined);
  }, [sessionId]);

  useEffect(() => {
    const saved = readKey
      ? useConversationReadPositionStore.getState().positions[readKey]
      : undefined;
    setAtBottom(saved?.atBottom ?? true);
    setUnseenRowCount(saved?.unseenCount ?? 0);
    previousRowsRef.current = {
      readKey,
      count: transcriptRows.length,
      lastKey: transcriptRows.at(-1)?.key
    };
  }, [readKey]);

  useEffect(() => {
    if (historicalWindow) return;
    const previous = previousRowsRef.current;
    const lastKey = transcriptRows.at(-1)?.key;
    if (
      readKey
      && previous?.readKey === readKey
      && !atBottom
      && lastKey !== previous.lastKey
    ) {
      const added = Math.max(1, transcriptRows.length - previous.count);
      useConversationReadPositionStore.getState().addUnseen(readKey, added);
      setUnseenRowCount((current) => Math.min(999, current + added));
    }
    previousRowsRef.current = { readKey, count: transcriptRows.length, lastKey };
  }, [atBottom, historicalWindow, readKey, transcriptRows]);

  useEffect(() => {
    const region = transcriptRegionRef.current;
    if (!region || !atBottom || historicalWindow || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => transcriptRef.current?.scrollToIndex({ index: "LAST", align: "end" }));
    });
    observer.observe(region);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [atBottom, historicalWindow, readKey]);

  useEffect(() => {
    if (!pendingUserTurn) return;
    setHistoricalWindow(undefined);
    setHighlightedMessageId(undefined);
  }, [pendingUserTurn]);

  useTranscriptMessageFocus({
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
            onClick={() => {
              setHistoricalWindow(undefined);
              setHighlightedMessageId(undefined);
              returnToLatest();
            }}
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
          loadOlderMessages: loadOlderConversation
        }}
        data={transcriptRows}
        computeItemKey={(_index, row) => row.key}
        defaultItemHeight={120}
        firstItemIndex={transcriptFirstItemIndex}
        followOutput={!historicalWindow && (streaming || hasTurnActivity) ? "auto" : false}
        increaseViewportBy={{ top: 400, bottom: 100 }}
        scrollSeekConfiguration={TRANSCRIPT_SCROLL_SEEK}
        initialTopMostItemIndex={historicalAnchorRowIndex === undefined
          ? restoredAnchorRowIndex >= 0
            ? { index: transcriptFirstItemIndex + restoredAnchorRowIndex, align: "start" }
            : { index: "LAST", align: "end" }
          : { index: historicalAnchorRowIndex, align: "center" }}
        atBottomStateChange={(nextAtBottom) => {
          if (historicalWindow) return;
          setAtBottom(nextAtBottom);
          if (nextAtBottom) setUnseenRowCount(0);
          if (readKey) useConversationReadPositionStore.getState().setAtBottom(readKey, nextAtBottom);
        }}
        rangeChanged={(range: ListRange) => {
          if (!readKey || historicalWindow) return;
          const row = transcriptRows[range.startIndex - transcriptFirstItemIndex];
          if (row) useConversationReadPositionStore.getState().observeAnchor(readKey, row.key);
        }}
        itemContent={(_index, row) => {
          if (row.kind === "plan-proposal") {
            return <PlanProposalCard plan={row.plan} />;
          }
          if (row.kind === "process-group") {
            const current = row.key === currentProcessGroupKey;
            const currentOperation = current && operationMatchesSession ? operation : undefined;
            return (
              <DeferredTranscriptProcessGroup
                completed={currentOperation ? currentOperation.lifecycle === "completed" : true}
                interrupted={current && currentProcessInterrupted}
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

  function returnToLatest(): void {
    setHistoricalWindow(undefined);
    setHighlightedMessageId(undefined);
    setAtBottom(true);
    setUnseenRowCount(0);
    if (readKey) useConversationReadPositionStore.getState().setAtBottom(readKey, true);
    requestAnimationFrame(() => transcriptRef.current?.scrollToIndex({ index: "LAST", align: "end" }));
  }

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
