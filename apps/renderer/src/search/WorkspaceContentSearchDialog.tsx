import type { WorkspaceFileContentSearchMatch, WorkspaceFileContentSearchResult } from "@pi67/domain";
import { FilePlus2, LoaderCircle, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { insertComposerFileMentionAtCursor, mergeComposerFileReference } from "../composer/composer-file-mentions.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useShellStore } from "../shell/shell-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { rendererWorkbenchStore, selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { openWorkspaceContentSearchMatch } from "../workspace-files/workspace-file-controller.js";
import styles from "./WorkspaceContentSearchDialog.module.css";
import { isWorkspaceContentSearchRequestCurrent } from "./workspace-content-search-authority.js";

export function WorkspaceContentSearchDialog() {
  const open = useShellStore((state) => state.workspaceContentSearchDialogOpen);
  const setOpen = useShellStore((state) => state.setWorkspaceContentSearchDialogOpen);
  const workspace = useWorkbenchStore((state) => {
    const task = selectedWorkbenchTask(state);
    const workspaceId = task?.workspaceId ?? state.currentWorkspaceId;
    return workspaceId ? state.workspaces[workspaceId] : undefined;
  });
  const activeTask = useWorkbenchStore(selectedWorkbenchTask);
  const connected = useAppStore((state) => state.connected);
  const hostEpoch = useAppStore((state) => state.hostEpoch);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeGenerated, setIncludeGenerated] = useState(false);
  const [result, setResult] = useState<WorkspaceFileContentSearchResult>();
  const [loading, setLoading] = useState(false);
  const [openingKey, setOpeningKey] = useState<string>();
  const [error, setError] = useState<string>();
  const requestRevision = useRef(0);
  const openedHostEpoch = useRef<number | undefined>(undefined);
  const openedWorkspaceId = useRef<string | undefined>(undefined);

  const close = useCallback(() => {
    requestRevision.current += 1;
    setOpen(false);
    setLoading(false);
    setOpeningKey(undefined);
    setError(undefined);
    setResult(undefined);
    openedHostEpoch.current = undefined;
    openedWorkspaceId.current = undefined;
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    openedHostEpoch.current = hostEpoch;
    openedWorkspaceId.current = workspace?.id;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (
      !connected
      || hostEpoch !== openedHostEpoch.current
      || workspace?.id !== openedWorkspaceId.current
    ) close();
  }, [close, connected, hostEpoch, open, workspace?.id]);

  if (!open) return null;
  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(next) => { if (!next) close(); }}>
      <Modal className={styles.surface!}>
        <Dialog aria-label="在工作区文件中查找" className={styles.dialog!}>
          <header>
            <div><span className="dialog-eyebrow">LOCAL WORKSPACE</span><Heading slot="title"><Search size={18} />在工作区文件中查找</Heading></div>
            <Button aria-label="关闭文件内容搜索" className="icon-button" onPress={close}><X aria-hidden="true" size={16} /></Button>
          </header>
          <form className={styles.search} onSubmit={(event) => { event.preventDefault(); void searchWorkspace(); }}>
            <input
              autoFocus
              aria-label="搜索工作区文件内容"
              maxLength={256}
              placeholder="输入源码、配置或文档中的文字"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button isDisabled={loading || !query.trim() || !workspace || !connected} type="submit">
              {loading ? <LoaderCircle aria-hidden="true" className={styles.spin} size={14} /> : <Search aria-hidden="true" size={14} />}
              查找
            </Button>
          </form>
          <div className={styles.options}>
            <label><input checked={caseSensitive} type="checkbox" onChange={(event) => setCaseSensitive(event.target.checked)} />区分大小写</label>
            <label><input checked={includeGenerated} type="checkbox" onChange={(event) => setIncludeGenerated(event.target.checked)} />包含依赖与生成目录</label>
          </div>
          <p className={styles.scope}>
            {!connected
              ? "Agent Host 未连接"
              : workspace
                ? `仅搜索可信工作区：${workspace.displayName}`
                : "当前没有可搜索的工作区"}
            {result ? ` · ${result.filesVisited} 个文件 · ${formatBytes(result.bytesVisited)}` : ""}
          </p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {result?.incomplete ? (
            <p className={styles.warning} role="status">
              结果可能不完整{result.skippedCount > 0 ? `，已跳过 ${result.skippedCount} 个不可安全读取的文件或目录` : ""}。
            </p>
          ) : null}
          <div className={styles.results}>
            {result && result.matches.length === 0 ? <p>没有找到匹配的文件内容。</p> : null}
            {result?.matches.map((match, index) => {
              const key = `${match.entry.id}:${match.line}:${match.column}:${index}`;
              return (
                <article key={key}>
                  <button
                    className={styles.openResult}
                    disabled={openingKey !== undefined}
                    type="button"
                    onClick={() => void openMatch(match, key)}
                  >
                    <span><strong>{match.entry.relativePath}</strong><em>Ln {match.line}:{match.column}</em></span>
                    <code>{match.snippetTruncated ? "..." : ""}{match.snippet}{match.snippetTruncated ? "..." : ""}</code>
                    {openingKey === key ? <LoaderCircle aria-label="正在打开" className={styles.spin} size={14} /> : null}
                  </button>
                  <button className={styles.addContext} type="button" onClick={() => addFileContext(match)}>
                    <FilePlus2 aria-hidden="true" size={13} />加入 @file
                  </button>
                </article>
              );
            })}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );

  async function searchWorkspace(): Promise<void> {
    const expectedHostEpoch = useAppStore.getState().hostEpoch;
    if (!workspace || loading || !query.trim() || expectedHostEpoch === undefined) return;
    const revision = ++requestRevision.current;
    setLoading(true);
    setResult(undefined);
    setError(undefined);
    try {
      await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
      if (!isCurrent(revision, expectedHostEpoch, workspace.id)) return;
      const next = await agentConnectionController.request(
        "workspace.file.contentSearch",
        { query: query.trim(), caseSensitive, includeGenerated },
        [],
        { context: { scope: "workspace", workspaceId: workspace.id }, ackTimeoutMs: 5_000 }
      );
      if (!isCurrent(revision, expectedHostEpoch, workspace.id) || next.workspaceId !== workspace.id) return;
      setResult(next);
    } catch (cause) {
      if (isCurrent(revision, expectedHostEpoch, workspace.id)) {
        setError(cause instanceof Error ? cause.message : "工作区内容搜索失败，请重试。");
      }
    } finally {
      if (isCurrent(revision, expectedHostEpoch, workspace.id)) setLoading(false);
    }
  }

  async function openMatch(match: WorkspaceFileContentSearchMatch, key: string): Promise<void> {
    if (!workspace || openingKey) return;
    setOpeningKey(key);
    setError(undefined);
    try {
      if (!await openWorkspaceContentSearchMatch(workspace, match)) {
        throw new Error("文件已变化或无法安全打开，请重新搜索。");
      }
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法打开搜索结果。");
    } finally {
      setOpeningKey(undefined);
    }
  }

  function addFileContext(match: WorkspaceFileContentSearchMatch): void {
    if (!activeTask) return;
    const store = useTaskDraftStore.getState();
    const draft = store.drafts[activeTask.id];
    const currentText = draft?.text ?? "";
    const reference = {
      id: match.entry.id,
      revision: match.entry.revision,
      relativePath: match.entry.relativePath
    };
    const inserted = insertComposerFileMentionAtCursor(currentText, currentText.length, reference);
    store.setText(activeTask.id, inserted.text);
    store.setWorkspaceFiles(
      activeTask.id,
      mergeComposerFileReference(draft?.workspaceFiles ?? [], reference)
    );
    publishNotification({
      level: "success",
      title: "已加入 Composer 上下文",
      message: match.entry.relativePath
    });
  }

  function isCurrent(revision: number, expectedHostEpoch: number, workspaceId: string): boolean {
    const app = useAppStore.getState();
    const workbench = rendererWorkbenchStore.getState();
    return isWorkspaceContentSearchRequestCurrent({
      revision,
      hostEpoch: expectedHostEpoch,
      workspaceId
    }, {
      revision: requestRevision.current,
      connected: app.connected,
      hostEpoch: app.hostEpoch,
      workspaceId: selectedWorkbenchTask(workbench)?.workspaceId ?? workbench.currentWorkspaceId
    });
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
