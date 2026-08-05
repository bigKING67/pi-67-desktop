import type { UserMessageIndexItem, UserMessageIndexPage } from "@pi67/domain";
import { ArrowDown, ArrowUp, Image, LoaderCircle, MessageSquareText, Paperclip } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useCommittedConversationProjection } from "../conversation/conversation-store.js";
import { formatMessageDateTime, formatMessageDateTimeTitle } from "../localization/date-time.js";
import { selectSessionGeneration, selectSessionId } from "../session/session-projection-selectors.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { requestTranscriptMessageJump } from "../transcript/transcript-navigation.js";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";

const PAGE_SIZE = 100;

export function MessagesPanel() {
  const selectedTask = useWorkbenchStore(selectedWorkbenchTask);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const pendingUserTurn = useCommittedConversationProjection().pendingUserTurn;
  const [page, setPage] = useState<UserMessageIndexPage>();
  const [loading, setLoading] = useState(false);
  const [locatingId, setLocatingId] = useState<string>();
  const [error, setError] = useState<string>();
  const requestRevision = useRef(0);
  const task = selectedTask
    && selectedTask.sessionId === sessionId
    && selectedTask.sessionGeneration === sessionGeneration
    ? selectedTask
    : undefined;

  useEffect(() => {
    requestRevision.current += 1;
    setPage(undefined);
    setError(undefined);
    if (task) void loadPage(undefined);
  }, [task?.id, task?.sessionGeneration, sessionId]);

  const items = useMemo(() => {
    const persisted = page?.items ?? [];
    if (!pendingUserTurn || !page || page.offset + page.items.length < page.total) return persisted;
    if (persisted.some((item) => item.id === pendingUserTurn.message.id)) return persisted;
    return [...persisted, pendingIndexItem(pendingUserTurn.message, pendingUserTurn.attachments, page.total + 1)];
  }, [page, pendingUserTurn]);

  if (!task || !sessionId) return <p className="context-empty">打开一个运行中的任务后，可查看本会话的用户消息。</p>;

  return (
    <div className="inspector-messages">
      <header className="inspector-messages-header">
        <div>
          <span className="section-label">当前活动分支</span>
          <strong>{page ? `${page.total} 条用户消息` : "正在建立索引"}</strong>
        </div>
        <button disabled={loading} onClick={() => void loadPage(undefined)} type="button">刷新</button>
      </header>
      <p className="inspector-messages-help">只显示你在当前任务活动分支中发出的消息；点击后跳到对话中的对应位置。</p>
      {error ? <p className="inspector-error" role="alert">{error}</p> : null}
      {loading && !page ? (
        <div className="inspector-loading" role="status"><LoaderCircle className="spin" size={16} />正在加载消息索引</div>
      ) : items.length === 0 ? (
        <div className="inspector-empty-graphic"><MessageSquareText size={20} /><span>发送第一条消息后会显示在这里。</span></div>
      ) : (
        <div aria-label="当前任务的用户消息" className="inspector-message-list" role="list">
          {items.map((item) => {
            const pending = pendingUserTurn?.message.id === item.id;
            return (
              <div className="inspector-message-row-shell" key={item.id} role="listitem">
                <button
                  aria-busy={locatingId === item.id || undefined}
                  className="inspector-message-row"
                  disabled={locatingId !== undefined && locatingId !== item.id}
                  onClick={() => void jumpToMessage(item)}
                  type="button"
                >
                  <span className="inspector-message-ordinal">#{item.ordinal}</span>
                  <span className="inspector-message-content">
                    <strong>{item.preview || "仅包含附件的消息"}</strong>
                    <small title={item.createdAt === undefined ? undefined : formatMessageDateTimeTitle(item.createdAt)}>
                      {pending
                        ? pendingUserTurn?.status === "failed" ? "发送失败" : "发送中"
                        : item.createdAt === undefined ? "时间未知" : formatMessageDateTime(item.createdAt)}
                    </small>
                  </span>
                  <span className="inspector-message-assets">
                    {item.imageCount > 0 ? <small title={`${item.imageCount} 张图片`}><Image size={11} />{item.imageCount}</small> : null}
                    {item.attachmentCount > 0 ? <small title={`${item.attachmentCount} 个附件`}><Paperclip size={11} />{item.attachmentCount}</small> : null}
                    {locatingId === item.id ? <LoaderCircle aria-label="正在定位" className="spin" size={13} /> : null}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {page ? (
        <footer className="inspector-message-pagination">
          <button
            disabled={loading || page.offset === 0}
            onClick={() => void loadPage(Math.max(0, page.offset - PAGE_SIZE))}
            type="button"
          ><ArrowUp size={12} />更早</button>
          <span>{page.total === 0 ? "0" : `${page.offset + 1}-${Math.min(page.total, page.offset + page.items.length)}`} / {page.total}</span>
          <button
            disabled={loading || page.offset + page.items.length >= page.total}
            onClick={() => void loadPage(page.offset + page.items.length)}
            type="button"
          >更晚<ArrowDown size={12} /></button>
        </footer>
      ) : null}
    </div>
  );

  async function loadPage(offset: number | undefined): Promise<void> {
    if (!task) return;
    const revision = requestRevision.current;
    setLoading(true);
    setError(undefined);
    try {
      const result = await agentConnectionController.request(
        "message.index",
        { ...(offset === undefined ? {} : { offset }), limit: PAGE_SIZE },
        [],
        { context: workbenchProtocolContextForTask(task) }
      );
      if (revision !== requestRevision.current || result.sessionId !== task.sessionId) return;
      setPage(result);
    } catch (cause) {
      if (revision === requestRevision.current) setError(errorMessage(cause));
    } finally {
      if (revision === requestRevision.current) setLoading(false);
    }
  }

  async function jumpToMessage(item: UserMessageIndexItem): Promise<void> {
    if (!task || locatingId) return;
    const selector = `[data-message-id="${CSS.escape(item.id)}"]`;
    if (document.querySelector(selector)) {
      requestTranscriptMessageJump({ id: item.id });
      return;
    }
    setLocatingId(item.id);
    setError(undefined);
    const revision = requestRevision.current;
    try {
      const window = await agentConnectionController.request(
        "message.locate",
        { id: item.id },
        [],
        { context: workbenchProtocolContextForTask(task) }
      );
      if (revision !== requestRevision.current || window.sessionId !== task.sessionId) return;
      if (page && window.revision !== page.revision) void loadPage(undefined);
      requestTranscriptMessageJump({ id: item.id, window });
    } catch (cause) {
      if (revision === requestRevision.current) {
        setError(errorMessage(cause));
        void loadPage(undefined);
      }
    } finally {
      if (revision === requestRevision.current) setLocatingId(undefined);
    }
  }
}

function pendingIndexItem(
  message: { id: string; parts: Array<{ type: string; text?: string }> },
  attachments: Array<{ kind: string }>,
  ordinal: number
): UserMessageIndexItem {
  const preview = message.parts
    .flatMap((part) => part.type === "text" && part.text ? [part.text] : [])
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
  return {
    id: message.id,
    ordinal,
    preview,
    imageCount: attachments.filter((attachment) => attachment.kind === "image").length,
    attachmentCount: attachments.filter((attachment) => attachment.kind !== "image").length
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法加载用户消息。";
}
