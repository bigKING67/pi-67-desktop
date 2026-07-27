import type { WorkspaceChangeStatus, WorkspaceChangeView } from "@pi67/domain";
import { AlertTriangle, CheckCircle2, FilePenLine, FilePlus2, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { refreshWorkspaceChanges } from "./workspace-changes-controller.js";
import { useCommittedWorkspaceChangesProjection } from "./workspace-changes-store.js";
import styles from "./ChangesPanel.module.css";

const MAX_PATCH_LINES = 400;

export function ChangesPanel() {
  const { authority, projection, status } = useCommittedWorkspaceChangesProjection();
  const hasAuthority = authority !== undefined;
  const [selectedId, setSelectedId] = useState<string>();
  const items = projection?.items ?? [];

  useEffect(() => {
    if (selectedId && items.some((item) => item.toolCallId === selectedId)) return;
    setSelectedId(items.at(-1)?.toolCallId);
  }, [items, selectedId]);

  const selected = items.find((item) => item.toolCallId === selectedId);
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div>
          <span className="section-label">本会话记录</span>
          <strong>{projection ? `${items.length} / ${projection.total} 项` : "尚未加载"}</strong>
        </div>
        <button
          className="small-button"
          disabled={!hasAuthority || status === "loading"}
          onClick={() => void refreshWorkspaceChanges()}
          type="button"
        >
          {status === "loading" ? "同步中" : status === "stale" ? "重新同步" : "刷新"}
        </button>
      </header>
      <p className={styles.authority}>
        来自 Pi Session 当前活动分支中的 edit/write 事实；不代表当前 Git 工作区的全部未提交修改。
      </p>
      {projection?.truncated ? (
        <p className={styles.warning}><AlertTriangle size={13} aria-hidden="true" />记录已按数量或传输预算截断。</p>
      ) : null}
      {items.length === 0 ? (
        <p className="context-empty">Pi 执行 edit 或 write 后，记录会显示在这里。</p>
      ) : (
        <div className={styles.body}>
          <div aria-label="本会话文件修改" className={styles.list} role="list">
            {items.map((change) => (
              <ChangeRow
                change={change}
                key={change.toolCallId}
                onSelect={() => setSelectedId(change.toolCallId)}
                selected={change.toolCallId === selectedId}
              />
            ))}
          </div>
          {selected ? <ChangeDetail change={selected} /> : null}
        </div>
      )}
    </div>
  );
}

function ChangeRow({
  change,
  onSelect,
  selected
}: {
  change: WorkspaceChangeView;
  onSelect: () => void;
  selected: boolean;
}) {
  const KindIcon = change.kind === "edit" ? FilePenLine : FilePlus2;
  return (
    <div role="listitem">
      <button
        aria-pressed={selected}
        className={`${styles.row} ${selected ? styles.selected : ""}`}
        onClick={onSelect}
        type="button"
      >
        <KindIcon size={14} aria-hidden="true" />
        <span>
          <code title={change.path}>{change.path}</code>
          <small>{changeSummary(change)}</small>
        </span>
        <ChangeStatus status={change.status} />
      </button>
    </div>
  );
}

function ChangeDetail({ change }: { change: WorkspaceChangeView }) {
  const preview = useMemo(
    () => patchPreview(change.kind === "edit" ? change.patch : undefined),
    [change]
  );
  return (
    <section className={styles.detail} aria-label={`${change.path} 修改详情`}>
      <div className={styles.detailHeading}>
        <div>
          <span>{change.kind === "edit" ? "Edit 记录" : "Write 记录"}</span>
          <code title={change.path}>{change.path}</code>
        </div>
        {change.kind === "edit" && (change.additions !== undefined || change.deletions !== undefined) ? (
          <span className={styles.stats}>
            <b>+{change.additions ?? 0}</b><i>-{change.deletions ?? 0}</i>
          </span>
        ) : null}
      </div>
      {change.pathTruncated ? <p className={styles.warning}>路径已按传输预算截断，仅用于显示。</p> : null}
      {change.kind === "write" ? (
        <>
          <p className={styles.explanation}>
            写入 {formatBytes(change.writtenBytes)}{change.writtenLines === undefined ? "" : ` · ${change.writtenLines} 行`}。Pi 的 write Tool Result 不包含写入前版本，因此不生成历史 Diff。
          </p>
          {change.metricsTruncated ? <p className={styles.warning}>源内容过大，写入大小和行数统计已省略。</p> : null}
        </>
      ) : change.status === "failed" ? (
        <p className={styles.explanation}>该 edit 执行失败；失败记录不会展示或统计未确认的 Patch。</p>
      ) : change.patch ? (
        <>
          {change.firstChangedLine === undefined ? null : <p className={styles.meta}>首个变化行：{change.firstChangedLine}</p>}
          <pre className={styles.patch} aria-label="Unified patch 预览">
            {preview.lines.map((line, index) => (
              <span className={patchLineClass(line)} key={`${index}-${line.slice(0, 24)}`}>{line || " "}</span>
            ))}
          </pre>
          {change.patchTruncated || preview.truncated ? (
            <p className={styles.warning}>Patch 预览已截断；增删行统计仅在完整 Patch 可用时显示。</p>
          ) : null}
        </>
      ) : (
        <p className={styles.explanation}>
          {change.status === "running" ? "Edit 正在执行，完成后将在这里显示记录的 Patch。" : "Session 中没有可验证的完整 Edit Patch。"}
        </p>
      )}
    </section>
  );
}

function ChangeStatus({ status }: { status: WorkspaceChangeStatus }) {
  const Icon = status === "running" ? LoaderCircle : status === "completed" ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`${styles.status} ${styles[status]}`} title={statusLabel(status)}>
      <Icon className={status === "running" ? styles.spinning : undefined} size={13} aria-hidden="true" />
      <span className="sr-only">{statusLabel(status)}</span>
    </span>
  );
}

function patchPreview(patch: string | undefined): { lines: string[]; truncated: boolean } {
  if (!patch) return { lines: [], truncated: false };
  const lines = patch.split("\n");
  return { lines: lines.slice(0, MAX_PATCH_LINES), truncated: lines.length > MAX_PATCH_LINES };
}

function patchLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) return styles.patchMeta!;
  if (line.startsWith("+")) return styles.added!;
  if (line.startsWith("-")) return styles.removed!;
  return styles.context!;
}

function changeSummary(change: WorkspaceChangeView): string {
  if (change.status !== "completed") return statusLabel(change.status);
  if (change.kind === "write") return `写入 ${formatBytes(change.writtenBytes)}`;
  if (change.additions === undefined && change.deletions === undefined) return "Edit 已完成";
  return `+${change.additions ?? 0} -${change.deletions ?? 0}`;
}

function statusLabel(status: WorkspaceChangeStatus): string {
  return status === "pending" ? "等待执行" : status === "running" ? "执行中" : status === "completed" ? "已完成" : status === "failed" ? "失败" : "未记录结束结果";
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "未知大小";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}
