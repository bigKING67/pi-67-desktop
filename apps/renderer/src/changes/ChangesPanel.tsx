import type { WorkspaceChangeView } from "@pi67/domain";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  FilePenLine,
  LoaderCircle,
  RefreshCw,
  TriangleAlert
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { selectSessionName } from "../session/session-projection-selectors.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { refreshWorkspaceChanges } from "./workspace-changes-controller.js";
import {
  selectCommittedWorkspaceChangesProjection,
  useWorkspaceChangesStore
} from "./workspace-changes-store.js";
import styles from "./ChangesPanel.module.css";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";
import { RepositoryWorkingTreePanel } from "./RepositoryWorkingTreePanel.js";
import { PatchView } from "./PatchView.js";
import {
  changesReadSessionKey,
  useChangesReadStore,
  workspaceChangeViewed
} from "./changes-read-store.js";

export interface ChangesPanelProps {
  active: boolean;
}

export { classifyPatchLine, projectPatchLines } from "./PatchView.js";

export function ChangesPanel({ active }: ChangesPanelProps) {
  const [view, setView] = useState<"session" | "worktree">("session");
  return (
    <div className={styles.inspector}>
      <div aria-label="修改来源" className={styles.viewTabs} role="tablist">
        <button
          aria-selected={view === "session"}
          onClick={() => setView("session")}
          role="tab"
          type="button"
        >会话修改</button>
        <button
          aria-selected={view === "worktree"}
          onClick={() => setView("worktree")}
          role="tab"
          type="button"
        >工作区变更</button>
      </div>
      <div className={styles.viewContent} role="tabpanel">
        {view === "session"
          ? <SessionChangesPanel active={active} />
          : <RepositoryWorkingTreePanel active={active} />}
      </div>
    </div>
  );
}

function SessionChangesPanel({ active }: ChangesPanelProps) {
  const canonicalAuthority = useSessionProjectionStore((state) => state.authority);
  const sessionName = useSessionProjectionStore(selectSessionName);
  const view = useWorkspaceChangesStore((state) => (
    selectCommittedWorkspaceChangesProjection(state, canonicalAuthority)
  ));
  const [selectedToolCallId, setSelectedToolCallId] = useState<string>();
  const selectedTask = useWorkbenchStore(selectedWorkbenchTask);
  const autoRefreshAuthority = useRef<string | undefined>(undefined);
  const items = view.projection?.items ?? [];
  const groupedItems = useMemo(() => groupWorkspaceChangesByTurn(items).toReversed(), [items]);
  const selected = selectWorkspaceChange(items, selectedToolCallId);
  const readSessionKey = changesReadSessionKey(
    selectedTask?.workspaceId,
    selectedTask?.sessionFileIdentity
  );
  const viewedFingerprints = useChangesReadStore((state) => (
    readSessionKey ? state.sessions[readSessionKey]?.fingerprints : undefined
  ));
  const summary = summarizeWorkspaceChanges(items, view.projection?.total ?? 0);
  const authorityKey = view.authority
    ? `${view.authority.hostEpoch}:${view.authority.sessionId}:${view.authority.sessionGeneration}:${view.authority.projectionRevision}`
    : undefined;

  useEffect(() => {
    if (!active || !authorityKey || view.status !== "stale") return;
    if (autoRefreshAuthority.current === authorityKey) return;
    autoRefreshAuthority.current = authorityKey;
    void refreshWorkspaceChanges();
  }, [active, authorityKey, view.status]);

  useEffect(() => {
    if (!active || !readSessionKey || !selected) return;
    useChangesReadStore.getState().markViewed(readSessionKey, selected);
  }, [active, readSessionKey, selected]);

  if (!view.authority) {
    return <ChangesPanelState icon={<FilePenLine size={20} />} text="打开一个运行中的会话后，可查看当前活动分支的修改记录。" />;
  }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div>
          <strong>{sessionName?.trim() || "当前会话"}</strong>
          <p className={styles.authority}>{summary}</p>
        </div>
        <button
          aria-label="刷新修改记录"
          className={styles.refresh}
          disabled={view.status === "loading"}
          onClick={() => void refreshWorkspaceChanges()}
          title="刷新修改记录"
          type="button"
        >
          <RefreshCw aria-hidden="true" className={view.status === "loading" ? styles.spinning : undefined} size={15} />
        </button>
      </header>
      <ChangesNotices
        error={view.error}
        loading={view.status === "loading"}
        stale={view.status === "stale"}
        truncated={view.projection?.truncated === true}
      />
      {view.status === "loading" && !view.projection ? (
        <ChangesPanelState icon={<LoaderCircle className={styles.spinning} size={20} />} text="正在读取本会话修改记录。" />
      ) : view.status === "error" && !view.projection ? (
        <ChangesPanelState
          actionLabel="重试"
          icon={<TriangleAlert size={20} />}
          text="修改记录暂时不可用；对话和其他检查器功能不受影响。"
        />
      ) : view.status === "stale" && !view.projection ? (
        <ChangesPanelState actionLabel="加载记录" icon={<RefreshCw size={20} />} text="当前投影已失效，需要从 Pi Runtime 重新读取。" />
      ) : items.length === 0 ? (
        <ChangesPanelState icon={<CircleCheck size={20} />} text="当前活动分支还没有 edit 或 write 修改记录。" />
      ) : (
        <div className={styles.body}>
          <div aria-label="当前会话修改记录" className={styles.list} role="list">
            {groupedItems.map((group, groupIndex) => {
              const unreadCount = group.items.filter((change) => (
                !workspaceChangeViewed(viewedFingerprints, change)
              )).length;
              const groupLabel = group.currentOperation
                ? "当前操作"
                : `第 ${groupedItems.slice(groupIndex).filter((candidate) => !candidate.currentOperation).length} 轮`;
              return (
                <section
                  aria-label={`修改${groupLabel}`}
                  className={styles.turnGroup}
                  key={group.key}
                  role="group"
                >
                  <div className={styles.turnHeading}>
                    <span>{groupLabel}</span>
                    {unreadCount > 0 ? <small>{unreadCount} 条未查看</small> : <small>已查看</small>}
                  </div>
                  {group.items.toReversed().map((change) => {
                    const viewed = workspaceChangeViewed(viewedFingerprints, change);
                    return (
                      <div key={change.toolCallId} role="listitem">
                        <button
                          aria-label={`${change.path}，${viewed ? "已查看" : "未查看"}`}
                          aria-pressed={selected?.toolCallId === change.toolCallId}
                          className={`${styles.row} ${selected?.toolCallId === change.toolCallId ? styles.selected : ""}`}
                          data-viewed={viewed ? "true" : "false"}
                          onClick={() => setSelectedToolCallId(change.toolCallId)}
                          type="button"
                        >
                          <span className={[styles.status, styles[change.status]].filter(Boolean).join(" ")}>{statusIcon(change.status)}</span>
                          <span>
                            <code title={change.path}>{change.path}{change.pathTruncated ? "…" : ""}</code>
                            <small>{changeKindLabel(change.kind)} · {changeStatusLabel(change.status)}</small>
                          </span>
                          {!viewed ? <i aria-hidden="true" className={styles.unreadDot} /> : null}
                          <ChangeRowMetric change={change} />
                        </button>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
          {selected ? <ChangeDetail change={selected} /> : null}
        </div>
      )}
    </div>
  );
}

function ChangesNotices({ error, loading, stale, truncated }: {
  error: string | undefined;
  loading: boolean;
  stale: boolean;
  truncated: boolean;
}) {
  if (error) {
    return <p className={styles.error} role="alert"><TriangleAlert aria-hidden="true" size={14} />无法读取修改记录：{error}</p>;
  }
  if (truncated) {
    return <p className={styles.warning}><TriangleAlert aria-hidden="true" size={14} />仅显示预算内最近记录；更早的修改仍保留在 Pi JSONL 中。</p>;
  }
  if (loading) {
    return <p className={styles.warning}><LoaderCircle aria-hidden="true" className={styles.spinning} size={14} />正在刷新，当前内容会保留到新投影提交。</p>;
  }
  if (stale) {
    return <p className={styles.warning}><TriangleAlert aria-hidden="true" size={14} />当前内容可能已过期，请刷新后再据此审阅。</p>;
  }
  return <p className={styles.authority}>Pi Session 修改投影，不等于当前 Git 或完整 Workspace Diff。</p>;
}

function ChangesPanelState({ actionLabel, icon, text }: {
  actionLabel?: string;
  icon: ReactNode;
  text: string;
}) {
  return (
    <div className={styles.state} role="status">
      {icon}
      <p>{text}</p>
      {actionLabel ? <button onClick={() => void refreshWorkspaceChanges()} type="button">{actionLabel}</button> : null}
    </div>
  );
}

function ChangeDetail({ change }: { change: WorkspaceChangeView }) {
  return (
    <section aria-label={`修改详情 ${change.path}`} className={styles.detail}>
      <div className={styles.detailHeading}>
        <div>
          <span>{changeKindLabel(change.kind)} · {shortToolCallId(change.toolCallId)}</span>
          <code title={change.path}>{change.path}{change.pathTruncated ? "…" : ""}</code>
        </div>
        <ChangeDetailMetric change={change} />
      </div>
      {change.kind === "write" ? (
        <p className={styles.explanation}>write Tool Result 不包含写入前版本，因此这里只显示写入规模，不伪造历史 Diff。</p>
      ) : change.patch ? (
        <PatchView ariaLabel="本会话修改 Patch" patch={change.patch} sourceTruncated={change.patchTruncated} />
      ) : (
        <p className={styles.explanation}>{change.status === "pending" || change.status === "running"
          ? "Pi 尚未返回可展示的 Patch。"
          : "本条 edit 记录没有可用 Patch；不会从 Renderer 读取文件来补造 Diff。"}</p>
      )}
    </section>
  );
}

function ChangeRowMetric({ change }: { change: WorkspaceChangeView }) {
  if (change.kind === "edit" && (change.additions !== undefined || change.deletions !== undefined)) {
    return <span className={styles.stats}><b>+{change.additions ?? 0}</b><i>-{change.deletions ?? 0}</i></span>;
  }
  if (change.kind === "write") return <span className={styles.meta}>{writeMetric(change)}</span>;
  return null;
}

function ChangeDetailMetric({ change }: { change: WorkspaceChangeView }) {
  if (change.kind === "edit") {
    return <span className={styles.stats}><b>+{change.additions ?? 0}</b><i>-{change.deletions ?? 0}</i></span>;
  }
  return <span className={styles.meta}>{writeMetric(change)}</span>;
}

export function selectWorkspaceChange(
  items: WorkspaceChangeView[],
  selectedToolCallId: string | undefined
): WorkspaceChangeView | undefined {
  return items.find((item) => item.toolCallId === selectedToolCallId) ?? items.at(-1);
}

export function summarizeWorkspaceChanges(items: WorkspaceChangeView[], total: number): string {
  const fileCount = new Set(items.map((item) => item.path)).size;
  return `${fileCount} 个文件 · ${total} 条记录`;
}

export interface WorkspaceChangeTurnGroup {
  key: string;
  currentOperation: boolean;
  items: WorkspaceChangeView[];
}

export function groupWorkspaceChangesByTurn(
  items: readonly WorkspaceChangeView[]
): WorkspaceChangeTurnGroup[] {
  const groups: WorkspaceChangeTurnGroup[] = [];
  const byKey = new Map<string, WorkspaceChangeTurnGroup>();
  for (const change of items) {
    const key = change.turnId ?? "current-operation";
    let group = byKey.get(key);
    if (!group) {
      group = { key, currentOperation: change.turnId === undefined, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(change);
  }
  return groups;
}

function statusIcon(status: WorkspaceChangeView["status"]): ReactNode {
  if (status === "completed") return <CircleCheck aria-label="已完成" size={14} />;
  if (status === "failed") return <CircleX aria-label="失败" size={14} />;
  if (status === "interrupted") return <TriangleAlert aria-label="已中断" size={14} />;
  if (status === "running") return <LoaderCircle aria-label="运行中" className={styles.spinning} size={14} />;
  return <CircleDashed aria-label="等待中" size={14} />;
}

function changeKindLabel(kind: WorkspaceChangeView["kind"]): string {
  return kind === "edit" ? "编辑" : "写入";
}

function changeStatusLabel(status: WorkspaceChangeView["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "interrupted") return "已中断";
  if (status === "running") return "运行中";
  return "等待中";
}

function shortToolCallId(toolCallId: string): string {
  return toolCallId.length <= 16 ? toolCallId : `${toolCallId.slice(0, 13)}…`;
}

function writeMetric(change: Extract<WorkspaceChangeView, { kind: "write" }>): string {
  if (change.metricsTruncated) return "规模已截断";
  if (change.writtenBytes === undefined && change.writtenLines === undefined) return "规模未知";
  const parts = [
    change.writtenBytes === undefined ? undefined : formatBytes(change.writtenBytes),
    change.writtenLines === undefined ? undefined : `${change.writtenLines} 行`
  ].filter((value): value is string => value !== undefined);
  return parts.join(" · ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
