import { FolderDown, Table } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "react-aria-components";
import { SettingsDestructiveActionDialog } from "../settings/SettingsActionDialogs.js";
import { useImageProject } from "./image-project-controller.js";
import { batchesOf, chooseBatchTable, clearBatchTable, createImageBatch, exportImageBatch, removeImageBatch, showBatchesOf, useImageBatch } from "./image-project-batch.js";
import { useImageWorkbench } from "./image-workbench-store.js";
import styles from "./ImageInspector.module.css";

/**
 * 导出 → 批量: a CSV table makes one project per row beside this one (P5). The table is
 * matched to text layers before anything is written; each batch is listed with its count,
 * and exports or is removed as one.
 */
export function ImageBatchPanel() {
  const projectId = useImageProject((state) => state.projectId);
  const revision = useImageProject((state) => state.revision);
  const busy = useImageProject((state) => state.busy);
  const projects = useImageWorkbench((state) => state.projects);
  const openLibrary = useImageWorkbench((state) => state.openLibrary);
  const draft = useImageBatch((state) => state.draft);
  const last = useImageBatch((state) => state.last);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => showBatchesOf(projectId), [projectId]);
  const batches = batchesOf(projects, projectId);
  const refused = last?.results.filter((result) => result.status === "refused") ?? [];
  return (
    <>
      <p className={styles.sectionLabel}>批量 · 基于修订 {revision}</p>
      <p className={styles.empty}>用一张 CSV 表一次做出多个变体：第一行写文字图层名或它现在的文字（如 ¥199），之后每行一个变体，空格子保留原文字。</p>
      <input ref={input} accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" className={styles.fileInput} tabIndex={-1} type="file"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void chooseBatchTable(file); }} />
      {draft ? (
        <div aria-label="批量表格" className={styles.batchDraft} role="group">
          <span className={styles.historyHead}><strong>{draft.fileName}</strong><span className={styles.historyMeta}>{draft.rows.length} 行</span></span>
          {draft.matched.length ? <span className={styles.historySummary}>{draft.matched.map((item) => `${item.column} → ${item.layer}`).join("，")}</span> : null}
          {draft.unmatched.length ? <span className={styles.historyMeta}>没对上、不会用到：{draft.unmatched.join("，")}</span> : null}
          {draft.skipped.length ? <span className={styles.historyMeta}>没有要改的文字、跳过：第 {draft.skipped.join("、")} 行</span> : null}
          {draft.problem ? <span className={styles.notice}>{draft.problem}</span> : null}
          <span className={styles.candidateActions}>
            <Button className="primary-button" isDisabled={busy || Boolean(draft.problem)} onPress={() => void createImageBatch()}>{busy ? "正在生成…" : `生成 ${draft.rows.length} 个变体`}</Button>
            <Button className="secondary-button" isDisabled={busy} onPress={clearBatchTable}>取消</Button>
          </span>
        </div>
      ) : (
        <Button className="secondary-button" isDisabled={busy} onPress={() => input.current?.click()}><Table aria-hidden="true" size={14} />选择表格…</Button>
      )}
      {refused.length ? (
        <ul aria-label="没有生成的行" className={styles.candidateList}>
          {refused.map((result) => result.status === "refused" ? <li key={result.row} className={styles.notice}>第 {result.row} 行：{result.reason}</li> : null)}
        </ul>
      ) : null}
      {batches.length ? (
        <ul aria-label="批次" className={styles.candidateList}>
          {batches.map((batch) => (
            <li key={batch.batchId} className={styles.candidateItem}>
              <span className={styles.historyHead}><strong>批次 · {batch.members.length} 个</strong><span className={styles.historyMeta}>基于修订 {batch.revision}</span></span>
              <span className={styles.candidateActions}>
                <Button className={styles.historyAction!} onPress={() => openLibrary(batch.batchId)}>在创作库查看</Button>
                <Button className={styles.historyAction!} isDisabled={busy} onPress={() => void exportImageBatch(batch.batchId)}><FolderDown aria-hidden="true" size={12} />导出批次</Button>
                <Button className={styles.historyAction!} isDisabled={busy} onPress={() => void removeImageBatch(batch.batchId)}>撤销批次</Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ImageBatchRemoveDialog />
    </>
  );
}

/** Removing a batch deletes its projects, so it is asked once, with how many were edited since. */
export function ImageBatchRemoveDialog() {
  const removing = useImageBatch((state) => state.removing);
  return (
    <SettingsDestructiveActionDialog busy={false} confirmLabel="撤销批次" eyebrow="批量" open={Boolean(removing)} pendingLabel="正在撤销…" title="撤销这个批次？"
      description={removing ? `会从创作库移除这批的 ${removing.total} 个项目${removing.edited ? `，其中 ${removing.edited} 个在生成后改过，这些改动也会一起移除` : ""}。原项目不受影响；已经导出的图片不会被删除。` : ""}
      onCancel={() => removing?.decide(false)} onConfirm={() => removing?.decide(true)} />
  );
}
