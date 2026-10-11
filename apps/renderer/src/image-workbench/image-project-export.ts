import { IMAGE_SIZE_PRESETS } from "@pi67/domain";
import type { ImageProjectSummary, ImageTextCheck } from "@pi67/protocol";
import { create } from "zustand";
import { publishNotification } from "../notifications/notification-store.js";
import { libraryId, request, useImageProject } from "./image-project-controller.js";
import { useImageWorkbench } from "./image-workbench-store.js";

// Export, with the keyed-text check first (P4 checkpoint 8): every shown text is read back
// from the full-size render by offline OCR in the Host. Text that cannot be read in full is
// listed and the person decides; a check that cannot run never blocks the export.

interface UnreadText { label: string; text: string; read: string }
interface TextCheckState {
  /** Texts the last export check could not read, waiting for 仍然导出 or 取消. */
  pending: { unread: UnreadText[]; decide: (proceed: boolean) => void } | undefined;
  /** Per `project/candidate`, the texts its render could not read; checked once when it is ready. */
  candidates: Record<string, ImageTextCheck[]>;
}
export const useImageTextChecks = create<TextCheckState>(() => ({ pending: undefined, candidates: {} }));

/** Checks each target; resolves true when everything reads, or when the person chooses to export anyway. */
async function textsReadable(targets: readonly { projectId: string; revision?: number; label: string }[]): Promise<boolean> {
  const unread: UnreadText[] = [];
  try {
    for (const target of targets) {
      const { texts } = await request("image.project.checkText", { projectId: target.projectId, ...(target.revision === undefined ? {} : { revision: target.revision }) });
      unread.push(...texts.filter((check) => !check.passed).map((check) => ({ label: target.label, text: check.text, read: check.read })));
    }
  } catch {
    publishNotification({ level: "warning", title: "没能核对图中文字", message: "这次导出没有检查文字是否完整可读。" });
    return true;
  }
  if (!unread.length) return true;
  return new Promise((resolve) => useImageTextChecks.setState({ pending: { unread, decide: (proceed) => { useImageTextChecks.setState({ pending: undefined }); resolve(proceed); } } }));
}

export const candidateCheckKey = (projectId: string, candidateId: string): string => `${projectId}/${candidateId}`;
const checking = new Set<string>();

/**
 * Reads a ready candidate's texts once, so its card can say what it covers before it is accepted.
 * A check that fails is not remembered as clean: the next pass over the candidates asks again.
 */
export function checkCandidateTexts(projectId: string, candidateId: string): void {
  const key = candidateCheckKey(projectId, candidateId);
  if (checking.has(key) || useImageTextChecks.getState().candidates[key]) return;
  checking.add(key);
  void request("image.project.checkText", { projectId, candidateId })
    .then(({ texts }) => useImageTextChecks.setState((state) => ({ candidates: { ...state.candidates, [key]: texts.filter((check) => !check.passed) } })))
    .catch(() => undefined)
    .finally(() => checking.delete(key));
}

// One export at a time: a second press while the first is checking or asking does nothing.
let exporting = false;
async function oneExport(run: () => Promise<void>): Promise<void> {
  if (exporting || useImageTextChecks.getState().pending) return;
  exporting = true;
  try { await run(); } finally { exporting = false; }
}

/** Renders the current revision at full size and asks Main to save the verified PNG. */
export function exportImageProject(): Promise<void> {
  return oneExport(async () => {
    const { projectId, revision, document } = useImageProject.getState();
    if (!projectId || revision === undefined || !document) return;
    try {
      if (!await textsReadable([{ projectId, revision, label: document.title }])) return;
      const full = await request("image.project.render", { projectId, revision, previewMax: Math.max(document.canvas.width, document.canvas.height) });
      await window.pi67.system.saveImage({ workspaceId: libraryId(), projectId, pngSha256: full.pngSha256, fileName: document.title });
    } catch (error) {
      publishNotification({ level: "error", title: "导出失败", message: error instanceof Error ? error.message : "未知错误" });
    }
  });
}

/** Sizes derived from exactly this revision; ones from earlier revisions stay in the library but out of the set. */
export function derivedSizes(projects: readonly ImageProjectSummary[], projectId: string | undefined, revision: number | undefined): { current: ImageProjectSummary[]; older: ImageProjectSummary[] } {
  // The library knows every size derived from this project, in any session; per preset the newest from this revision goes in the set.
  const mine = projects.filter((project) => project.derivedFrom?.projectId === projectId)
    .sort((a, b) => IMAGE_SIZE_PRESETS.indexOf(a.derivedFrom!.preset) - IMAGE_SIZE_PRESETS.indexOf(b.derivedFrom!.preset) || b.updatedAt - a.updatedAt);
  const current: ImageProjectSummary[] = [], older: ImageProjectSummary[] = [];
  for (const project of mine) {
    const sameRevision = project.derivedFrom!.revision === revision;
    if (sameRevision && !current.some((item) => item.derivedFrom!.preset === project.derivedFrom!.preset)) current.push(project);
    else older.push(project);
  }
  return { current, older };
}

/** The revision on screen plus every size derived from it, rendered at full size into one new export folder. */
export function exportImageSizes(): Promise<void> {
  return oneExport(async () => {
    const { projectId, revision, document, busy } = useImageProject.getState();
    if (!projectId || revision === undefined || !document || busy) return;
    const sizes = derivedSizes(useImageWorkbench.getState().projects, projectId, revision).current;
    useImageProject.setState({ busy: true });
    try {
      const targets = [{ projectId, revision, label: document.title }, ...sizes.map((size) => ({ projectId: size.projectId, label: `${size.canvas.width}×${size.canvas.height}` }))];
      if (!await textsReadable(targets)) return;
      const items = [];
      for (const target of [{ projectId, canvas: document.canvas, revision }, ...sizes.map((size) => ({ projectId: size.projectId, canvas: size.canvas, revision: undefined }))]) {
        const rendered = await request("image.project.render", { projectId: target.projectId, ...(target.revision === undefined ? {} : { revision: target.revision }),
          previewMax: Math.max(target.canvas.width, target.canvas.height) });
        items.push({ projectId: target.projectId, revision: rendered.revision, pngSha256: rendered.pngSha256, fileName: `${document.title} ${rendered.width}×${rendered.height}` });
      }
      const saved = await window.pi67.system.saveImageSet({ workspaceId: libraryId(), title: document.title, items });
      if (saved) publishNotification({ level: "success", title: `已导出 ${items.length} 张图片`, message: `在「${saved.folderName}」里，附带 receipt.json。` });
    } catch (error) {
      publishNotification({ level: "error", title: "导出失败", message: error instanceof Error ? error.message : "未知错误" });
    } finally {
      useImageProject.setState({ busy: false });
    }
  });
}
