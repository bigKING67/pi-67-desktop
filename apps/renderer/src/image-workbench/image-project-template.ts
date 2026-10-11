import type { ImageDocument } from "@pi67/domain";
import { publishNotification } from "../notifications/notification-store.js";
import { editImageProjectWithNotice, request, useImageProject, type ImageEditOutcome } from "./image-project-controller.js";
import { loadImageLibrary, newImageProjectId } from "./image-workbench-controller.js";
import { useImageWorkbench } from "./image-workbench-store.js";

// P5 checkpoint 2 in the page: save a revision as a template, mark its slots, and start a new
// project from it with new words and pictures in those slots.

/** Copies the revision on screen as a template beside this project and opens it. */
export async function saveAsTemplate(): Promise<void> {
  const { projectId, revision, busy } = useImageProject.getState();
  if (!projectId || revision === undefined || busy) return;
  useImageProject.setState({ busy: true });
  try {
    const made = await request("image.template.create", { projectId, revision });
    await loadImageLibrary();
    publishNotification({ level: "success", title: `已存为模板「${made.title}」`, message: `${made.slots.length} 个图层可替换，可以在模板的属性里调整。` });
    useImageWorkbench.getState().openProject(made.projectId);
  } catch (error) {
    publishNotification({ level: "error", title: "没能存为模板", message: error instanceof Error ? error.message : "未知错误" });
  } finally {
    useImageProject.setState({ busy: false });
  }
}

/** Adds the layer to the template's slots or takes it out. */
export function toggleTemplateSlot(document: ImageDocument, objectId: string): Promise<ImageEditOutcome> {
  const slots = document.template?.slots ?? [];
  const next = slots.includes(objectId) ? slots.filter((slot) => slot !== objectId) : [...slots, objectId];
  return editImageProjectWithNotice(slots.includes(objectId) ? "取消可替换" : "设为可替换", [{ type: "set_template", slots: next }]);
}

export interface TemplateDraft { title: string; texts: Record<string, string>; images: Record<string, File> }

/**
 * Makes a project from the open template: pictures are staged through Main (never a path),
 * then the Host writes the project and the page opens it. Refusals come back in product words.
 */
export async function createFromTemplate(draft: TemplateDraft): Promise<string | undefined> {
  const { projectId: templateId, document } = useImageProject.getState();
  if (!templateId || !document?.template) return undefined;
  const layers = Object.keys(draft.images), files = layers.map((layer) => draft.images[layer]!);
  let staged: { id: string; kind: string }[] = [];
  try {
    staged = files.length ? await window.pi67.system.stagePromptAttachments(files) : [];
    if (staged.length !== files.length || staged.some((item) => item.kind !== "image")) throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
    const projectId = newImageProjectId();
    // Changed words only; emptied words are sent too, so the Host refuses them with a reason instead of keeping the old text.
    const texts = Object.entries(draft.texts).filter(([layer, text]) => document.objects.some((object) => object.id === layer && object.kind === "text" && object.text !== text))
      .map(([layer, text]) => ({ layer, text }));
    const emptied = texts.find((cell) => !cell.text.trim());
    if (emptied) { publishNotification({ level: "warning", title: "没能从模板新建", message: `「${emptied.layer}」是空的；不想改就保留原文字。` }); return undefined; }
    const result = await request("image.template.instantiate", { templateId, projectId, title: draft.title.trim(), texts,
      images: staged.map((item, index) => ({ layer: layers[index]!, attachmentId: item.id })) });
    if (result.status === "refused") { publishNotification({ level: "warning", title: "没能从模板新建", message: result.reason }); return undefined; }
    await loadImageLibrary();
    useImageWorkbench.getState().openProject(projectId);
    return projectId;
  } catch (error) {
    publishNotification({ level: "error", title: "没能从模板新建", message: error instanceof Error ? error.message : "未知错误" });
    return undefined;
  } finally {
    if (staged.length) await window.pi67.system.releasePromptAttachments(staged.map((item) => item.id)).catch(() => undefined);
  }
}
