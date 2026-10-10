import { IMAGE_SIZE_PRESETS, type ImageDocument, type ImageEditOperation, type ImageEngineFailure, type ImageMark, type ImageReferenceRole, type ImageSceneObject, type ImageSizePreset } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import type { AgentCommandType, CommandPayloads, CommandResults, ImageCandidateSummary, ImageDeriveOutcome, ImageProjectSummary, ImageRevisionEntry } from "@pi67/protocol";
import { useImageWorkbench } from "./image-workbench-store.js";
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
  /** Canvas-size renders of candidates once inspected; tiles keep the small previews. */
  candidateCanvases: Record<string, ImagePreview>;
  /** Canvas-size renders of earlier revisions a candidate is compared against (its base). */
  revisionCanvases: Record<number, ImagePreview>;
  /** A candidate shown on the canvas instead of the revision (preview only, nothing changes). */
  inspecting: string | undefined;
  /** The inspected candidate is shown split against the current revision. */
  comparing: boolean;
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
  /** Regions the person marked with an instruction; sent with the next message, then retired. */
  marks: ImageMark[];
  /** Image layers offered to the Agent as references, one role each; sent as the layer's current asset. */
  references: { objectId: string; role: ImageReferenceRole }[];
  /** The person detached the marks from the next message without deleting them. */
  marksHeld: boolean;
  /** Size presets derived from this project while it is open, each with the revision it came from. */
  derived: (ImageDeriveOutcome & { revision: number })[];
}

export const useImageProject = create<ImageProjectState>(() => ({
  projectId: undefined, revision: undefined, document: undefined, preview: undefined,
  candidates: [], candidatePreviews: {}, candidateCanvases: {}, revisionCanvases: {}, inspecting: undefined, comparing: false, busy: false, error: undefined, back: [], forward: [], selectedObjectIds: [], conversation: undefined, conversationKnown: false, history: [], marks: [], references: [], marksHeld: false, derived: []
}));

function libraryId(): string {
  const id = rendererWorkbenchStore.getState().imageLibraryWorkspaceId;
  if (!id) throw new Error("创作库尚未设置。");
  return id;
}

export function request<T extends AgentCommandType>(type: T, payload: CommandPayloads[T]): Promise<CommandResults[T]> {
  return agentConnectionController.request(type, payload, [], { context: { scope: "workspace", workspaceId: libraryId() } });
}

/** Opens (or refreshes) a project: document, fitted preview and candidates. */
export async function loadImageProject(projectId: string): Promise<void> {
  if (useImageProject.getState().projectId !== projectId) {
    useImageProject.setState({ projectId, revision: undefined, document: undefined, preview: undefined, candidates: [], candidatePreviews: {}, candidateCanvases: {}, revisionCanvases: {}, inspecting: undefined, comparing: false, error: undefined, back: [], forward: [], selectedObjectIds: [], conversation: undefined, conversationKnown: false, history: [], marks: [], references: [], marksHeld: false, derived: [] });
  }
  try {
    const read = await request("image.project.read", { projectId });
    const rendered = await request("image.project.render", { projectId, revision: read.latestRevision, previewMax: CANVAS_EDGE });
    if (useImageProject.getState().projectId !== projectId) return;
    const present = new Set(read.document.objects.map((object) => object.id));
    const images = new Set(read.document.objects.filter((object) => object.kind === "image").map((object) => object.id));
    useImageProject.setState((state) => ({ revision: read.latestRevision, document: read.document, preview: rendered, error: undefined,
      conversation: read.conversation ?? state.conversation, conversationKnown: true,
      selectedObjectIds: state.selectedObjectIds.every((id) => present.has(id)) ? state.selectedObjectIds : state.selectedObjectIds.filter((id) => present.has(id)),
      references: state.references.every((reference) => images.has(reference.objectId)) ? state.references : state.references.filter((reference) => images.has(reference.objectId)) }));
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
/** The ids selecting this object selects: its whole group, unless just the one is asked for. */
export function selectionFor(document: ImageDocument | undefined, objectId: string, single = false): string[] {
  const object = document?.objects.find((item) => item.id === objectId);
  if (!document || !object || single || object.group_id === undefined) return [objectId];
  return document.objects.filter((item) => item.group_id === object.group_id).map((item) => item.id);
}

/**
 * Selects an object, or with `extend` adds or removes it. A grouped object brings its
 * whole group unless `single` (⌘-click, or its own row in 图层) asks for just that one.
 */
export function selectImageObject(objectId: string | undefined, options: { extend?: boolean; single?: boolean } = {}): void {
  useImageProject.setState((state) => {
    if (objectId === undefined) return { selectedObjectIds: [] };
    const ids = selectionFor(state.document, objectId, options.single);
    if (!options.extend) return { selectedObjectIds: ids };
    const all = ids.every((id) => state.selectedObjectIds.includes(id));
    return { selectedObjectIds: all ? state.selectedObjectIds.filter((id) => !ids.includes(id)) : [...state.selectedObjectIds, ...ids.filter((id) => !state.selectedObjectIds.includes(id))] };
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
export function imageEditRefusal(error: unknown): string {
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
    const outcome = failedEdit(error);
    if (outcome.outcome === "conflict") await loadImageProject(projectId);
    return outcome;
  }
}

function failedEdit(error: unknown): ImageEditOutcome {
  if (error instanceof ProtocolRequestError && error.details?.imageReason === "revision_conflict") return { outcome: "conflict" };
  return { outcome: "refused", message: imageEditRefusal(error) };
}

/**
 * Asks the engine whether a batch would apply (structure, glyphs, text layout)
 * without publishing a revision, so text that would overflow is refused while
 * the person is still typing (flow E).
 */
export async function checkImageEdit(operations: ImageEditOperation[]): Promise<ImageEditOutcome> {
  const { projectId, revision } = useImageProject.getState();
  if (!projectId || revision === undefined) return { outcome: "refused", message: "项目尚未就绪。" };
  try {
    await request("image.project.edit", { projectId, baseRevision: revision, summary: "检查", operations, dryRun: true });
    return { outcome: "applied" };
  } catch (error) {
    return failedEdit(error);
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

/**
 * Shows a candidate on the canvas at the canvas's own resolution (not the tile's)
 * and, with `compare`, against the revision it was made from, so the divider shows
 * only what the candidate changed. Each render is requested once per project.
 */
export function inspectCandidate(candidateId: string | undefined, options: { compare?: boolean } = {}): void {
  const compare = candidateId !== undefined && options.compare === true;
  useImageProject.setState({ inspecting: candidateId, comparing: compare });
  const { projectId, revision, candidates } = useImageProject.getState();
  if (!projectId || candidateId === undefined) return;
  const failed = () => {
    if (!compare || useImageProject.getState().inspecting !== candidateId) return;
    useImageProject.setState({ comparing: false });
    publishNotification({ level: "error", title: "没能准备对比", message: "候选或它所基于的修订渲染失败，可以继续单独预览候选。" });
  };
  renderOnce(projectId, `c:${candidateId}`, (state) => state.candidateCanvases[candidateId], { projectId, candidateId, previewMax: CANVAS_EDGE },
    (state, preview) => ({ candidateCanvases: { ...state.candidateCanvases, [candidateId]: preview } }), failed);
  const base = candidates.find((candidate) => candidate.candidateId === candidateId)?.baseRevision;
  if (compare && base !== undefined && base !== revision) {
    renderOnce(projectId, `r:${base}`, (state) => state.revisionCanvases[base], { projectId, revision: base, previewMax: CANVAS_EDGE },
      (state, preview) => ({ revisionCanvases: { ...state.revisionCanvases, [base]: preview } }), failed);
  }
}

const pendingRenders = new Set<string>();

function renderOnce(projectId: string, key: string, cached: (state: ImageProjectState) => ImagePreview | undefined, payload: CommandPayloads["image.project.render"],
  store: (state: ImageProjectState, preview: ImagePreview) => Partial<ImageProjectState>, failed: () => void): void {
  const pending = `${projectId}\u0000${key}`;
  if (cached(useImageProject.getState()) || pendingRenders.has(pending)) return;
  pendingRenders.add(pending);
  request("image.project.render", payload)
    .then((preview) => { if (useImageProject.getState().projectId === projectId) useImageProject.setState((state) => store(state, preview)); })
    .catch(failed)
    .finally(() => pendingRenders.delete(pending));
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
    // The accepted pixels are now the revision; the canvas returns to it.
    useImageProject.setState((state) => ({ back: [...state.back, revision], forward: [], inspecting: undefined, comparing: false }));
  }, "没能接受候选");
}

export function discardCandidate(candidateId: string): Promise<boolean> {
  const { projectId } = useImageProject.getState();
  if (!projectId) return Promise.resolve(false);
  return mutate(async () => {
    await request("image.candidate.discard", { projectId, candidateId, summary: "丢弃候选" });
    if (useImageProject.getState().inspecting === candidateId) useImageProject.setState({ inspecting: undefined, comparing: false });
  }, "没能丢弃候选");
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

/**
 * Derives the chosen size presets from the revision on screen. Each becomes a
 * project beside this one in the library; a preset whose text cannot fit is
 * reported with its reason and writes nothing.
 */
export async function deriveImageSizes(presets: readonly ImageSizePreset[]): Promise<ImageDeriveOutcome[] | undefined> {
  const { projectId, revision, busy } = useImageProject.getState();
  if (!projectId || revision === undefined || busy || presets.length === 0) return undefined;
  useImageProject.setState({ busy: true });
  try {
    const { results } = await request("image.project.derive", { projectId, revision, presets: [...presets] });
    if (useImageProject.getState().projectId === projectId) {
      // A preset derived again replaces its earlier entry in the list; both projects stay in the library.
      useImageProject.setState((state) => ({ derived: [...state.derived.filter((item) => !results.some((result) => result.preset === item.preset)), ...results.map((result) => ({ ...result, revision }))] }));
    }
    return results;
  } catch (error) {
    publishNotification({ level: "error", title: "没能生成多尺寸", message: error instanceof Error ? error.message : "未知错误" });
    return undefined;
  } finally {
    useImageProject.setState({ busy: false });
  }
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
export async function exportImageSizes(): Promise<void> {
  const { projectId, revision, document, busy } = useImageProject.getState();
  if (!projectId || revision === undefined || !document || busy) return;
  const sizes = derivedSizes(useImageWorkbench.getState().projects, projectId, revision).current;
  useImageProject.setState({ busy: true });
  try {
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
