import type { SessionMessageView } from "@pi67/domain";
import { CircleAlert, MessageSquareText } from "lucide-react";
import { useMemo, useState } from "react";
import { Virtuoso, type Components } from "react-virtuoso";
import { useAppStore } from "../app/app-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionGeneration,
  selectSessionId
} from "../session/session-projection-selectors.js";
import { requestComposerPrefill } from "../composer/composer-events.js";
import { loadOlderConversation } from "../conversation/conversation-controller.js";
import {
  type PendingUserTurn,
  useCommittedConversationProjection
} from "../conversation/conversation-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { messages as messagesCatalog } from "../localization/message-catalog.js";
import { hasVisibleTurnActivity, TurnActivity } from "../operation/TurnActivity.js";
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
import { MessageCard } from "./MessageCard.js";
import { editableUserMessageText } from "./message-actions.js";
import styles from "./Transcript.module.css";

export function Transcript() {
  const selectedTask = useWorkbenchStore(selectedWorkbenchTask);
  const [messageEdit, setMessageEdit] = useState<InlineMessageEditState>();
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const runtime = useAppStore((state) => state.runtime);
  const operation = useAppStore((state) => state.operation);
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
  const hasTurnActivity = hasVisibleTurnActivity(
    runtime.phase,
    operation,
    sessionId,
    sessionGeneration
  );
  const currentEdit = messageEdit?.taskId === selectedTask?.id ? messageEdit : undefined;
  const transcriptMessages = useMemo(() => (
    currentEdit && !messages.some((message) => message.id === currentEdit.message.id)
      ? [...messages, currentEdit.message]
      : messages
  ), [currentEdit, messages]);
  const messageActionDisabledReason = currentEdit
    ? messagesCatalog.transcript.finishMessageEdit
    : sessionForkActionBlockedReason();

  if (!sessionId || (sessionTransitionPending && !currentEdit)) {
    if (runtime.phase === "failed") {
      return (
        <div className={styles.error} role="alert">
          <CircleAlert size={22} />
          <strong>Pi session 创建失败</strong>
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
      data-transcript-region="true"
    >
      {/* Explicit paging avoids Virtuoso chaining requests while a prepend preserves the top anchor. */}
      <Virtuoso
        key={sessionId}
        components={TRANSCRIPT_COMPONENTS}
        context={{
          hasLiveTurn,
          hasTurnActivity,
          pendingUserTurn,
          liveText,
          liveThinking,
          hasOlder: page.hasOlder,
          loadingOlder,
          conversationError,
          loadOlderMessages: loadOlderConversation
        }}
        data={transcriptMessages}
        computeItemKey={(_index, message) => message.id}
        firstItemIndex={firstItemIndex}
        followOutput={streaming || hasTurnActivity ? "auto" : false}
        increaseViewportBy={{ top: 500, bottom: 800 }}
        initialTopMostItemIndex={Math.max(0, transcriptMessages.length - 1)}
        itemContent={(_index, message) => (
          <MessageCard
            actionDisabledReason={messageActionDisabledReason}
            edit={currentEdit?.message.id === message.id ? {
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
            onContinue={message.role === "assistant"
              ? () => continueRendererSessionFrom(message.id)
              : undefined}
            onEditStart={message.role === "user"
              ? () => beginMessageEdit(message)
              : undefined}
          />
        )}
      />
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

interface TranscriptContext {
  hasLiveTurn: boolean;
  hasTurnActivity: boolean;
  pendingUserTurn: PendingUserTurn | undefined;
  liveText: string;
  liveThinking: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  conversationError: string | undefined;
  loadOlderMessages: () => Promise<void>;
}

const TRANSCRIPT_COMPONENTS: Components<SessionMessageView, TranscriptContext> = {
  Header: OlderMessagesHeader,
  Footer: LiveTurnFooter
};

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
        <MessageCard
          deliveryStatus={context.pendingUserTurn.status}
          localImages={context.pendingUserTurn.attachments.map((attachment) => ({
            mimeType: attachment.file.type,
            name: attachment.file.name,
            objectUrl: attachment.previewUrl
          }))}
          message={context.pendingUserTurn.message}
        />
      ) : null}
      {context.hasTurnActivity ? <TurnActivity /> : null}
      {context.hasLiveTurn
        ? <MessageCard message={liveMessage(context.liveText, context.liveThinking)} streaming />
        : null}
    </>
  );
}

function liveMessage(text: string, thinking: string): SessionMessageView {
  return {
    id: "live-assistant-message",
    role: "assistant",
    parts: [
      ...(thinking ? [{ type: "thinking" as const, text: thinking }] : []),
      ...(text ? [{ type: "text" as const, text }] : [])
    ]
  };
}
