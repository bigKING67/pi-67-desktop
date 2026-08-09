import type { RepositoryChangeDetail, RepositoryWorkingTreeChange } from "@pi67/domain";
import {
  CircleCheck,
  CircleDot,
  GitCompareArrows,
  LoaderCircle,
  RefreshCw,
  TriangleAlert
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  loadRepositoryChangeDetail,
  refreshRepositoryWorkingTree
} from "./repository-working-tree-controller.js";
import {
  repositoryChangeReviewed,
  repositoryChangeViewed,
  useRepositoryWorkingTreeStore
} from "./repository-working-tree-store.js";
import styles from "./ChangesPanel.module.css";
import { ChangeReviewPanel } from "./ChangeReviewPanel.js";

export function RepositoryWorkingTreePanel({ active }: { active: boolean }) {
  const selectedTask = useWorkbenchStore(selectedWorkbenchTask);
  const workspaceId = useWorkbenchStore((state) => selectedTask?.workspaceId ?? state.currentWorkspaceId);
  const state = useRepositoryWorkingTreeStore();
  const [selectedChangeId, setSelectedChangeId] = useState<string>();
  const refreshedWorkspace = useRef<string | undefined>(undefined);
  const snapshot = state.workspaceId === workspaceId ? state.snapshot : undefined;
  const changes = snapshot?.changes ?? [];
  const selected = changes.find((change) => change.changeId === selectedChangeId) ?? changes[0];
  const detail = selected ? state.detailByChangeId[selected.changeId] : undefined;
  const viewed = workspaceId ? state.viewedByWorkspace[workspaceId] : undefined;
  const reviewed = workspaceId ? state.reviewedByWorkspace[workspaceId] : undefined;
  const stagedCount = useMemo(() => changes.filter((change) => change.staged).length, [changes]);
  const unstagedCount = useMemo(() => changes.filter((change) => change.unstaged).length, [changes]);

  useEffect(() => {
    if (!active || !workspaceId || refreshedWorkspace.current === workspaceId) return;
    refreshedWorkspace.current = workspaceId;
    void refreshRepositoryWorkingTree(workspaceId);
  }, [active, workspaceId]);

  useEffect(() => {
    if (!active || !workspaceId || !snapshot || !selected || detail) return;
    void loadRepositoryChangeDetail(workspaceId, snapshot.revision, selected.changeId);
  }, [active, detail, selected, snapshot, workspaceId]);

  if (!workspaceId) return <WorkingTreeState text="打开工作区后，可审阅当前物理 Worktree 的 Git 状态。" />;
  const loading = state.workspaceId === workspaceId && state.status === "loading";
  const error = state.workspaceId === workspaceId ? state.error : undefined;
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div>
          <strong>当前 Worktree</strong>
          <p className={styles.authority}>
            {snapshot ? `${changes.length} 个文件 · staged ${stagedCount} · unstaged ${unstagedCount}` : "Main-owned read-only Git authority"}
          </p>
        </div>
        <button
          aria-label="刷新工作区变更"
          className={styles.refresh}
          disabled={loading}
          onClick={() => void refreshRepositoryWorkingTree(workspaceId)}
          title="刷新工作区变更"
          type="button"
        ><RefreshCw className={loading ? styles.spinning : undefined} size={15} /></button>
      </header>
      {error ? <p className={styles.error} role="alert"><TriangleAlert size={14} />{error}</p>
        : snapshot?.truncated ? <p className={styles.warning}><TriangleAlert size={14} />仅显示前 500 个 Git 变更。</p>
          : <p className={styles.authority}>只读状态与 bounded Diff；不提供 stage、discard、commit、push 或 PR。</p>}
      {loading && !snapshot ? <WorkingTreeState loading text="正在读取 Git 状态。" />
        : error && !snapshot ? <WorkingTreeState text="工作区 Git 状态暂时不可用。" />
          : changes.length === 0 ? <WorkingTreeState clean text="当前 Worktree 没有 Git 变更。" />
            : <div className={styles.body}>
              <div aria-label="工作区 Git 变更" className={styles.list} role="list">
                {changes.map((change) => {
                  const itemDetail = state.detailByChangeId[change.changeId];
                  const wasViewed = repositoryChangeViewed(workspaceId, itemDetail, viewed);
                  return <button
                    aria-label={`${change.displayPath}，${wasViewed ? "已查看" : "未查看"}`}
                    aria-pressed={selected?.changeId === change.changeId}
                    className={`${styles.row} ${selected?.changeId === change.changeId ? styles.selected : ""}`}
                    key={change.changeId}
                    onClick={() => {
                      setSelectedChangeId(change.changeId);
                      if (!itemDetail) void loadRepositoryChangeDetail(workspaceId, snapshot!.revision, change.changeId);
                    }}
                    role="listitem"
                    type="button"
                  >
                    <span className={styles.status}><CircleDot size={13} /></span>
                    <span>
                      <code title={change.displayPath}>{change.displayPath}</code>
                      <small>{changeLabel(change)} · {change.staged ? "staged" : ""}{change.staged && change.unstaged ? " + " : ""}{change.unstaged ? "unstaged" : ""}</small>
                    </span>
                    {!wasViewed ? <i aria-hidden="true" className={styles.unreadDot} /> : null}
                  </button>;
                })}
              </div>
              {selected ? <RepositoryDetail
                change={selected}
                detail={detail}
                error={state.detailLoadingId === undefined ? state.detailError : undefined}
                loading={state.detailLoadingId === selected.changeId}
                reviewed={repositoryChangeReviewed(workspaceId, detail, reviewed)}
                taskId={selectedTask?.id}
                workspaceId={workspaceId}
              /> : null}
            </div>}
    </div>
  );
}

function RepositoryDetail({ change, detail, error, loading, reviewed, taskId, workspaceId }: {
  change: RepositoryWorkingTreeChange;
  detail: RepositoryChangeDetail | undefined;
  error: string | undefined;
  loading: boolean;
  reviewed: boolean;
  taskId: string | undefined;
  workspaceId: string;
}) {
  const patch = [
    detail?.stagedPatch ? `# STAGED\n${detail.stagedPatch}` : undefined,
    detail?.unstagedPatch ? `# UNSTAGED\n${detail.unstagedPatch}` : undefined
  ].filter((value): value is string => value !== undefined).join("\n\n");
  return <section aria-label={`Git Diff ${change.displayPath}`} className={styles.detail}>
    <div className={styles.detailHeading}><div><span>{changeLabel(change)}</span><code>{change.displayPath}</code></div></div>
    {loading ? <WorkingTreeState loading text="正在读取 bounded Diff。" />
      : error ? <p className={styles.error} role="alert">{error}</p>
        : patch && detail ? (
          <ChangeReviewPanel
            authority={{
              source: "worktree",
              workspaceId,
              revision: detail.revision,
              changeId: detail.changeId,
              contentFingerprint: detail.contentFingerprint
            }}
            onMarkReviewed={() => useRepositoryWorkingTreeStore.getState().markReviewed(workspaceId, detail)}
            patch={patch}
            path={change.displayPath}
            reviewed={reviewed}
            sourceTruncated={detail.truncated}
            taskId={taskId}
          />
        )
          : <p className={styles.explanation}>该状态没有可展示的文本 Diff，可能是二进制文件或纯元数据变化。</p>}
  </section>;
}

function WorkingTreeState({ text, loading = false, clean = false }: {
  text: string;
  loading?: boolean;
  clean?: boolean;
}) {
  const Icon = loading ? LoaderCircle : clean ? CircleCheck : GitCompareArrows;
  return <div className={styles.state} role="status"><Icon className={loading ? styles.spinning : undefined} size={20} /><p>{text}</p></div>;
}

function changeLabel(change: RepositoryWorkingTreeChange): string {
  if (change.kind === "conflict") return "冲突";
  if (change.kind === "untracked") return "未跟踪";
  if (change.kind === "added") return "新增";
  if (change.kind === "deleted") return "删除";
  if (change.kind === "renamed") return "重命名";
  if (change.kind === "copied") return "复制";
  return "修改";
}
