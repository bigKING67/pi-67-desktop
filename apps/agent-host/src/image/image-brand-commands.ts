import * as fs from "node:fs/promises";
import path from "node:path";
import type { CommandPayloads, CommandResults } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";
import { key, PHOTO_EXTENSIONS, type ImageEngine } from "./image-host-support.js";
import type { ImageWorkQueue } from "./image-work-queue.js";

// P5 checkpoint 3: the creative library's brand kit through the Host. Files arrive staged by
// Main (never a renderer path) and pass through one work folder that is removed afterwards.

export interface BrandContext {
  queue: ImageWorkQueue;
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
