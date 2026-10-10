import { imageCandidateActions } from "@pi67/domain";
import type { ImageCandidateReceipt } from "@pi67/protocol";
import { Bot, Download, FilePlus, RotateCcw, User } from "lucide-react";
import { Button } from "react-aria-components";
import { acceptCandidate, discardCandidate, editImageProject, exportImageProject, inspectCandidate, useImageProject } from "./image-project-controller.js";
import styles from "./ImageInspector.module.css";

const AUTHORS = { human: "人", agent: "Agent", system: "系统" } as const;
const AUTHOR_ICONS = { human: User, agent: Bot, system: FilePlus } as const;
const SNAPSHOT = /^Snapshot of source revision (\d+)$/u;

/** The engine writes system summaries in English; show them as product copy. */
export function historySummary(entry: { author: keyof typeof AUTHORS; summary: string }): string {
  if (entry.author !== "system") return entry.summary;
  const snapshot = SNAPSHOT.exec(entry.summary);
  return snapshot ? `复制自修订 ${snapshot[1]}` : "创建项目";
}

/** 历史: every revision newest first; returning to one publishes a new `revert_to` revision. */
export function ImageHistoryPanel() {
  const history = useImageProject((state) => state.history);
  const revision = useImageProject((state) => state.revision);
  const busy = useImageProject((state) => state.busy);
  if (history.length === 0) return <p className={styles.empty}>正在读取历史…</p>;
  return (
    <ol aria-label="修订历史" className={styles.history}>
      {[...history].reverse().map((entry) => {
        const Icon = AUTHOR_ICONS[entry.author];
        return (
        <li key={entry.revision} className={`${styles.historyItem} ${entry.revision === revision ? styles.historyCurrent : ""}`}>
          <span className={styles.historyHead}>
            <Icon aria-hidden="true" size={13} />
            <strong>修订 {entry.revision}</strong>
            <span className={styles.historyMeta}>{AUTHORS[entry.author]} · {timeLabel(entry.writtenAt)}</span>
          </span>
          <span className={styles.historySummary}>{historySummary(entry)}{entry.candidateId ? " · 接受候选" : ""}</span>
          {entry.revision !== revision ? (
            <Button className={styles.historyAction!} isDisabled={busy}
              onPress={() => void editImageProject(`回到修订 ${entry.revision}`, [{ type: "revert_to", revision: entry.revision }])}>
              <RotateCcw aria-hidden="true" size={12} />回到此修订
            </Button>
          ) : <span className={styles.historyMeta}>当前</span>}
        </li>
        );
      })}
    </ol>
  );
}

/** 候选: receipts in words; accept / discard follow the engine's rules for each status. */
export function ImageCandidatesPanel() {
  const candidates = useImageProject((state) => state.candidates);
  const inspecting = useImageProject((state) => state.inspecting);
  const comparing = useImageProject((state) => state.comparing);
  const busy = useImageProject((state) => state.busy);
  if (candidates.length === 0) return <p className={styles.empty}>还没有候选。生成或编辑图片内容时，结果先放在这里，由你决定是否采用。</p>;
  return (
    <ul aria-label="候选" className={styles.candidateList}>
      {candidates.map((candidate) => {
        const actions = imageCandidateActions(candidate.status);
        return (
          <li key={candidate.candidateId} className={styles.candidateItem}>
            <strong>{candidate.summary ?? candidate.candidateId}</strong>
            <span className={styles.historyMeta}>
              {candidate.generated ? "模型生成" : "本地合成"}{candidate.baseRevision ? ` · 基于修订 ${candidate.baseRevision}` : ""}
              {candidate.protectedChangedPixels === 0 ? " · 保护区未变" : candidate.protectedChangedPixels ? ` · 保护区 ${candidate.protectedChangedPixels} 像素变化` : ""}
            </span>
            {candidate.receipt ? <span className={styles.historyMeta}>{candidateReceiptLine(candidate.receipt)}</span> : null}
            <span className={styles.candidateActions}>
              {actions.compare ? <Button className={styles.historyAction!} onPress={() => inspectCandidate(inspecting === candidate.candidateId ? undefined : candidate.candidateId)}>{inspecting === candidate.candidateId ? "结束预览" : "在画布预览"}</Button> : null}
              {actions.compare ? <Button aria-pressed={inspecting === candidate.candidateId && comparing} className={styles.historyAction!}
                onPress={() => inspectCandidate(candidate.candidateId, { compare: !(inspecting === candidate.candidateId && comparing) })}>对比</Button> : null}
              {actions.accept ? <Button className={styles.historyAction!} isDisabled={busy} onPress={() => void acceptCandidate(candidate.candidateId)}>接受</Button> : null}
              {actions.discard ? <Button className={styles.historyAction!} isDisabled={busy} onPress={() => void discardCandidate(candidate.candidateId)}>丢弃</Button> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** 导出: the current revision at its native size; presets arrive with derived sizes (P3 checkpoint 5). */
export function ImageExportPanel() {
  const document = useImageProject((state) => state.document);
  const revision = useImageProject((state) => state.revision);
  const busy = useImageProject((state) => state.busy);
  if (!document) return null;
  return (
    <div className={styles.properties}>
      <p className={styles.sectionLabel}>原尺寸 PNG</p>
      <p className={styles.readout}>{document.canvas.width} × {document.canvas.height} · 修订 {revision}</p>
      <Button className="primary-button" isDisabled={busy} onPress={() => void exportImageProject()}><Download aria-hidden="true" size={14} />导出 PNG</Button>
      <p className={styles.empty}>导出前会重新渲染当前修订并校验文件摘要；文字始终是排版层，不会被模型改写。</p>
    </div>
  );
}

const QUALITY: Readonly<Record<string, string>> = { low: "低质量", medium: "中质量", high: "高质量" };

/** A generation receipt in words. The image itself is never judged, so visual quality is always unverified. */
export function candidateReceiptLine(receipt: ImageCandidateReceipt): string {
  const parts = [receipt.model];
  if (receipt.quality) parts.push(QUALITY[receipt.quality] ?? receipt.quality);
  if (receipt.size) parts.push(receipt.size.replace("x", "×"));
  if (receipt.durationMs !== undefined) parts.push(`用时 ${Math.max(1, Math.round(receipt.durationMs / 1000))} 秒`);
  return [...parts, "费用未估计", "画面质量未核验"].join(" · ");
}

function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
