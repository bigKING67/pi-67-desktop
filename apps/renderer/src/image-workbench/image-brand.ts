import type { ImageBrandKit, ImageBrandOperation } from "@pi67/domain";
import { useEffect } from "react";
import { create } from "zustand";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererWorkbenchStore, useWorkbenchStore } from "../workbench/workbench-store.js";
import { fontFailure, maskFailure } from "./image-project-additions.js";
import { mutateImageProject, request, useImageProject } from "./image-project-controller.js";
import { requestImage } from "./image-workbench-controller.js";

// P5 checkpoint 3 in the page: the creative library's one brand kit, read and edited through
// the Host on the version shown; fonts and logos are staged through Main like any file.

/** `workspaceId` is the library the kit was read from: a kit from another library is never offered. */
interface BrandState { kit: ImageBrandKit | undefined; workspaceId: string | undefined; busy: boolean }
export const useImageBrand = create<BrandState>(() => ({ kit: undefined, workspaceId: undefined, busy: false }));

const library = (): string | undefined => rendererWorkbenchStore.getState().imageLibraryWorkspaceId;

/** Reads the kit (revision 0 before the first edit). */
export async function loadBrand(): Promise<ImageBrandKit | undefined> {
  const workspaceId = library();
  if (!workspaceId) return undefined;
  try {
    const kit = await requestImage(workspaceId, "image.brand.read", {});
    useImageBrand.setState({ kit, workspaceId });
    return kit;
  } catch (error) {
    publishNotification({ level: "error", title: "没能读取品牌库", message: error instanceof Error ? error.message : "未知错误" });
    return undefined;
  }
}

/** One change on the version shown; a stale version reloads the kit and says so. */
async function change(summary: string, run: (workspaceId: string, baseRevision: number) => Promise<ImageBrandKit>): Promise<boolean> {
  const workspaceId = library(), { kit, busy } = useImageBrand.getState();
  if (!workspaceId || !kit || busy) return false;
  useImageBrand.setState({ busy: true });
  try {
    useImageBrand.setState({ kit: await run(workspaceId, kit.revision), workspaceId });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const stale = /conflict/iu.test(message);
    publishNotification({ level: stale ? "info" : "warning", title: stale ? "品牌库刚被更新" : `没能${summary}`, message: stale ? "已刷新到最新内容，请再操作一次。" : brandFailure(message) });
    if (stale) await loadBrand();
    return false;
  } finally {
    useImageBrand.setState({ busy: false });
  }
}

export function editBrand(summary: string, operations: ImageBrandOperation[]): Promise<boolean> {
  return change(summary, (workspaceId, baseRevision) => requestImage(workspaceId, "image.brand.edit", { baseRevision, operations }));
}

/** Adds a font or logo the person chose: staged through Main, bound by the Host, the staged copy released. */
export function addBrandFile(file: File, kind: "font" | "logo", name = file.name.replace(/\.[^.]+$/u, "").slice(0, 40) || "Logo"): Promise<boolean> {
  return change(kind === "font" ? "添加字体" : "添加 Logo", async (workspaceId, baseRevision) => {
    const staged = await window.pi67.system.stagePromptAttachments([file]);
    try {
      const attachment = staged[0];
      if (!attachment || staged.length !== 1 || attachment.kind !== (kind === "font" ? "file" : "image")) throw new Error(kind === "font" ? "请选择 TTF 或 OTF 字体文件。" : "请选择 PNG、JPEG 或 WebP 图片。");
      return kind === "font" ? await requestImage(workspaceId, "image.brand.addFont", { baseRevision, attachmentId: attachment.id })
        : await requestImage(workspaceId, "image.brand.addLogo", { baseRevision, name, attachmentId: attachment.id });
    } finally {
      await window.pi67.system.releasePromptAttachments(staged.map((item) => item.id)).catch(() => undefined);
    }
  });
}

function brandFailure(message: string): string {
  if (/already in the brand kit/u.test(message)) return "品牌库里已经有它了。";
  if (/At most \d+ brand/u.test(message)) return "品牌库已满，请先移除不用的项目。";
  if (/Unsupported font file|font collections/u.test(message)) return "这个文件不是可用的 TTF 或 OTF 字体。";
  if (/canvas limit/u.test(message)) return "规格尺寸超出画布上限（单边 8192、总计 1677 万像素）。";
  return message;
}

/** The next free id for a new colour or spec. */
export function nextBrandId(list: readonly { id: string }[], prefix: string): string {
  let next = `${prefix}-1`;
  for (let index = 2; list.some((item) => item.id === next); index++) next = `${prefix}-${index}`;
  return next;
}

/** Runs a brand action on the open project as one undo step; a refusal or conflict is said in a notice. */
function onProject(summary: string, explain: (error: unknown) => string, run: (projectId: string, baseRevision: number) => Promise<unknown>): Promise<boolean> {
  const { projectId, revision } = useImageProject.getState();
  if (!projectId || revision === undefined) return Promise.resolve(false);
  return mutateImageProject(async () => {
    await run(projectId, revision);
    useImageProject.setState((state) => ({ back: [...state.back, revision], forward: [] }));
  }, `没能${summary}`, explain);
}

/** Sets a brand font on a text layer (bound into the project the first time). */
export function useBrandFontOn(objectId: string, fontId: string): Promise<boolean> {
  return onProject("使用品牌字体", fontFailure, (projectId, baseRevision) => request("image.project.useBrandFont", { projectId, baseRevision, fontId, objectId }));
}

/** Inserts a brand logo at the top right and selects it. */
export function insertBrandLogo(logoId: string): Promise<boolean> {
  return onProject("插入 Logo", maskFailure, async (projectId, baseRevision) => {
    const { objectId } = await request("image.project.addBrandLogo", { projectId, baseRevision, logoId });
    useImageProject.setState({ selectedObjectIds: [objectId] });
  });
}

// The kit is read again whenever a project opens (another window may have changed it),
// once at a time, and a failed read is reported once for that project.
let requested: string | undefined;

/**
 * Part of the open project's kit for its panels, or undefined without one. A kit read from
 * another library than the current one is never offered.
 */
export function useBrandKit<T>(select: (kit: ImageBrandKit) => T): T | undefined {
  const projectId = useImageProject((state) => state.projectId);
  const workspaceId = useWorkbenchStore((state) => state.imageLibraryWorkspaceId);
  useEffect(() => {
    const wanted = `${workspaceId ?? ""}\u0000${projectId ?? ""}`;
    if (!workspaceId || !projectId || requested === wanted) return;
    requested = wanted;
    void loadBrand();
  }, [workspaceId, projectId]);
  return useImageBrand((state) => { const kit = offeredKit(state, workspaceId); return kit ? select(kit) : undefined; });
}

/** The kit, when it was read from `workspaceId` (the current creative library). */
export const offeredKit = (state: BrandState, workspaceId: string | undefined): ImageBrandKit | undefined =>
  state.kit && state.workspaceId === workspaceId ? state.kit : undefined;
