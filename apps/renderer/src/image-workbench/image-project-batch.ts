import type { ImageBatchRowOutcome, ImageProjectSummary } from "@pi67/protocol";
import { create } from "zustand";
import { publishNotification } from "../notifications/notification-store.js";
import { runAfterLeavingSettings } from "../settings/settings-leave-guard.js";
import { useShellStore } from "../shell/shell-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { batchGroups, type BatchGroup } from "./image-batch-groups.js";
import { batchTable, parseTable, type BatchColumnChoices, type BatchTable } from "./image-batch-table.js";
import { request, useImageProject } from "./image-project-controller.js";
import { exportProjectSet } from "./image-project-export.js";
import { loadImageLibrary } from "./image-workbench-controller.js";
import { useImageWorkbench } from "./image-workbench-store.js";

// P5 checkpoint 1 in the page: a CSV becomes a batch of projects beside this one; the
// library lists them as one batch, which exports as one set or is removed as one.

/** Tables larger than this are not batch tables (200 rows of 20 cells fit easily). */
const TABLE_BYTES = 2_000_000;

interface BatchState {
  /** The project the table and the last run belong to; another project starts with neither. */
  projectId: string | undefined;
  /** The table chosen for this project, matched to its text layers, before it is run. */
  /** The chosen table, kept as parsed so a column's layer can be chosen again. */
  draft: ({ fileName: string; table?: string[][] } & BatchTable) | undefined;
  /** The last run from this project: every row, created or refused with its reason. */
  last: { batchId: string; revision: number; results: ImageBatchRowOutcome[] } | undefined;
  /** A removal waiting for the person's yes, with how many of its projects were edited since. */
  removing: { batchId: string; total: number; edited: number; decide: (remove: boolean) => void } | undefined;
}
export const useImageBatch = create<BatchState>(() => ({ projectId: undefined, draft: undefined, last: undefined, removing: undefined }));

/** The panel shows this project's table and run; switching tabs keeps them, switching projects clears them. */
export function showBatchesOf(projectId: string | undefined): void {
  if (useImageBatch.getState().projectId !== projectId) useImageBatch.setState({ projectId, draft: undefined, last: undefined });
}

/** A project's batches, newest first. */
export function batchesOf(projects: readonly ImageProjectSummary[], projectId: string | undefined): BatchGroup[] {
  const newest = (group: BatchGroup): number => Math.max(...group.members.map((item) => item.updatedAt));
  return batchGroups(projects).filter((group) => group.projectId === projectId).sort((a, b) => newest(b) - newest(a));
}

/** Reads the chosen CSV (in the renderer; no path leaves it) and matches it to this project's text layers. */
export async function chooseBatchTable(file: File): Promise<void> {
  if (!useImageProject.getState().document) return;
  if (!/\.(csv|tsv|txt)$/iu.test(file.name) || file.size > TABLE_BYTES) {
    useImageBatch.setState({ draft: { fileName: file.name, columns: [], matched: [], unmatched: [], rows: [], skipped: [], problem: "请选择 2 MB 以内的 CSV 表格（Excel、Numbers 或飞书表格都可以另存为 CSV）。" } });
    return;
  }
  const opened = useImageProject.getState().projectId, text = await file.text();
  // The project, its layers and its remembered choices are read together, after the file: a
  // person who moved to another project meanwhile gets nothing written there.
  const { projectId, document } = useImageProject.getState();
  if (!projectId || !document || projectId !== opened || useImageBatch.getState().projectId !== projectId) return;
  const table = parseTable(text);
  useImageBatch.setState({ draft: { fileName: file.name, table, ...batchTable(document, table, readColumnChoices(projectId)) } });
}

/** The person's layer for a column ("" for not using it), remembered for this project, then the table matched again. */
export function chooseBatchColumn(key: string, layer: string): void {
  const { draft } = useImageBatch.getState(), { projectId, document } = useImageProject.getState();
  if (!draft?.table || !projectId || !document) return;
  const choices = { ...readColumnChoices(projectId), [key]: layer };
  writeColumnChoices(projectId, choices);
  useImageBatch.setState({ draft: { fileName: draft.fileName, table: draft.table, ...batchTable(document, draft.table, choices) } });
}

// Column choices on this computer, per creative library and project (column keys and layer ids
// only, never cell contents); the 100 most recently used projects are kept.
const COLUMN_CHOICES_KEY = "pi67.image-batch-columns.v2";
const COLUMN_CHOICES_PROJECTS = 100;
type StoredChoices = Record<string, { at: number; choices: Record<string, string> }>;
const choicesKey = (projectId: string): string => `${rendererWorkbenchStore.getState().imageLibraryWorkspaceId ?? ""}/${projectId}`;
function readAllChoices(): StoredChoices {
  try {
    const value = JSON.parse(window.localStorage.getItem(COLUMN_CHOICES_KEY) ?? "{}") as unknown;
    return typeof value === "object" && value !== null ? value as StoredChoices : {};
  } catch { return {}; }
}
function readColumnChoices(projectId: string): BatchColumnChoices {
  const entry = readAllChoices()[choicesKey(projectId)];
  const choices = typeof entry === "object" && typeof entry.choices === "object" && entry.choices !== null ? entry.choices : {};
  return Object.fromEntries(Object.entries(choices).filter(([, layer]) => typeof layer === "string"));
}
function writeColumnChoices(projectId: string, choices: BatchColumnChoices): void {
  try {
    const all = { ...readAllChoices(), [choicesKey(projectId)]: { at: Date.now(), choices: { ...choices } } };
    const kept = Object.entries(all).sort(([, x], [, y]) => (y.at ?? 0) - (x.at ?? 0)).slice(0, COLUMN_CHOICES_PROJECTS);
    window.localStorage.setItem(COLUMN_CHOICES_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch { /* Without storage the choice holds for this table only. */ }
}

export function clearBatchTable(): void { useImageBatch.setState({ draft: undefined }); }

/** Runs the chosen table against the revision on screen. */
export async function createImageBatch(): Promise<void> {
  const { draft } = useImageBatch.getState(), { projectId, revision, busy } = useImageProject.getState();
  if (!draft || draft.problem || !projectId || revision === undefined || busy) return;
  useImageProject.setState({ busy: true });
  try {
    const { batchId, results } = await request("image.batch.create", { projectId, revision, rows: draft.rows });
    // A run that finishes after the person moved to another project is reported, not shown there.
    if (useImageBatch.getState().projectId === projectId) useImageBatch.setState({ draft: undefined, last: { batchId, revision, results } });
    const created = results.filter((result) => result.status === "created").length;
    publishNotification({ level: created === results.length ? "success" : "warning", title: `已生成 ${created} 个变体`,
      message: created === results.length ? "在创作库里作为一个批次列出。" : `${results.length - created} 行没有生成，原因列在「批量」里。`,
      ...(created ? { action: { label: "查看批次", run: () => openBatch(batchId) } } : {}) });
    await loadImageLibrary();
  } catch (error) {
    publishNotification({ level: "error", title: "没能生成批次", message: error instanceof Error ? error.message : "未知错误" });
  } finally {
    useImageProject.setState({ busy: false });
  }
}

/** Removes every project of the batch after the person agrees; says how many were edited since. */
export async function removeImageBatch(batchId: string): Promise<void> {
  const members = useImageWorkbench.getState().projects.filter((project) => project.batch?.batchId === batchId);
  if (!members.length || useImageBatch.getState().removing) return;
  const confirmed = await new Promise<boolean>((resolve) => useImageBatch.setState({ removing: { batchId, total: members.length,
    edited: members.filter((project) => project.revision > 1).length, decide: (remove) => { useImageBatch.setState({ removing: undefined }); resolve(remove); } } }));
  if (!confirmed) return;
  try {
    const { removed } = await request("image.batch.remove", { batchId });
    if (useImageBatch.getState().last?.batchId === batchId) useImageBatch.setState({ last: undefined });
    publishNotification({ level: "success", title: `已撤销批次，移除了 ${removed.length} 个项目`, message: "原项目没有变化。" });
    await loadImageLibrary();
  } catch (error) {
    publishNotification({ level: "error", title: "没能撤销批次", message: error instanceof Error ? error.message : "未知错误" });
  }
}

/** Exports the batch's projects, in row order and at their latest revisions, as one set. */
export function exportImageBatch(batchId: string): Promise<void> {
  const members = batchGroups(useImageWorkbench.getState().projects).find((group) => group.batchId === batchId)?.members ?? [];
  const title = useImageProject.getState().document?.title ?? members[0]?.title ?? "批次";
  return exportProjectSet(`${title} 批次`, members.map((member) => ({ projectId: member.projectId, canvas: member.canvas, label: member.title,
    fileName: () => `${String(member.batch!.row).padStart(3, "0")} ${member.title}` })));
}

/** Opens the library on a batch from wherever the person is: Settings closes (if it may), Chat turns to Work. */
function openBatch(batchId: string): Promise<void> {
  return runAfterLeavingSettings(() => {
    if (rendererWorkbenchStore.getState().selectedSurface?.kind === "settings") rendererWorkbenchStore.getState().closeSettings();
    useShellStore.getState().setWorkspaceMode("work");
    useImageWorkbench.getState().openLibrary(batchId);
  }).then(() => undefined);
}
