import type { ImageDocument, ImageEditOperation, ImageEngineFailure, ImageSceneObject } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import type { AgentCommandType, CommandPayloads, CommandResults, ImageCandidateSummary, ImageRevisionEntry } from "@pi67/protocol";
import { create } from "zustand";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";

// One open image project (P2): its current document, a fitted preview, and its
// staged candidates. Every change goes through `image.*` commands against the
// library Workspace; the Host records them as `human`.

const CANVAS_EDGE = 1600;
const CANDIDATE_EDGE = 360;

interface ImagePreview { pngSha256: string; width: number; height: number }

export interface ImageProjectState {
  projectId: string | undefined;
  revision: number | undefined;
  document: ImageDocument | undefined;
  preview: ImagePreview | undefined;
  candidates: ImageCandidateSummary[];
  candidatePreviews: Record<string, ImagePreview>;
  /** A candidate shown on the canvas instead of the revision (preview only, nothing changes). */
  inspecting: string | undefined;
  busy: boolean;
  error: string | undefined;
  /** Content to return to on undo / redo, newest last (revision numbers; each step is a new `revert_to`). */
  back: number[];
  forward: number[];
  /** The dock conversation the Host remembers for this project, once one exists. */
  conversation: { sessionPath: string; sessionFileIdentity: string } | undefined;
  /** Set once the project's first read completes, so the dock knows whether a conversation exists. */
  conversationKnown: boolean;
  history: ImageRevisionEntry[];
  /** Selected objects in selection order; the last one is primary (its handles and fields show). */
  selectedObjectIds: string[];
}

export const useImageProject = create<ImageProjectState>(() => ({
  projectId: undefined, revision: undefined, document: undefined, preview: undefined,
  candidates: [], candidatePreviews: {}, inspecting: undefined, busy: false, error: undefined, back: [], forward: [], selectedObjectIds: [], conversation: undefined, conversationKnown: false, history: []
}));

function libraryId(): string {
  const id = rendererWorkbenchStore.getState().imageLibraryWorkspaceId;
  if (!id) throw new Error("创作库尚未设置。");
  return id;
}

function request<T extends AgentCommandType>(type: T, payload: CommandPayloads[T]): Promise<CommandResults[T]> {
  return agentConnectionController.request(type, payload, [], { context: { scope: "workspace", workspaceId: libraryId() } });
}

/** Opens (or refreshes) a project: document, fitted preview and candidates. */
export async function loadImageProject(projectId: string): Promise<void> {
  if (useImageProject.getState().projectId !== projectId) {
    useImageProject.setState({ projectId, revision: undefined, document: undefined, preview: undefined, candidates: [], candidatePreviews: {}, inspecting: undefined, error: undefined, back: [], forward: [], selectedObjectIds: [], conversation: undefined, conversationKnown: false, history: [] });
  }
  try {
    const read = await request("image.project.read", { projectId });
    const rendered = await request("image.project.render", { projectId, revision: read.latestRevision, previewMax: CANVAS_EDGE });
    if (useImageProject.getState().projectId !== projectId) return;
    const present = new Set(read.document.objects.map((object) => object.id));
    useImageProject.setState((state) => ({ revision: read.latestRevision, document: read.document, preview: rendered, error: undefined,
      conversation: read.conversation ?? state.conversation, conversationKnown: true,
      selectedObjectIds: state.selectedObjectIds.every((id) => present.has(id)) ? state.selectedObjectIds : state.selectedObjectIds.filter((id) => present.has(id)) }));
    await loadCandidates(projectId);
    const { revisions } = await request("image.project.history", { projectId });
    if (useImageProject.getState().projectId === projectId) useImageProject.setState({ history: revisions });
  } catch (error) {
    if (useImageProject.getState().projectId === projectId) useImageProject.setState({ error: error instanceof Error ? error.message : "项目读取失败" });
  }
}

async function loadCandidates(projectId: string): Promise<void> {
  const { candidates } = await request("image.candidate.list", { projectId });
  if (useImageProject.getState().projectId !== projectId) return;
  useImageProject.setState({ candidates });
  for (const candidate of candidates) {
    if (useImageProject.getState().candidatePreviews[candidate.candidateId] || !["ready", "stale", "accepted"].includes(candidate.status)) continue;
    void request("image.project.render", { projectId, candidateId: candidate.candidateId, previewMax: CANDIDATE_EDGE })
      .then((preview) => { useImageProject.setState((state) => ({ candidatePreviews: { ...state.candidatePreviews, [candidate.candidateId]: preview } })); })
      .catch(() => undefined);
  }
}

/** Selects one object, or with `extend` (Shift) adds or removes it from the selection. */
export function selectImageObject(objectId: string | undefined, options: { extend?: boolean } = {}): void {
  useImageProject.setState((state) => {
    if (objectId === undefined) return { selectedObjectIds: [] };
    if (!options.extend) return { selectedObjectIds: [objectId] };
    return { selectedObjectIds: state.selectedObjectIds.includes(objectId) ? state.selectedObjectIds.filter((id) => id !== objectId) : [...state.selectedObjectIds, objectId] };
  });
}

export function primaryImageObject(state: Pick<ImageProjectState, "document" | "selectedObjectIds">): ImageSceneObject | undefined {
  const id = state.selectedObjectIds.at(-1);
  return id === undefined ? undefined : state.document?.objects.find((object) => object.id === id);
}

export type ImageEditOutcome = { outcome: "applied" } | { outcome: "conflict" } | { outcome: "refused"; message: string };

const REFUSALS: Partial<Record<ImageEngineFailure, string>> = {
  locked: "对象已锁定，先在图层里解锁。",
  text_overflow: "文字放不下：把文本框调大，或减小字号、行高。",
  missing_glyph: "当前字体缺少其中的字符。",
  limit_exceeded: "超出了画布尺寸或像素上限。",
  not_found: "对象已不在当前修订里。"
};

/** The engine's refusal as product copy; unknown reasons keep the engine's words. */
function imageEditRefusal(error: unknown): string {
  const reason = error instanceof ProtocolRequestError ? error.details?.imageReason as ImageEngineFailure | undefined : undefined;
  const message = error instanceof Error ? error.message : "";
  if (reason && REFUSALS[reason]) return REFUSALS[reason];
  // Bounds are checked per object, so a canvas too small for its objects reports their geometry.
  if (/outside canvas|^Invalid object\.(x|y|width|height)$/iu.test(message)) return "对象需要完整留在画布内：先移动或缩小超出的对象。";
  if (message.startsWith("Invalid ")) return "数值超出允许范围。";
  return message || "修改未能保存";
}

/**
 * Submits one batch against the revision on screen. A conflict means the Agent or
 * another writer published first: the canvas refreshes and the caller keeps the
 * person's change as a draft to resubmit, never silently rebased (flow B).
 */
export async function editImageProject(summary: string, operations: ImageEditOperation[], options: { history?: "record" | "keep" } = {}): Promise<ImageEditOutcome> {
  const { projectId, revision, back } = useImageProject.getState();
  if (!projectId || revision === undefined) return { outcome: "refused", message: "项目尚未就绪。" };
  try {
    await request("image.project.edit", { projectId, baseRevision: revision, summary, operations });
    if (options.history !== "keep") useImageProject.setState({ back: [...back, revision], forward: [] });
    await loadImageProject(projectId);
    return { outcome: "applied" };
  } catch (error) {
    if (error instanceof ProtocolRequestError && error.details?.imageReason === "revision_conflict") {
      await loadImageProject(projectId);
      return { outcome: "conflict" };
    }
    return { outcome: "refused", message: imageEditRefusal(error) };
  }
}

/** A direct canvas or layer edit: refusals and conflicts surface as notices instead of a field. */
export async function editImageProjectWithNotice(summary: string, operations: ImageEditOperation[]): Promise<ImageEditOutcome> {
  const result = await editImageProject(summary, operations);
  if (result.outcome === "refused") publishNotification({ level: "warning", title: `没能${summary}`, message: result.message });
  if (result.outcome === "conflict") publishNotification({ level: "info", title: "项目刚被更新", message: "画布已刷新到最新修订，请再操作一次。" });
  return result;
}

export function toggleImageObjectVisibility(object: ImageSceneObject): Promise<ImageEditOutcome> {
  return editImageProjectWithNotice(object.visible ? "隐藏图层" : "显示图层", [{ type: "update_object", id: object.id, patch: { visible: !object.visible } }]);
}

/** Lock changes are their own batch, as the engine requires. */
export function toggleImageObjectLock(object: ImageSceneObject): Promise<ImageEditOutcome> {
  return editImageProjectWithNotice(object.locked ? "解锁图层" : "锁定图层", [{ type: "update_object", id: object.id, patch: { locked: !object.locked } }]);
}

/**
 * Undo publishes `revert_to` the content shown before the last change; history is
 * never rewritten. Without session history it falls back to the previous revision.
 */
export async function undoImageEdit(): Promise<void> {
  const { revision, back, forward } = useImageProject.getState();
  const target = back.at(-1) ?? (revision !== undefined && revision > 1 ? revision - 1 : undefined);
  if (revision === undefined || target === undefined) return;
  const result = await editImageProject("撤销", [{ type: "revert_to", revision: target }], { history: "keep" });
  if (result.outcome === "applied") useImageProject.setState({ back: back.slice(0, -1), forward: [...forward, revision] });
}

export async function redoImageEdit(): Promise<void> {
  const { revision, back, forward } = useImageProject.getState();
  const target = forward.at(-1);
  if (revision === undefined || target === undefined) return;
  const result = await editImageProject("重做", [{ type: "revert_to", revision: target }], { history: "keep" });
  if (result.outcome === "applied") useImageProject.setState({ back: [...back, revision], forward: forward.slice(0, -1) });
}

export function inspectCandidate(candidateId: string | undefined): void {
  useImageProject.setState({ inspecting: candidateId });
}

async function mutate(action: () => Promise<unknown>, failure: string): Promise<boolean> {
  const projectId = useImageProject.getState().projectId;
  if (!projectId || useImageProject.getState().busy) return false;
  useImageProject.setState({ busy: true });
  try {
    await action();
    await loadImageProject(projectId);
    return true;
  } catch (error) {
    publishNotification({ level: "error", title: failure, message: error instanceof Error ? error.message : "未知错误" });
    await loadImageProject(projectId);
    return false;
  } finally {
    useImageProject.setState({ busy: false });
  }
}

export function acceptCandidate(candidateId: string): Promise<boolean> {
  const { projectId, revision } = useImageProject.getState();
  if (!projectId || revision === undefined) return Promise.resolve(false);
  return mutate(async () => {
    await request("image.candidate.accept", { projectId, candidateId, baseRevision: revision, summary: "接受候选" });
    useImageProject.setState((state) => ({ back: [...state.back, revision], forward: [] }));
  }, "没能接受候选");
}

export function discardCandidate(candidateId: string): Promise<boolean> {
  const { projectId } = useImageProject.getState();
  if (!projectId) return Promise.resolve(false);
  return mutate(() => request("image.candidate.discard", { projectId, candidateId, summary: "丢弃候选" }), "没能丢弃候选");
}

/** Renders the current revision at full size and asks Main to save the verified PNG. */
export async function exportImageProject(): Promise<void> {
  const { projectId, revision, document } = useImageProject.getState();
  if (!projectId || revision === undefined || !document) return;
  try {
    const full = await request("image.project.render", { projectId, revision, previewMax: Math.max(document.canvas.width, document.canvas.height) });
    await window.pi67.system.saveImage({ workspaceId: libraryId(), projectId, pngSha256: full.pngSha256, fileName: document.title });
  } catch (error) {
    publishNotification({ level: "error", title: "导出失败", message: error instanceof Error ? error.message : "未知错误" });
  }
}

/** Agent, Pi TUI or another window changed this project: refresh what is shown. */
export function subscribeImageProjectChanges(): () => void {
  return agentConnectionController.subscribe({
    onEvent(event, envelope) {
      if ((event.type !== "image.project.changed" && event.type !== "image.candidate.changed") || envelope.context.scope !== "workspace") return;
      const { projectId } = useImageProject.getState();
      if (envelope.context.workspaceId === rendererWorkbenchStore.getState().imageLibraryWorkspaceId && event.payload.projectId === projectId) void loadImageProject(projectId);
    }
  });
}
