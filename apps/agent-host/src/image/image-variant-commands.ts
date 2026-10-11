import * as fs from "node:fs/promises";
import path from "node:path";
import { IMAGE_WORK_DIRECTORY, isImageId } from "@pi67/domain";
import type { AgentEvent, CommandPayloads, CommandResults, ImageBatchRowOutcome } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";
import { event, freeProjectId, key, PHOTO_EXTENSIONS, type ImageEngine } from "./image-host-support.js";
import { batchOf, firstSummary } from "./image-project-list.js";
import type { ImageWorkQueue } from "./image-work-queue.js";

// P5: batches and templates — new projects written beside a source — run by the image Host.

export interface VariantContext {
  queue: ImageWorkQueue;
  announce(workspaceId: string, announced: AgentEvent): void;
  readStagedImage?: ((id: string) => Promise<{ mimeType: string; bytes: Buffer }>) | undefined;
}

// Rows are written in table order under the source's queue (engine createBatch).
export function createBatch(context: VariantContext, engine: ImageEngine, workspaceId: string, cwd: string,
  { projectId, revision, rows }: CommandPayloads["image.batch.create"]): Promise<CommandResults["image.batch.create"]> {
  return context.queue.serial(key(workspaceId, projectId), async () => {
    const { batch_id: batchId, results } = await engine.createBatch(cwd, { project_id: projectId, revision, rows });
    for (const result of results) if (result.status === "created") context.announce(workspaceId, event("image.project.changed", { projectId: result.project_id, revision: 1, sha256: result.sha256, author: "system" }));
    return { projectId, revision, batchId, results: results.map((result): ImageBatchRowOutcome => result.status === "refused" ? result
      : { row: result.row, status: "created", projectId: result.project_id, title: result.title, shrunkText: result.shrunk }) };
  });
}

// A template is a sibling `<source>-template` (then `-2`…), copied from the revision on screen.
export function createTemplate(context: VariantContext, engine: ImageEngine, workspaceId: string, cwd: string, { projectId, revision }: CommandPayloads["image.template.create"]): Promise<CommandResults["image.template.create"]> {
  return context.queue.serial(key(workspaceId, projectId), async () => {
    const source = await engine.readProject(engine.projectRoot(cwd, projectId), { revision });
    const title = `${source.document.title.slice(0, 190)} · 模板`;
    for (let attempt = 0; ; attempt += 1) {
      const templateId = await freeProjectId(engine, cwd, `${projectId.slice(0, 54)}-template`), target = engine.projectRoot(cwd, templateId);
      await engine.ensureProjectParent(target);
      try {
        const made = await engine.createTemplate(source, target, { project_id: templateId, title });
        context.announce(workspaceId, event("image.project.changed", { projectId: templateId, revision: 1, sha256: made.sha256, author: "system" }));
        return { projectId: templateId, title, slots: made.slots };
      } catch (error) { if (attempt >= 2 || !(error instanceof Error && error.message === "Derived project already exists")) throw error; }
    }
  });
}

// Each image slot's picture arrives staged (never a renderer path) and is copied into one work
// folder for the engine to import; the folder is removed whatever happens.
export function instantiateTemplate(context: VariantContext, engine: ImageEngine, workspaceId: string, cwd: string,
  { templateId, projectId, title, texts, images }: CommandPayloads["image.template.instantiate"]): Promise<CommandResults["image.template.instantiate"]> {
  if (images.length && !context.readStagedImage) throw new HostCommandError("UNSUPPORTED", "此设备上不能导入图片附件。", false);
  return context.queue.serial(key(workspaceId, templateId), async () => {
    const template = await engine.readProject(engine.projectRoot(cwd, templateId));
    const target = engine.projectRoot(cwd, projectId), work = await engine.workDirectory(cwd, projectId, "import");
    await fs.mkdir(work, { recursive: true });
    try {
      const files: Record<string, string> = {};
      for (const [index, image] of images.entries()) {
        const staged = await context.readStagedImage!(image.attachmentId);
        const extension = PHOTO_EXTENSIONS[staged.mimeType];
        if (!extension) return { status: "refused", reason: "只支持 PNG、JPEG 或 WebP 图片。" };
        files[image.layer] = path.join(work, `slot-${index}.${extension}`);
        await fs.writeFile(files[image.layer]!, staged.bytes, { flag: "wx" });
      }
      await engine.ensureProjectParent(target);
      const result = await engine.instantiateTemplate(template, target, { project_id: projectId, title, texts: Object.fromEntries(texts.map((cell) => [cell.layer, cell.text])), images: files });
      if (result.status === "refused") return result;
      context.announce(workspaceId, event("image.project.changed", { projectId, revision: 1, sha256: result.sha256, author: "human" }));
      return { status: "created", projectId };
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
}

// A batch's projects are named `<source>-<batch>-<row>`; each is removed only when its first
// revision also names the batch, so a source is never one of them. The source is announced
// afterwards, so other windows reload their library.
export async function removeBatch(context: VariantContext, engine: ImageEngine, workspaceId: string, cwd: string, { batchId }: CommandPayloads["image.batch.remove"]): Promise<CommandResults["image.batch.remove"]> {
  let names: string[];
  const member = new RegExp(`-${batchId}-\\d+$`, "u");
  try { names = (await fs.readdir(engine.projectsDirectory(cwd))).filter((name) => isImageId(name) && member.test(name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { batchId, removed: [] }; throw error; }
  const removed: string[] = [];
  let source: string | undefined;
  for (const projectId of names.sort()) {
    const batch = batchOf(await firstSummary(engine.projectRoot(cwd, projectId), undefined));
    if (batch?.batchId !== batchId) continue;
    source = batch.projectId;
    // The project and its disposable state beside it (previews, its dock conversation).
    await context.queue.serial(key(workspaceId, projectId), async () => {
      await fs.rm(engine.projectRoot(cwd, projectId), { recursive: true, force: true });
      await fs.rm(path.join(cwd, ...IMAGE_WORK_DIRECTORY, projectId), { recursive: true, force: true });
    });
    removed.push(projectId);
  }
  if (source) {
    const project = await engine.readProject(engine.projectRoot(cwd, source)).catch(() => undefined);
    if (project) context.announce(workspaceId, event("image.project.changed", { projectId: source, revision: project.document.revision, sha256: project.sha256, author: "system" }));
  }
  return { batchId, removed };
}

