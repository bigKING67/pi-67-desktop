import { imageCandidateActions, imageObjectInEffect, type ImageCandidateListStatus, type ImageDocument, type ImageSceneObject } from "@pi67/domain";
import type { ImageCandidateSummary, ImageTextCheck } from "@pi67/protocol";
import { ArrowLeft, Check, Columns2, Download, Redo2, SquareDashedMousePointer, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  acceptCandidate,
  discardCandidate,
  inspectCandidate,
  editImageProjectWithNotice,
  loadImageProject,
  redoImageEdit,
  selectImageObject,
  subscribeImageProjectChanges,
  undoImageEdit,
  useImageProject
} from "./image-project-controller.js";
import { candidateCheckKey, checkCandidateTexts, exportImageProject, useImageTextChecks } from "./image-project-export.js";
import { ImageTextCheckDialog } from "./ImageTextCheckDialog.js";
import { ImageCanvas } from "./ImageCanvas.js";
import { ImageCandidateCompare } from "./ImageCandidateCompare.js";
import { ImageMarksBar } from "./ImageMarksBar.js";
import { addImageMark } from "./image-project-marks.js";
import type { Rect } from "./image-canvas-geometry.js";
import { ImageSelectionBar } from "./ImageSelectionBar.js";
import { groupSelectedLayers, selectedGroup, ungroupImageGroup } from "./image-project-groups.js";
import { ImageProjectConversationDock } from "./ImageProjectConversationDock.js";
import { imagePreviewUrl } from "./image-workbench-controller.js";
import { useImageWorkbench } from "./image-workbench-store.js";
import styles from "./ImageProjectPage.module.css";

const NO_SELECTION: readonly string[] = [];

const STATUS_LABELS: Record<ImageCandidateListStatus, string> = {
  ready: "待选", stale: "已过期", accepted: "已接受", discarded: "已丢弃", decision_pending: "待恢复", incomplete: "未完成", unreadable: "无法读取"
};

/** One image project: the fitted canvas above, the candidate strip and the project conversation below. */
export function ImageProjectPage({ projectId }: { projectId: string }) {
  const libraryId = useWorkbenchStore((state) => state.imageLibraryWorkspaceId);
  const openLibrary = useImageWorkbench((state) => state.openLibrary);
  const document = useImageProject((state) => state.document);
  const revision = useImageProject((state) => state.revision);
  const preview = useImageProject((state) => state.preview);
  const candidates = useImageProject((state) => state.candidates);
  const candidatePreviews = useImageProject((state) => state.candidatePreviews);
  const inspecting = useImageProject((state) => state.inspecting);
  const comparing = useImageProject((state) => state.comparing);
  const error = useImageProject((state) => state.error);
  const busy = useImageProject((state) => state.busy);
  const selectedIds = useImageProject((state) => state.selectedObjectIds);
  const canUndo = useImageProject((state) => state.back.length > 0 || (state.revision ?? 0) > 1);
  const canRedo = useImageProject((state) => state.forward.length > 0);
  const marks = useImageProject((state) => state.marks);
  const [marking, setMarking] = useState(false);
  const [focusMark, setFocusMark] = useState<{ id: string }>();
  const mark = (rect: Rect) => { const id = addImageMark(rect); if (id) setFocusMark({ id }); };

  useEffect(() => {
    void loadImageProject(projectId);
    return subscribeImageProjectChanges();
  }, [projectId]);
  // A new project starts outside mark mode; its marks were reset with the project.
  useEffect(() => setMarking(false), [projectId]);
  // Previewing a candidate ends mark mode rather than hiding it until the preview closes.
  useEffect(() => { if (inspecting) setMarking(false); }, [inspecting]);

  // Escape leaves mark mode unless a field (a mark's instruction) has focus.
  useEffect(() => {
    if (!marking) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (event.target instanceof HTMLElement && event.target.closest("input, textarea"))) return;
      setMarking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marking]);

  const groupingAllowed = useRef(true);
  groupingAllowed.current = !inspecting && !marking;
  // ⌘Z / ⇧⌘Z (Ctrl on Windows) publish `revert_to`, and ⌘G / ⇧⌘G group and ungroup the selection, except while typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!(event.metaKey || event.ctrlKey) || (key !== "z" && key !== "g")) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]")) return;
      event.preventDefault();
      if (key === "z") { void (event.shiftKey ? redoImageEdit() : undoImageEdit()); return; }
      // Grouping edits what is on the canvas, so not while a candidate is shown or marks are drawn.
      const { document: current, selectedObjectIds, busy: working } = useImageProject.getState();
      if (working || !groupingAllowed.current) return;
      const group = selectedGroup(current, selectedObjectIds);
      if (event.shiftKey) { if (group && !group.locked) void ungroupImageGroup(group); }
      else void groupSelectedLayers();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const candidateCanvases = useImageProject((state) => state.candidateCanvases);
  const revisionCanvases = useImageProject((state) => state.revisionCanvases);
  const shown = inspecting ? candidateCanvases[inspecting] ?? candidatePreviews[inspecting] : preview;
  // Compare against the revision the candidate was made from, both at canvas size; until both arrive the canvas stays.
  const base = candidates.find((candidate) => candidate.candidateId === inspecting)?.baseRevision;
  const baseRender = base === undefined || base === revision ? preview : revisionCanvases[base];
  const candidateRender = inspecting ? candidateCanvases[inspecting] : undefined;
  const asImage = (render: typeof preview) => render && libraryId ? { src: imagePreviewUrl(libraryId, projectId, render.pngSha256), width: render.width, height: render.height } : undefined;
  const compareBefore = comparing ? asImage(baseRender) : undefined, compareAfter = comparing ? asImage(candidateRender) : undefined;
  const visible = candidates.filter((candidate) => candidate.status !== "discarded");
  // A ready candidate is read once, so its card can say which key text it leaves unreadable before it is accepted.
  useEffect(() => { for (const candidate of candidates) if (candidate.status === "ready") checkCandidateTexts(projectId, candidate.candidateId); }, [candidates, projectId]);
  return (
    <section aria-label={document?.title ?? "图像项目"} className={styles.page} data-testid="image-project">
      <header className={styles.header}>
        <Button className={styles.back!} onPress={openLibrary}><ArrowLeft aria-hidden="true" size={15} />创作库</Button>
        <span className={styles.title}>{document?.title ?? projectId}</span>
        {document ? <span className={styles.meta}>{document.canvas.width}×{document.canvas.height} · 修订 {revision}</span> : null}
        <span className={styles.spacer} />
        <Button aria-pressed={marking} className={`${styles.modeToggle} ${marking ? styles.modeToggleOn : ""}`} isDisabled={!document || Boolean(inspecting)}
          onPress={() => setMarking((value) => !value)}>
          <SquareDashedMousePointer aria-hidden="true" size={15} />标记{marks.length ? <span className={styles.modeCount}>{marks.length}</span> : null}
        </Button>
        <Button aria-label="撤销" className={styles.iconAction!} isDisabled={!canUndo || busy} onPress={() => void undoImageEdit()}><Undo2 aria-hidden="true" size={15} /></Button>
        <Button aria-label="重做" className={styles.iconAction!} isDisabled={!canRedo || busy} onPress={() => void redoImageEdit()}><Redo2 aria-hidden="true" size={15} /></Button>
        <Button className="secondary-button" isDisabled={!document || busy} onPress={() => void exportImageProject()}>
          <Download aria-hidden="true" size={14} />导出 PNG
        </Button>
      </header>
      <div className={styles.stageFrame}>
        {error ? <p className={styles.status} role="alert">{error}</p> : compareBefore && compareAfter ? (
          <ImageCandidateCompare after={compareAfter} baseRevision={base ?? revision ?? 1} before={compareBefore} />
        ) : (
          <ImageCanvas
            alt={inspecting ? "候选预览" : `${document?.title ?? "图像"} 修订 ${revision}`}
            document={document}
            editable={!inspecting && !busy && !marking}
            marking={marking}
            marks={marks}
            selectedIds={inspecting ? NO_SELECTION : selectedIds}
            src={shown && libraryId ? imagePreviewUrl(libraryId, projectId, shown.pngSha256) : undefined}
            onEdit={(summary, operations) => void editImageProjectWithNotice(summary, operations)}
            onMark={mark}
            onSelect={selectImageObject}
          />
        )}
        {!error && !shown ? <p className={styles.stageStatus} role="status">正在渲染…</p> : null}
        {!error && comparing && shown && !(compareBefore && compareAfter) ? <p className={styles.stageStatus} role="status">正在准备对比…</p> : null}
        {inspecting ? (
          <div className={styles.inspectingBadge}>
            <span>{comparing ? `对比候选与修订 ${base ?? revision}，项目尚未改变` : "正在预览候选，项目尚未改变"}</span>
            <Button aria-pressed={comparing} className={styles.badgeAction!} onPress={() => inspectCandidate(inspecting, { compare: !comparing })}>
              <Columns2 aria-hidden="true" size={13} />对比
            </Button>
          </div>
        ) : null}
      </div>
      {marking ? <ImageMarksBar focus={focusMark} onAdd={mark} onDone={() => setMarking(false)} /> : (
        <ImageSelectionBar busy={busy} count={inspecting ? 0 : selectedIds.length}
          object={inspecting || selectedIds.length !== 1 || !document ? undefined : effectOf(document, selectedIds[0])} />
      )}
      <div className={styles.dock}>
        <section aria-label="候选" className={styles.candidates}>
          <h2>候选</h2>
          {visible.length === 0 ? <p className={styles.empty}>还没有候选。在对话里说要换什么，比如“把背景换成暖色影棚”。</p> : (
            <ul>
              {visible.map((candidate) => (
                <CandidateTile key={candidate.candidateId} busy={busy} projectId={projectId} candidate={candidate} inspecting={inspecting === candidate.candidateId}
                  previewUrl={libraryId && candidatePreviews[candidate.candidateId] ? imagePreviewUrl(libraryId, projectId, candidatePreviews[candidate.candidateId]!.pngSha256) : undefined} />
              ))}
            </ul>
          )}
        </section>
        <section aria-label="项目对话" className={styles.conversation}><ImageProjectConversationDock projectId={projectId} /></section>
      </div>
      <ImageTextCheckDialog />
    </section>
  );
}

const NO_TEXT_CHECKS: readonly ImageTextCheck[] = [];

function CandidateTile({ projectId, candidate, previewUrl, inspecting, busy }: { projectId: string; candidate: ImageCandidateSummary; previewUrl: string | undefined; inspecting: boolean; busy: boolean }) {
  const actions = imageCandidateActions(candidate.status);
  const unread = useImageTextChecks((state) => state.candidates[candidateCheckKey(projectId, candidate.candidateId)]) ?? NO_TEXT_CHECKS;
  return (
    <li className={`${styles.tile} ${inspecting ? styles.tileInspecting : ""}`}>
      <Button aria-label={`在画布上预览候选 ${candidate.summary ?? candidate.candidateId}`} aria-pressed={inspecting} className={styles.tilePreview!}
        isDisabled={!previewUrl} onPress={() => inspectCandidate(inspecting ? undefined : candidate.candidateId)}>
        {previewUrl ? <img alt="" src={previewUrl} /> : null}
      </Button>
      <span className={styles.tileMeta}>
        <span className={styles.tileStatus} data-status={candidate.status}>{STATUS_LABELS[candidate.status]}</span>
        {candidate.protectedChangedPixels ? <span className={styles.tileWarning}>保护区有 {candidate.protectedChangedPixels} 个像素变化</span> : null}
        {unread.length ? <span className={styles.tileWarning} title={unread.map((check) => check.text).join("\n")}>{unread.length} 段文字读不全</span> : null}
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

/** The selected object as it behaves, its group's lock and visibility folded in. */
function effectOf(document: ImageDocument, objectId: string | undefined): ImageSceneObject | undefined {
  const object = document.objects.find((item) => item.id === objectId);
  return object && imageObjectInEffect(document, object);
}
