import type { WorkspaceMessageSearchItem, WorkspaceMessageSearchResult } from "@pi67/domain";
import { LoaderCircle, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { openRendererSession } from "../session/session-lifecycle-controller.js";
import { requestTranscriptMessageJump } from "../transcript/transcript-navigation.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  useWorkbenchStore
} from "../workbench/workbench-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";
import {
  subscribeConversationFind,
  subscribeConversationFindDismiss
} from "./conversation-find-events.js";
import styles from "./WorkspaceConversationSearchDialog.module.css";

export function WorkspaceConversationSearchDialog() {
  const workspace = useWorkbenchStore((state) => {
    const task = selectedWorkbenchTask(state);
    const workspaceId = task?.workspaceId ?? state.currentWorkspaceId;
    return workspaceId ? state.workspaces[workspaceId] : undefined;
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<WorkspaceMessageSearchResult>();
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string>();
  const [error, setError] = useState<string>();
  const requestRevision = useRef(0);
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const openedHostEpoch = useRef<number | undefined>(undefined);
  const openedWorkspaceId = useRef<string | undefined>(undefined);
  const restoreFocusTarget = useRef<HTMLElement | undefined>(undefined);
  const connected = useAppStore((state) => state.connected);
  const hostEpoch = useAppStore((state) => state.hostEpoch);

  const closeDialog = useCallback((restoreFocus = true) => {
    requestRevision.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = undefined;
    setOpen(false);
    setLoading(false);
    setResult(undefined);
    setOpeningId(undefined);
    setError(undefined);
    openedHostEpoch.current = undefined;
    openedWorkspaceId.current = undefined;
    const target = restoreFocusTarget.current;
    restoreFocusTarget.current = undefined;
    if (restoreFocus && target?.isConnected) requestAnimationFrame(() => target.focus());
  }, []);

  useEffect(() => subscribeConversationFind((scope) => {
    if (scope !== "workspace") return;
    const activeElement = document.activeElement;
    restoreFocusTarget.current = activeElement instanceof HTMLElement ? activeElement : undefined;
    openedHostEpoch.current = useAppStore.getState().hostEpoch;
    openedWorkspaceId.current = workspace?.id;
    setOpen(true);
  }), [workspace?.id]);

  useEffect(() => subscribeConversationFindDismiss(() => closeDialog()), [closeDialog]);

  useEffect(() => {
    if (!open || openedHostEpoch.current === undefined) return;
    if (!connected || hostEpoch !== openedHostEpoch.current) closeDialog();
  }, [closeDialog, connected, hostEpoch, open]);

  useEffect(() => {
    requestRevision.current += 1;
    setResult(undefined);
    setError(undefined);
    setOpeningId(undefined);
    if (open && openedWorkspaceId.current !== workspace?.id) closeDialog();
  }, [closeDialog, open, workspace?.id]);

  if (!open) return null;
  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable
      isOpen
      onOpenChange={(next) => { if (!next) closeDialog(); }}
    >
      <Modal className={styles.surface!}>
        <Dialog aria-label="搜索工作区对话正文" className={styles.dialog!}>
          <header>
            <div><span className="dialog-eyebrow">PI JSONL</span><Heading slot="title"><Search size={18} />搜索对话正文</Heading></div>
            <Button aria-label="关闭对话搜索" className="icon-button" onPress={() => closeDialog()}><X aria-hidden="true" size={16} /></Button>
          </header>
          <form
            className={styles.search}
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <input
              autoFocus
              aria-label="搜索当前工作区的对话正文"
              placeholder="输入用户消息或 Pi 回复中的文字"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              isDisabled={loading || Array.from(query.normalize("NFKC").trim()).length < 2 || !workspace || !connected}
              type="submit"
            >
              {loading
                ? <LoaderCircle aria-hidden="true" className={styles.spin} size={14} />
                : <Search aria-hidden="true" size={14} />}
              搜索
            </Button>
          </form>
          <p className={styles.scope}>
            {!connected
              ? "Agent Host 未连接；连接恢复后可重新搜索"
              : workspace
                ? `工作区：${workspace.displayName}`
                : "当前没有可搜索的工作区"}
            {result ? ` · 已索引 ${result.sessionsVisited} 个对话、${result.entriesVisited} 条消息` : ""}
          </p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {result?.incomplete ? (
            <p className={styles.warning} role="status">
              索引结果不完整{result.skippedCount > 0 ? `，${result.skippedCount} 个对话或版本尚未覆盖` : ""}。
            </p>
          ) : null}
          <div className={styles.results}>
            {result && result.items.length === 0 ? <p>没有匹配的对话正文。</p> : null}
            {result?.items.map((item) => {
              const key = `${item.sessionFileIdentity}:${item.messageId}`;
              return (
                <button
                  disabled={openingId !== undefined}
                  key={key}
                  type="button"
                  onClick={() => void openResult(item, key)}
                >
                  <span><strong>{item.sessionName}</strong><em>{item.role === "user" ? "用户" : "Pi"}</em></span>
                  <small>{item.snippet}</small>
                  <code>{item.sessionPath}</code>
                  {openingId === key ? <LoaderCircle aria-label="正在打开" className={styles.spin} size={14} /> : null}
                </button>
              );
            })}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );

  async function search(): Promise<void> {
    const requestHostEpoch = useAppStore.getState().hostEpoch;
    const normalizedQuery = query.normalize("NFKC").trim();
    if (!workspace || loading || Array.from(normalizedQuery).length < 2 || requestHostEpoch === undefined) return;
    const revision = ++requestRevision.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setResult(undefined);
    setError(undefined);
    try {
      await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
      if (!requestIsCurrent(revision, requestHostEpoch, workspace.id)) return;
      const next = await agentConnectionController.request(
        "session.catalog.contentSearch",
        { query: normalizedQuery },
        [],
        {
          context: { scope: "workspace", workspaceId: workspace.id },
          signal: controller.signal
        }
      );
      if (!requestIsCurrent(revision, requestHostEpoch, workspace.id) || next.workspaceId !== workspace.id) return;
      setResult(next);
    } catch (cause) {
      if (requestIsCurrent(revision, requestHostEpoch, workspace.id)) {
        setError(cause instanceof Error ? cause.message : "跨对话搜索失败，请重试。");
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = undefined;
      if (requestIsCurrent(revision, requestHostEpoch, workspace.id)) setLoading(false);
    }
  }

  async function openResult(item: WorkspaceMessageSearchItem, key: string): Promise<void> {
    const requestHostEpoch = useAppStore.getState().hostEpoch;
    if (openingId || requestHostEpoch === undefined || !workspace) return;
    const revision = ++requestRevision.current;
    setOpeningId(key);
    setError(undefined);
    try {
      await openRendererSession(item.sessionPath, item.sessionFileIdentity);
      if (!requestIsCurrent(revision, requestHostEpoch, workspace.id)) return;
      const task = selectedWorkbenchTask(rendererWorkbenchStore.getState());
      if (
        !task
        || task.conversation.kind !== "session"
        || task.conversation.sessionFileIdentity !== item.sessionFileIdentity
      ) throw new Error("目标对话未能完成权威绑定，请重试。");
      const window = await agentConnectionController.request(
        "message.locate",
        { id: item.messageId },
        [],
        { context: workbenchProtocolContextForTask(task) }
      );
      if (
        !requestIsCurrent(revision, requestHostEpoch, workspace.id)
        || window.sessionId !== task.sessionId
      ) throw new Error("目标消息属于已失效的对话实例。");
      closeDialog();
      requestAnimationFrame(() => requestTranscriptMessageJump({ id: item.messageId, window }));
    } catch (cause) {
      if (requestIsCurrent(revision, requestHostEpoch, workspace.id)) {
        setError(cause instanceof Error ? cause.message : "无法打开搜索结果。");
      }
    } finally {
      if (requestRevision.current === revision) setOpeningId(undefined);
    }
  }

  function requestIsCurrent(revision: number, expectedHostEpoch: number, workspaceId: string): boolean {
    const connection = useAppStore.getState();
    return requestRevision.current === revision
      && connection.connected
      && connection.hostEpoch === expectedHostEpoch
      && activeWorkspaceId() === workspaceId;
  }
}

function activeWorkspaceId(): string | undefined {
  const state = rendererWorkbenchStore.getState();
  return selectedWorkbenchTask(state)?.workspaceId ?? state.currentWorkspaceId;
}
