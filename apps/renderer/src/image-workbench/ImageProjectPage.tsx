import { imageCandidateActions, type ImageCandidateListStatus } from "@pi67/domain";
import type { ImageCandidateSummary } from "@pi67/protocol";
import { ArrowLeft, Check, Download, Redo2, Undo2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  acceptCandidate,
  discardCandidate,
  exportImageProject,
  inspectCandidate,
  editImageProject,
  loadImageProject,
  redoImageEdit,
  selectImageObject,
  subscribeImageProjectChanges,
  undoImageEdit,
  useImageProject
} from "./image-project-controller.js";
import { ImageCanvas } from "./ImageCanvas.js";
import { ImageSelectionBar } from "./ImageSelectionBar.js";
import { imagePreviewUrl } from "./image-workbench-controller.js";
import { useImageWorkbench } from "./image-workbench-store.js";
import styles from "./ImageProjectPage.module.css";

const STATUS_LABELS: Record<ImageCandidateListStatus, string> = {
  ready: "待选", stale: "已过期", accepted: "已接受", discarded: "已丢弃", decision_pending: "待恢复", incomplete: "未完成", unreadable: "无法读取"
};

/** One image project: the fitted canvas above, the candidate strip and the project conversation below. */
export function ImageProjectPage({ projectId, conversation }: { projectId: string; conversation?: ReactNode }) {
  const libraryId = useWorkbenchStore((state) => state.imageLibraryWorkspaceId);
  const openLibrary = useImageWorkbench((state) => state.openLibrary);
  const document = useImageProject((state) => state.document);
  const revision = useImageProject((state) => state.revision);
  const preview = useImageProject((state) => state.preview);
  const candidates = useImageProject((state) => state.candidates);
  const candidatePreviews = useImageProject((state) => state.candidatePreviews);
  const inspecting = useImageProject((state) => state.inspecting);
  const error = useImageProject((state) => state.error);
  const busy = useImageProject((state) => state.busy);
  const selectedId = useImageProject((state) => state.selectedObjectId);
  const canUndo = useImageProject((state) => state.back.length > 0 || (state.revision ?? 0) > 1);
  const canRedo = useImageProject((state) => state.forward.length > 0);

  useEffect(() => {
    void loadImageProject(projectId);
    return subscribeImageProjectChanges();
  }, [projectId]);

  // ⌘Z / ⇧⌘Z (Ctrl on Windows) publish `revert_to`, except while typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]")) return;
      event.preventDefault();
      void (event.shiftKey ? redoImageEdit() : undoImageEdit());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = inspecting ? candidatePreviews[inspecting] : preview;
  const visible = candidates.filter((candidate) => candidate.status !== "discarded");
  return (
    <section aria-label={document?.title ?? "图像项目"} className={styles.page} data-testid="image-project">
      <header className={styles.header}>
        <Button className={styles.back!} onPress={openLibrary}><ArrowLeft aria-hidden="true" size={15} />创作库</Button>
        <span className={styles.title}>{document?.title ?? projectId}</span>
        {document ? <span className={styles.meta}>{document.canvas.width}×{document.canvas.height} · 修订 {revision}</span> : null}
        <span className={styles.spacer} />
        <Button aria-label="撤销" className={styles.iconAction!} isDisabled={!canUndo || busy} onPress={() => void undoImageEdit()}><Undo2 aria-hidden="true" size={15} /></Button>
        <Button aria-label="重做" className={styles.iconAction!} isDisabled={!canRedo || busy} onPress={() => void redoImageEdit()}><Redo2 aria-hidden="true" size={15} /></Button>
        <Button className="secondary-button" isDisabled={!document || busy} onPress={() => void exportImageProject()}>
          <Download aria-hidden="true" size={14} />导出 PNG
        </Button>
      </header>
      <div className={styles.stageFrame}>
        {error ? <p className={styles.status} role="alert">{error}</p> : (
          <ImageCanvas
            alt={inspecting ? "候选预览" : `${document?.title ?? "图像"} 修订 ${revision}`}
            document={document}
            editable={!inspecting && !busy}
            selectedId={inspecting ? undefined : selectedId}
            src={shown && libraryId ? imagePreviewUrl(libraryId, projectId, shown.pngSha256) : undefined}
            onMove={(objectId, x, y) => void editImageProject("移动", [{ type: "update_object", id: objectId, patch: { x, y } }])}
            onSelect={selectImageObject}
          />
        )}
        {!error && !shown ? <p className={styles.stageStatus} role="status">正在渲染…</p> : null}
        {inspecting ? <span className={styles.inspectingBadge}>正在预览候选，项目尚未改变</span> : null}
      </div>
      <ImageSelectionBar busy={busy} object={inspecting ? undefined : document?.objects.find((object) => object.id === selectedId)} />
      <div className={styles.dock}>
        <section aria-label="候选" className={styles.candidates}>
          <h2>候选</h2>
          {visible.length === 0 ? <p className={styles.empty}>还没有候选。在对话里说要换什么，比如“把背景换成暖色影棚”。</p> : (
            <ul>
              {visible.map((candidate) => (
                <CandidateTile key={candidate.candidateId} busy={busy} candidate={candidate} inspecting={inspecting === candidate.candidateId}
                  previewUrl={libraryId && candidatePreviews[candidate.candidateId] ? imagePreviewUrl(libraryId, projectId, candidatePreviews[candidate.candidateId]!.pngSha256) : undefined} />
              ))}
            </ul>
          )}
        </section>
        <section aria-label="项目对话" className={styles.conversation}>{conversation}</section>
      </div>
    </section>
  );
}

function CandidateTile({ candidate, previewUrl, inspecting, busy }: { candidate: ImageCandidateSummary; previewUrl: string | undefined; inspecting: boolean; busy: boolean }) {
  const actions = imageCandidateActions(candidate.status);
  return (
    <li className={`${styles.tile} ${inspecting ? styles.tileInspecting : ""}`}>
      <Button aria-label={`在画布上预览候选 ${candidate.summary ?? candidate.candidateId}`} aria-pressed={inspecting} className={styles.tilePreview!}
        isDisabled={!previewUrl} onPress={() => inspectCandidate(inspecting ? undefined : candidate.candidateId)}>
        {previewUrl ? <img alt="" src={previewUrl} /> : null}
      </Button>
      <span className={styles.tileMeta}>
        <span className={styles.tileStatus} data-status={candidate.status}>{STATUS_LABELS[candidate.status]}</span>
        {candidate.protectedChangedPixels ? <span className={styles.tileWarning}>保护区有 {candidate.protectedChangedPixels} 个像素变化</span> : null}
      </span>
      {actions.accept || actions.discard ? (
        <span className={styles.tileActions}>
          {actions.accept ? <Button aria-label="接受这个候选" className={styles.tileAction!} isDisabled={busy} onPress={() => void acceptCandidate(candidate.candidateId)}><Check aria-hidden="true" size={14} />接受</Button> : null}
          {actions.discard ? <Button aria-label="丢弃这个候选" className={styles.tileAction!} isDisabled={busy} onPress={() => void discardCandidate(candidate.candidateId)}><X aria-hidden="true" size={14} />丢弃</Button> : null}
        </span>
      ) : null}
    </li>
  );
}
