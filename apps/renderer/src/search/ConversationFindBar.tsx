import type { MessageSearchResult } from "@pi67/domain";
import { ArrowDown, ArrowUp, LoaderCircle, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { isImeConfirmationKey } from "../input/ime-keyboard.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";
import { requestTranscriptMessageJump } from "../transcript/transcript-navigation.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask
} from "../workbench/workbench-store.js";
import type { RendererWorkbenchTask } from "../workbench/workbench-store-contract.js";
import {
  subscribeConversationFind,
  subscribeConversationFindDismiss
} from "./conversation-find-events.js";
import styles from "./ConversationFindBar.module.css";

const SEARCH_DELAY_MS = 120;

export function ConversationFindBar({ task }: { task: RendererWorkbenchTask }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MessageSearchResult>();
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRevision = useRef(0);
  const openedHostEpoch = useRef<number | undefined>(undefined);
  const openedTaskIdentity = useRef<string | undefined>(undefined);
  const restoreFocusTarget = useRef<HTMLElement | undefined>(undefined);
  const connected = useAppStore((state) => state.connected);
  const hostEpoch = useAppStore((state) => state.hostEpoch);

  const closeFind = useCallback((restoreFocus = true) => {
    requestRevision.current += 1;
    setOpen(false);
    setLoading(false);
    setResult(undefined);
    setActiveIndex(0);
    setError(undefined);
    openedHostEpoch.current = undefined;
    openedTaskIdentity.current = undefined;
    const target = restoreFocusTarget.current;
    restoreFocusTarget.current = undefined;
    if (restoreFocus && target?.isConnected) requestAnimationFrame(() => target.focus());
  }, []);

  useEffect(() => subscribeConversationFind((scope) => {
    if (scope !== "current") return;
    const activeElement = document.activeElement;
    restoreFocusTarget.current = activeElement instanceof HTMLElement ? activeElement : undefined;
    openedHostEpoch.current = useAppStore.getState().hostEpoch;
    openedTaskIdentity.current = taskIdentity(task);
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }), [task]);

  useEffect(() => subscribeConversationFindDismiss(() => closeFind()), [closeFind]);

  useEffect(() => {
    if (!open || openedHostEpoch.current === undefined) return;
    if (!connected || hostEpoch !== openedHostEpoch.current) closeFind();
  }, [closeFind, connected, hostEpoch, open]);

  useEffect(() => {
    requestRevision.current += 1;
    setResult(undefined);
    setActiveIndex(0);
    setError(undefined);
    if (open && openedTaskIdentity.current !== taskIdentity(task)) closeFind();
  }, [closeFind, open, task.id, task.sessionGeneration, task.sessionId]);

  useEffect(() => {
    const normalized = query.trim();
    const revision = ++requestRevision.current;
    const requestHostEpoch = useAppStore.getState().hostEpoch;
    if (!open || !normalized || requestHostEpoch === undefined) {
      setLoading(false);
      setResult(undefined);
      setError(undefined);
      return;
    }
    setLoading(true);
    setError(undefined);
    const timer = globalThis.setTimeout(() => {
      void agentConnectionController.request(
        "message.search",
        { query: normalized },
        [],
        { context: workbenchProtocolContextForTask(task) }
      ).then(
        (next) => {
          if (
            !requestIsCurrent(revision, requestHostEpoch, task, requestRevision)
            || next.sessionId !== task.sessionId
          ) return;
          setResult(next);
          setActiveIndex(0);
          setLoading(false);
          const first = next.items[0];
          if (first) void revealResult(
            task,
            first.id,
            revision,
            requestHostEpoch,
            requestRevision
          ).then((revealError) => {
            if (revealError && requestIsCurrent(revision, requestHostEpoch, task, requestRevision)) {
              setError(revealError);
            }
          });
        },
        (cause: unknown) => {
          if (!requestIsCurrent(revision, requestHostEpoch, task, requestRevision)) return;
          setError(cause instanceof Error ? cause.message : "当前对话搜索失败，请重试。");
          setLoading(false);
        }
      );
    }, SEARCH_DELAY_MS);
    return () => globalThis.clearTimeout(timer);
  }, [hostEpoch, open, query, task]);

  if (!open) return null;
  const count = result?.items.length ?? 0;
  const current = count === 0 ? 0 : activeIndex + 1;
  return (
    <div className={styles.bar} data-testid="conversation-find-bar" role="search">
      <Search aria-hidden="true" size={14} />
      <input
        ref={inputRef}
        aria-label="在当前对话中查找"
        placeholder="查找当前对话"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (isImeConfirmationKey(event.nativeEvent)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            closeFind();
            return;
          }
          if (event.key === "Enter" && count > 0) {
            event.preventDefault();
            void move(event.shiftKey ? -1 : 1);
          }
        }}
      />
      {loading ? <LoaderCircle aria-label="正在搜索" className={styles.spin} size={13} /> : null}
      <span aria-live="polite" className={error ? styles.error : undefined} title={error}>
        {error ?? (query.trim() ? `${current} / ${result?.total ?? 0}${result?.truncated ? "+" : ""}` : "")}
      </span>
      <button aria-label="上一个结果" disabled={count === 0} type="button" onClick={() => void move(-1)}>
        <ArrowUp size={13} />
      </button>
      <button aria-label="下一个结果" disabled={count === 0} type="button" onClick={() => void move(1)}>
        <ArrowDown size={13} />
      </button>
      <button aria-label="关闭查找" type="button" onClick={() => closeFind()}><X aria-hidden="true" size={13} /></button>
    </div>
  );

  async function move(delta: -1 | 1): Promise<void> {
    const items = result?.items ?? [];
    if (items.length === 0) return;
    const revision = ++requestRevision.current;
    const nextIndex = (activeIndex + delta + items.length) % items.length;
    setActiveIndex(nextIndex);
    setError(undefined);
    const item = items[nextIndex];
    const requestHostEpoch = useAppStore.getState().hostEpoch;
    if (item && requestHostEpoch !== undefined) {
      const revealError = await revealResult(task, item.id, revision, requestHostEpoch, requestRevision);
      if (revealError && requestIsCurrent(revision, requestHostEpoch, task, requestRevision)) {
        setError(revealError);
      }
    }
  }
}

async function revealResult(
  task: RendererWorkbenchTask,
  id: string,
  revision: number,
  hostEpoch: number,
  currentRevision: { current: number }
): Promise<string | undefined> {
  if (!requestIsCurrent(revision, hostEpoch, task, currentRevision)) return;
  if (document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)) {
    requestTranscriptMessageJump({ focus: "preserve", id });
    return;
  }
  try {
    const window = await agentConnectionController.request(
      "message.locate",
      { id },
      [],
      { context: workbenchProtocolContextForTask(task) }
    );
    if (!requestIsCurrent(revision, hostEpoch, task, currentRevision)) return;
    if (window.sessionId !== task.sessionId) return "定位结果已过期，请重新搜索。";
    requestTranscriptMessageJump({ focus: "preserve", id, window });
  } catch (cause: unknown) {
    if (!requestIsCurrent(revision, hostEpoch, task, currentRevision)) return;
    return cause instanceof Error ? cause.message : "无法定位搜索结果，请重试。";
  }
}

function requestIsCurrent(
  revision: number,
  expectedHostEpoch: number,
  task: RendererWorkbenchTask,
  currentRevision?: { current: number }
): boolean {
  const connection = useAppStore.getState();
  return (currentRevision?.current ?? revision) === revision
    && connection.connected
    && connection.hostEpoch === expectedHostEpoch
    && taskIdentity(task) === taskIdentityFromCurrentWorkbench();
}

function taskIdentity(task: RendererWorkbenchTask): string {
  return `${task.id}:${task.sessionId}:${task.sessionGeneration}`;
}

function taskIdentityFromCurrentWorkbench(): string | undefined {
  const task = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  return task ? taskIdentity(task) : undefined;
}
