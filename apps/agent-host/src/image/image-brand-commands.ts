import * as fs from "node:fs/promises";
import path from "node:path";
import type { AgentEvent, CommandPayloads, CommandResults } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";
import { event, key, PHOTO_EXTENSIONS, type ImageEngine } from "./image-host-support.js";
import type { ImageWorkQueue } from "./image-work-queue.js";

// P5 checkpoint 3: the creative library's brand kit through the Host. Files arrive staged by
// Main (never a renderer path) and pass through one work folder that is removed afterwards.

export interface BrandContext {
  queue: ImageWorkQueue;
  announce(workspaceId: string, announced: AgentEvent, refresh?: boolean): void;
  readStagedImage?: ((id: string) => Promise<{ mimeType: string; bytes: Buffer }>) | undefined;
  readStagedFile?: ((id: string) => Promise<{ name: string; bytes: Buffer }>) | undefined;
}

/** Brand edits are serial per Workspace; each names the version it read. */
const brandKey = (workspaceId: string): string => key(workspaceId, "brand");

export function readBrand(engine: ImageEngine, cwd: string): Promise<CommandResults["image.brand.read"]> {
  return engine.readBrand(cwd);
}

export function editBrand(context: BrandContext, engine: ImageEngine, workspaceId: string, cwd: string,
  { baseRevision, operations }: CommandPayloads["image.brand.edit"]): Promise<CommandResults["image.brand.edit"]> {
  return context.queue.serial(brandKey(workspaceId), () => engine.editBrand(cwd, { base_revision: baseRevision, operations }));
}

export async function addBrandFont(context: BrandContext, engine: ImageEngine, workspaceId: string, cwd: string,
  { baseRevision, attachmentId }: CommandPayloads["image.brand.addFont"]): Promise<CommandResults["image.brand.addFont"]> {
  if (!context.readStagedFile) throw new HostCommandError("UNSUPPORTED", "此设备上不能导入字体文件。", false);
  const staged = await context.readStagedFile(attachmentId);
  const extension = /\.(ttf|otf)$/iu.exec(staged.name)?.[1]?.toLowerCase();
  if (!extension) throw new HostCommandError("INVALID_PAYLOAD", "只支持 TTF 或 OTF 字体文件。", false);
  return withStaged(context, engine, workspaceId, cwd, `font.${extension}`, staged.bytes,
    (source) => engine.editBrand(cwd, { base_revision: baseRevision, operations: [{ type: "add_font", source }] }));
}

export async function addBrandLogo(context: BrandContext, engine: ImageEngine, workspaceId: string, cwd: string,
  { baseRevision, name, attachmentId }: CommandPayloads["image.brand.addLogo"]): Promise<CommandResults["image.brand.addLogo"]> {
  if (!context.readStagedImage) throw new HostCommandError("UNSUPPORTED", "此设备上不能导入图片附件。", false);
  const staged = await context.readStagedImage(attachmentId);
  const extension = PHOTO_EXTENSIONS[staged.mimeType];
  if (!extension) throw new HostCommandError("INVALID_PAYLOAD", "只支持 PNG、JPEG 或 WebP 图片。", false);
  return withStaged(context, engine, workspaceId, cwd, `logo.${extension}`, staged.bytes,
    (source) => engine.editBrand(cwd, { base_revision: baseRevision, operations: [{ type: "add_logo", name, source }] }));
}

async function withStaged<T>(context: BrandContext, engine: ImageEngine, workspaceId: string, cwd: string, name: string, bytes: Uint8Array, run: (source: string) => Promise<T>): Promise<T> {
  return context.queue.serial(brandKey(workspaceId), async () => {
    const work = await engine.workDirectory(cwd, "brand", "import");
    await fs.mkdir(work, { recursive: true });
    try {
      const source = path.join(work, name);
      await fs.writeFile(source, bytes, { flag: "wx" });
      return await run(source);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
}

/**
 * A brand font on a text layer: bound into the project by digest when it is not there yet (as the
 * person's own font, since the person added it to the kit), then set, in one revision.
 */
export function useBrandFont(context: BrandContext, engine: ImageEngine, workspaceId: string, cwd: string,
  { projectId, baseRevision, fontId, objectId }: CommandPayloads["image.project.useBrandFont"]): Promise<CommandResults["image.project.useBrandFont"]> {
  return context.queue.serial(key(workspaceId, projectId), async () => {
    const font = (await engine.readBrand(cwd)).fonts.find((item) => item.id === fontId) ?? missing("这个品牌字体已经不在品牌库里了。");
    const root = engine.projectRoot(cwd, projectId), project = await engine.readProject(root);
    const bound = project.document.fonts?.find((item) => item.sha256 === font.sha256);
    // The engine's own next-font naming, needed here since the same batch sets it.
    const id = bound?.id ?? freeId(new Set((project.document.fonts ?? []).map((item) => item.id)), (index) => `font-${index}`);
    const operations = [...(bound ? [] : [{ type: "add_font", font: { id, source: await engine.brandFile(cwd, font.file, font.sha256) } }]),
      { type: "update_object", id: objectId, patch: { font_id: id } }];
    const result = await engine.editBatch(root, { base_revision: baseRevision, author: "human", summary: `使用品牌字体 ${font.family}`, operations });
    context.announce(workspaceId, event("image.project.changed", { projectId, revision: result.document.revision, sha256: result.sha256, author: "human" }));
    return { projectId, revision: result.document.revision, sha256: result.sha256, dryRun: false };
  });
}

/** Share of the canvas's short edge the logo's longer side takes, and of its margin from the edges. */
const LOGO_SHARE = 0.2, LOGO_MARGIN = 0.04;

/** A brand logo as a new unlocked image layer at the top right, whole (contain), on top of the rest. */
export function insertBrandLogo(context: BrandContext, engine: ImageEngine, workspaceId: string, cwd: string,
  { projectId, baseRevision, logoId }: CommandPayloads["image.project.addBrandLogo"]): Promise<CommandResults["image.project.addBrandLogo"]> {
  return context.queue.serial(key(workspaceId, projectId), async () => {
    const logo = (await engine.readBrand(cwd)).logos.find((item) => item.id === logoId) ?? missing("这个 Logo 已经不在品牌库里了。");
    const root = engine.projectRoot(cwd, projectId), { document } = await engine.readProject(root);
    // A logo already in the project (inserted before) is placed again from the same asset.
    const bound = document.assets.find((asset) => asset.sha256 === logo.sha256);
    const assetId = bound?.id ?? freeId(new Set(document.assets.map((asset) => asset.id)), logoName);
    const objectId = freeId(new Set([...document.objects.map((object) => object.id), ...(document.groups ?? []).map((group) => group.id)]), logoName);
    const { width: canvasWidth, height: canvasHeight } = document.canvas, short = Math.min(canvasWidth, canvasHeight);
    const longer = Math.max(1, Math.round(short * LOGO_SHARE)), scale = longer / Math.max(logo.width, logo.height);
    const width = Math.max(1, Math.round(logo.width * scale)), height = Math.max(1, Math.round(logo.height * scale)), margin = Math.round(short * LOGO_MARGIN);
    const result = await engine.editBatch(root, { base_revision: baseRevision, author: "human", summary: `插入 Logo ${logo.name}`, operations: [
      ...(bound ? [] : [{ type: "add_asset", asset: { id: assetId, source: await engine.brandFile(cwd, logo.file, logo.sha256) } }]),
      { type: "add_object", object: { id: objectId, kind: "image", locked: false, visible: true, x: Math.max(0, canvasWidth - margin - width), y: Math.min(margin, canvasHeight - height),
        width, height, opacity: 1, asset_id: assetId, fit: "contain" } }] });
    context.announce(workspaceId, event("image.project.changed", { projectId, revision: result.document.revision, sha256: result.sha256, author: "human" }));
    return { projectId, revision: result.document.revision, sha256: result.sha256, dryRun: false, objectId };
  });
}

/** The first of `name(1)`, `name(2)`… not taken. */
function freeId(taken: ReadonlySet<string>, name: (index: number) => string): string {
  let index = 1;
  while (taken.has(name(index))) index++;
  return name(index);
}
const logoName = (index: number): string => index === 1 ? "logo" : `logo-${index}`;

const missing = (message: string): never => { throw new HostCommandError("INVALID_PAYLOAD", message, false); };
