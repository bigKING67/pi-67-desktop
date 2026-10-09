import type { WorkspaceDescriptor } from "@pi67/domain";
import type { AgentCommandType, CommandPayloads, CommandResults } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useImageWorkbench } from "./image-workbench-store.js";

// The creative library (ADR 0010): a hidden, trusted Workspace whose image
// projects the renderer reaches only through `image.*` commands; previews come
// back as content-addressed PNGs served by Main at `app://pi67/image/...`.

const THUMBNAIL_EDGE = 480;
const thumbnailFlights = new Map<string, Promise<void>>();

export function imagePreviewUrl(workspaceId: string, projectId: string, pngSha256: string): string {
  return `app://pi67/image/${encodeURIComponent(workspaceId)}/${encodeURIComponent(projectId)}/${pngSha256}.png`;
}

function imageLibraryWorkspace(): WorkspaceDescriptor | undefined {
  const state = rendererWorkbenchStore.getState();
  return state.imageLibraryWorkspaceId ? state.workspaces[state.imageLibraryWorkspaceId] : undefined;
}

function requestImage<T extends AgentCommandType>(workspaceId: string, type: T, payload: CommandPayloads[T]): Promise<CommandResults[T]> {
  return agentConnectionController.request(type, payload, [], { context: { scope: "workspace", workspaceId } });
}

/** Asks Main for the library folder once; the result is registered but never shown in the tree. */
export async function chooseImageLibrary(): Promise<boolean> {
  const workspace = await window.pi67.system.chooseImageLibrary();
  if (!workspace) return false;
  rendererWorkbenchStore.getState().registerImageLibrary(workspace);
  await loadImageLibrary();
  return true;
}

export async function loadImageLibrary(): Promise<void> {
  const workspace = imageLibraryWorkspace();
  const store = useImageWorkbench.getState();
  if (!workspace) return;
  if (workspace.availability !== "available") { store.fail("创作库文件夹当前不可用，请确认磁盘已连接。"); return; }
  store.setLoading();
  try {
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    const { projects } = await requestImage(workspace.id, "image.project.list", {});
    useImageWorkbench.getState().setProjects(projects);
    for (const project of projects) void ensureThumbnail(workspace.id, project.projectId, project.revision);
  } catch (error) {
    useImageWorkbench.getState().fail(error instanceof Error ? error.message : "创作库读取失败");
  }
}

function ensureThumbnail(workspaceId: string, projectId: string, revision: number): Promise<void> {
  const current = useImageWorkbench.getState().thumbnails[projectId];
  if (current && current.revision >= revision) return Promise.resolve();
  const key = `${workspaceId}\u0000${projectId}\u0000${revision}`;
  const existing = thumbnailFlights.get(key);
  if (existing) return existing;
  const flight = requestImage(workspaceId, "image.project.render", { projectId, revision, previewMax: THUMBNAIL_EDGE })
    .then((result) => { useImageWorkbench.getState().setThumbnail(projectId, { pngSha256: result.pngSha256, width: result.width, height: result.height, revision: result.revision }); })
    .catch(() => undefined)
    .finally(() => { thumbnailFlights.delete(key); });
  thumbnailFlights.set(key, flight);
  return flight;
}

/** `image-<date>-<random>`: engine ids are ASCII, titles are usually Chinese. */
export function newImageProjectId(now = new Date(), random = Math.random): string {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `image-${stamp}-${Math.floor(random() * 0x10000).toString(16).padStart(4, "0")}`;
}

/** Stages the chosen photo through Main (the Host reads it by id) and creates the project. */
export async function createImageProjectFromPhoto(file: File, title: string, headline: string): Promise<string | undefined> {
  const workspace = imageLibraryWorkspace();
  if (!workspace) return undefined;
  const staged = await window.pi67.system.stagePromptAttachments([file]);
  const attachment = staged[0];
  try {
    if (!attachment || staged.length !== 1 || attachment.kind !== "image") throw new Error("请选择 PNG、JPEG 或 WebP 照片。");
    const projectId = newImageProjectId();
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    await requestImage(workspace.id, "image.project.createFromPhoto", { projectId, attachmentId: attachment.id, headline: headline.trim(), title: title.trim() });
    await loadImageLibrary();
    return projectId;
  } catch (error) {
    publishNotification({ level: "error", title: "没能创建图像项目", message: error instanceof Error ? error.message : "未知错误" });
    return undefined;
  } finally {
    await window.pi67.system.releasePromptAttachments(staged.map((item) => item.id)).catch(() => undefined);
  }
}

/** Library changes from any writer (Agent, Pi TUI, another window) refresh the list and thumbnails. */
export function subscribeImageLibraryChanges(): () => void {
  return agentConnectionController.subscribe({
    onEvent(event, envelope) {
      if (event.type !== "image.project.changed" || envelope.context.scope !== "workspace") return;
      if (envelope.context.workspaceId === rendererWorkbenchStore.getState().imageLibraryWorkspaceId) void loadImageLibrary();
    }
  });
}
