import { IMAGE_ASSET_LIMIT, IMAGE_USER_FONT_LIMIT, type ImageEditOperation } from "@pi67/domain";
import type { CommandResults } from "@pi67/protocol";
import { publishNotification } from "../notifications/notification-store.js";
import { editImageProjectWithNotice, imageEditRefusal, loadImageProject, request, useImageProject, type ImageEditOutcome } from "./image-project-controller.js";
import { IMAGE_OBJECT_KIND_LABELS } from "./image-object-kinds.js";

// What the person adds to an open project: new layers, and files staged through
// Main (fonts, mask images) that a Host command binds before they are applied.

export type NewObjectKind = "text" | "rect" | "ellipse";
const NEW_OBJECT_NAMES: Readonly<Record<NewObjectKind, string>> = { text: "text", rect: "shape", ellipse: "ellipse" };

/**
 * Adds a text, rectangle or ellipse layer on top, centred on the canvas at a size that
 * suits it, then selects it. Ids continue `shape-2`, `shape-3`… so they never collide.
 */
export async function addImageObject(kind: NewObjectKind): Promise<ImageEditOutcome> {
  const { document } = useImageProject.getState();
  if (!document) return { outcome: "refused", message: "项目尚未就绪。" };
  const { width: canvasWidth, height: canvasHeight } = document.canvas, short = Math.min(canvasWidth, canvasHeight);
  const taken = new Set(document.objects.map((object) => object.id));
  let id = NEW_OBJECT_NAMES[kind];
  for (let index = 2; taken.has(id); index += 1) id = `${NEW_OBJECT_NAMES[kind]}-${index}`;
  const fontSize = Math.max(8, Math.round(short / 14));
  const width = kind === "text" ? Math.round(canvasWidth * 0.6) : Math.round(short * 0.3);
  const height = kind === "text" ? Math.round(fontSize * 1.4) : width;
  const base = { id, locked: false, visible: true, x: Math.round((canvasWidth - width) / 2), y: Math.round((canvasHeight - height) / 2), width, height, opacity: 1 };
  const object = kind === "text" ? { ...base, kind, text: "新文字", font_size: fontSize, color: "#222222", align: "center" as const, line_height: 1.2 }
    : kind === "rect" ? { ...base, kind, color: "#d9c2a3", radius: 0 } : { ...base, kind, color: "#d9c2a3" };
  // Refusals and conflicts read like every other layer action.
  const result = await editImageProjectWithNotice(`添加${IMAGE_OBJECT_KIND_LABELS[kind]}`, [{ type: "add_object", object }]);
  if (result.outcome === "applied") useImageProject.setState({ selectedObjectIds: [id] });
  return result;
}

/**
 * Stages one file the person chose, binds it with a Host command and, when given,
 * applies it to an object as a second revision; then refreshes and releases the
 * staged copy. Once bound, a failed apply reads as that step's failure, not the add's.
 */
async function addStagedFile<T extends { revision: number }>(file: File, steps: {
  accepts: RegExp; kind: "file" | "image"; wrongFile: string; title: string;
  bind: (projectId: string, baseRevision: number, attachmentId: string) => Promise<T>;
  apply?: (added: T) => { summary: string; operations: ImageEditOperation[] };
  appliedFailure: (added: T, reason: string) => { title: string; message: string };
  failure: (error: unknown) => string;
}): Promise<boolean> {
  const { projectId, busy } = useImageProject.getState();
  if (!projectId || busy) return false;
  if (!steps.accepts.test(file.name)) { publishNotification({ level: "error", title: steps.title, message: steps.wrongFile }); return false; }
  useImageProject.setState({ busy: true });
  let staged: { id: string; kind: string }[] = [];
  let added: T | undefined;
  try {
    staged = await window.pi67.system.stagePromptAttachments([file]);
    const attachment = staged[0];
    if (!attachment || staged.length !== 1 || attachment.kind !== steps.kind) throw new Error(steps.wrongFile);
    // The revision is read after staging, which can take a while for a large file.
    added = await steps.bind(projectId, useImageProject.getState().revision ?? 1, attachment.id);
    const apply = steps.apply?.(added);
    if (apply) await request("image.project.edit", { projectId, baseRevision: added.revision, ...apply });
    return true;
  } catch (error) {
    publishNotification(added ? { level: "warning", ...steps.appliedFailure(added, imageEditRefusal(error)) } : { level: "error", title: steps.title, message: steps.failure(error) });
    return false;
  } finally {
    useImageProject.setState({ busy: false });
    await loadImageProject(projectId).catch(() => undefined);
    if (staged.length) await window.pi67.system.releasePromptAttachments(staged.map((item) => item.id)).catch(() => undefined);
  }
}

/**
 * Adds a font file the person chose (TTF/OTF, staged through Main like a photo)
 * and, with `objectId`, sets it on that text as a second revision. The engine
 * refuses files it cannot parse; that reason is shown as product words.
 */
export function addImageFont(file: File, objectId?: string): Promise<boolean> {
  return addStagedFile(file, {
    accepts: /\.(ttf|otf)$/iu, kind: "file", wrongFile: "请选择 TTF 或 OTF 字体文件。", title: "没能添加字体",
    bind: (projectId, baseRevision, attachmentId) => request("image.project.addFont", { projectId, baseRevision, attachmentId }),
    ...(objectId ? { apply: (added: CommandResults["image.project.addFont"]) => ({ summary: `使用字体 ${added.family}`, operations: [{ type: "update_object", id: objectId, patch: { font_id: added.fontId } }] as ImageEditOperation[] }) } : {}),
    appliedFailure: (added, reason) => ({ title: `已添加字体 ${added.family}`, message: `但没能用在这段文字上：${reason}` }),
    failure: fontFailure
  });
}

/** Adds an image the person chose as a mask asset and masks `objectId` with it. */
export function addImageMask(file: File, objectId: string): Promise<boolean> {
  return addStagedFile(file, {
    accepts: /\.(png|jpe?g|webp)$/iu, kind: "image", wrongFile: "请选择 PNG、JPEG 或 WebP 图片。", title: "没能添加蒙版图片",
    bind: (projectId, baseRevision, attachmentId) => request("image.project.addAsset", { projectId, baseRevision, attachmentId }),
    apply: (added) => ({ summary: "使用蒙版", operations: [{ type: "update_object", id: objectId, patch: { mask: { asset_id: added.assetId } } }] }),
    appliedFailure: (added, reason) => ({ title: `已添加蒙版图片 ${added.assetId}`, message: `但没能用在这个图层上：${reason}` }),
    failure: maskFailure
  });
}

function maskFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "未知错误";
  if (/Invalid assets list/u.test(message)) return `一个项目最多有 ${IMAGE_ASSET_LIMIT} 张图片。`;
  if (/Revision conflict/u.test(message)) return "项目刚被更新，请再添加一次。";
  if (/pixel limit|exceed|too large/iu.test(message)) return "这张图片太大了，请换一张更小的图片。";
  return message;
}

function fontFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "未知错误";
  if (/Unsupported font file: font collections/u.test(message)) return "这是字体集合（TTC），请选择其中单个字体的 TTF 或 OTF 文件。";
  if (/Unsupported font file/u.test(message)) return "这个文件不是可用的 TTF 或 OTF 字体（WOFF、WOFF2 和损坏的文件都不支持）。";
  if (/already added as/u.test(message)) return "这个字体已经在项目里了。";
  if (/at most \d+ fonts/u.test(message)) return `一个项目最多添加 ${IMAGE_USER_FONT_LIMIT} 个字体。`;
  if (/not a plain file/u.test(message)) return "请选择 TTF 或 OTF 字体文件。";
  if (/Revision conflict/u.test(message)) return "项目刚被更新，请再添加一次。";
  return message;
}
