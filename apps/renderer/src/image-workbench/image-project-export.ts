import { IMAGE_SIZE_PRESETS, TEAM_CHAT_ATTACHMENT_LIMITS, teamChatAttachmentRejection, type ImageCanvas } from "@pi67/domain";
import type { ImageProjectSummary, ImageTextCheck } from "@pi67/protocol";
import { create } from "zustand";
import { publishNotification } from "../notifications/notification-store.js";
import { libraryId, request, useImageProject } from "./image-project-controller.js";
import { useTeamChatDialogStore } from "../team-chat/team-chat-dialog-store.js";
import type { HandoffPicture } from "../team-chat/team-chat-work-bridge.js";
import { imagePreviewUrl } from "./image-workbench-controller.js";
import { useImageWorkbench } from "./image-workbench-store.js";

// Export, with the keyed-text check first (P4 checkpoint 8): every shown text is read back
// from the full-size render by offline OCR in the Host, and its strokes' contrast is measured.
// Text that cannot be read in full or is too faint is listed and the person decides; a check
// that cannot run never blocks the export.

/** A text that would ship hard to read: what the OCR saw, and its contrast when that is too low. */
interface UnreadText { label: string; text: string; read: string; passed: boolean; contrast?: number }
/** Read in full and with enough contrast for its size. */
const isClear = (check: ImageTextCheck): boolean => check.passed && !check.lowContrast;
/** What the check guards, for its dialog's words: an export to a folder or a send to the team. */
type TextCheckPurpose = "export" | "handoff";
interface TextCheckState {
  /** Texts the last export check could not read, waiting for 仍然导出 or 取消. */
  pending: { unread: UnreadText[]; purpose: TextCheckPurpose; decide: (proceed: boolean) => void } | undefined;
  /** Per `project/candidate`, the texts its render could not read; checked once when it is ready. */
  candidates: Record<string, ImageTextCheck[]>;
}
export const useImageTextChecks = create<TextCheckState>(() => ({ pending: undefined, candidates: {} }));

/** Checks each target; resolves true when everything reads, or when the person chooses to export anyway. */
async function textsReadable(targets: readonly { projectId: string; revision?: number; label: string }[], purpose: TextCheckPurpose = "export"): Promise<boolean> {
  const unread: UnreadText[] = [];
  try {
    for (const target of targets) {
      const { texts } = await request("image.project.checkText", { projectId: target.projectId, ...(target.revision === undefined ? {} : { revision: target.revision }) });
      unread.push(...texts.filter((check) => !isClear(check)).map((check) => ({ label: target.label, text: check.text, read: check.read, passed: check.passed,
        ...(check.lowContrast && check.contrast !== undefined ? { contrast: check.contrast } : {}) })));
    }
  } catch {
    publishNotification({ level: "warning", title: "没能核对图中文字", message: `这次${purpose === "export" ? "导出" : "发送"}没有检查文字是否完整可读。` });
    return true;
  }
  if (!unread.length) return true;
  return new Promise((resolve) => useImageTextChecks.setState({ pending: { unread, purpose, decide: (proceed) => { useImageTextChecks.setState({ pending: undefined }); resolve(proceed); } } }));
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
    .then(({ texts }) => useImageTextChecks.setState((state) => ({ candidates: { ...state.candidates, [key]: texts.filter((check) => !isClear(check)) } })))
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
  const set = currentSet();
  return set ? exportProjectSet(set.title, set.members) : Promise.resolve();
}

interface SetMember { projectId: string; revision?: number; canvas: ImageCanvas; label: string; fileName: (size: string) => string }

/** The revision on screen and every size derived from it, as one set (export, hand-off). */
function currentSet(): { title: string; members: SetMember[] } | undefined {
  const { projectId, revision, document } = useImageProject.getState();
  if (!projectId || revision === undefined || !document) return undefined;
  const sizes = derivedSizes(useImageWorkbench.getState().projects, projectId, revision).current;
  const fileName = (size: string) => `${document.title} ${size}`;
  return { title: document.title, members: [{ projectId, revision, canvas: document.canvas, label: document.title, fileName },
    ...sizes.map((item) => ({ projectId: item.projectId, canvas: item.canvas, label: `${item.canvas.width}×${item.canvas.height}`, fileName }))] };
}

/** One member rendered at full size into the preview cache. */
function renderFull(member: SetMember) {
  return request("image.project.render", { projectId: member.projectId, ...(member.revision === undefined ? {} : { revision: member.revision }),
    previewMax: Math.max(member.canvas.width, member.canvas.height) });
}

/**
 * Exports projects as one set: the keyed-text check over all of them first, then each rendered
 * at full size, then Main writes them into one new folder with receipt.json.
 */
export function exportProjectSet(title: string, members: readonly SetMember[]): Promise<void> {
  return oneExport(async () => {
    if (useImageProject.getState().busy || !members.length) return;
    useImageProject.setState({ busy: true });
    try {
      if (!await textsReadable(members)) return;
      const items = [];
      for (const member of members) {
        const rendered = await renderFull(member);
        items.push({ projectId: member.projectId, revision: rendered.revision, pngSha256: rendered.pngSha256, fileName: member.fileName(`${rendered.width}×${rendered.height}`) });
      }
      const saved = await window.pi67.system.saveImageSet({ workspaceId: libraryId(), title, items });
      if (saved) publishNotification({ level: "success", title: `已导出 ${items.length} 张图片`, message: `在「${saved.folderName}」里，附带 receipt.json。` });
    } catch (error) {
      publishNotification({ level: "error", title: "导出失败", message: error instanceof Error ? error.message : "未知错误" });
    } finally {
      useImageProject.setState({ busy: false });
    }
  });
}

/**
 * 发到团队…: the shared hand-off dialog with the revision on screen and its current sizes as
 * pictures (Team Chat allows 10 per message). On 发送 the pictures pass the keyed-text check
 * and are rendered at full size; the dialog sends the card, then one message with them.
 */
export function handOffImages(): void {
  const set = currentSet();
  if (!set) return;
  const members = set.members.slice(0, TEAM_CHAT_ATTACHMENT_LIMITS.perMessage)
    .map((member, index) => index === 0 ? { ...member, label: `${member.canvas.width}×${member.canvas.height}（原尺寸）` } : member);
  useTeamChatDialogStore.getState().openHandoff({ title: set.title, images: { labels: members.map((member) => member.label), prepare: () => handoffPictures(set.title, members) } });
}

/**
 * The pictures for a hand-off, one at a time with exports (it shares the text check), named so
 * Team Chat accepts them and checked against its size limit before anything is sent.
 */
async function handoffPictures(title: string, members: readonly SetMember[]): Promise<HandoffPicture[] | undefined> {
  if (exporting || useImageTextChecks.getState().pending) throw new Error("正在导出或核对文字，请稍后再发送。");
  exporting = true;
  try {
    if (!await textsReadable(members, "handoff")) return undefined;
    const base = title.replace(/^[.\s]+/u, "").slice(0, 120) || "图片";
    const pictures: HandoffPicture[] = [];
    for (const member of members) {
      const rendered = await renderFull(member);
      // The verified PNG from the preview cache, read as the page's own resource (never a path).
      const response = await fetch(imagePreviewUrl(libraryId(), member.projectId, rendered.pngSha256));
      if (!response.ok) throw new Error("没能读取渲染好的图片");
      const file = new File([await response.blob()], `${base} ${rendered.width}×${rendered.height}.png`, { type: "image/png" });
      if (teamChatAttachmentRejection(file) === "size") throw new Error(`${member.label} 超过 25 MB，不能随任务卡发送；可以先导出，再在会话里作为文件发送。`);
      pictures.push({ file, size: { width: rendered.width, height: rendered.height } });
    }
    return pictures;
  } finally {
    exporting = false;
  }
}
