import { IMAGE_BATCH_LIMITS } from "@pi67/domain";
import { randomUUID } from "node:crypto";
import { errorCode, sha256 } from "./content-store.js";
import { ensureProjectParent, projectRoot } from "./project-location.js";
import { documentSchema, id, isLocked, isRecord, number, record, string, type ImageDocument } from "./document.js";
import { checkTextGlyphs } from "./font.js";
import { readProject, type ProjectState } from "./project.js";
import { fitText, writeSibling } from "./sibling-project.js";

// P5 checkpoint 1: a table row becomes a sibling project — the source revision with the
// row's words in its text layers, fitted like a derived size, written beside the source.

/** Rows, text layers one row may set, and the characters one cell may hold. */
export const BATCH_LIMITS = IMAGE_BATCH_LIMITS;

interface BatchInput { project_id: string; title: string; batch_id: string; row: number; texts: Record<string, string> }
export type BatchVariantResult =
  | { status: "created"; project_id: string; title: string; shrunk: string[]; sha256: string }
  | { status: "refused"; reason: string };

/** Revision 1's summary names the batch, the row and its source, so the library can group a batch. */
export const batchSummary = (batchId: string, row: number, projectId: string, revision: number): string =>
  `Batch ${batchId} row ${row} from ${projectId} revision ${revision}`;

/**
 * Writes the row as a new project at `target` from `source` (one revision, read once for the
 * whole batch). A row that names a layer the source lacks, or a locked one, leaves a layer
 * empty, uses a character no font has, or has text that cannot fit even at 70% is refused in
 * product words and writes nothing.
 */
export async function batchVariant(source: ProjectState, target: string, input: unknown): Promise<BatchVariantResult> {
  record(input, ["project_id", "title", "batch_id", "row", "texts"], "batch row");
  id(input.project_id, "batch project id"); id(input.batch_id, "batch id");
  number(input.row, "row", 1, BATCH_LIMITS.rows, true); string(input.title, "title", 200);
  if (!isRecord(input.texts)) throw new Error("Row texts must be an object");
  const entries = Object.entries(input.texts);
  if (!entries.length || entries.length > BATCH_LIMITS.texts) throw new Error(`A row sets 1–${BATCH_LIMITS.texts} text layers`);
  for (const [layer, text] of entries) {
    id(layer, "text layer"); string(text, "row text", BATCH_LIMITS.characters);
    if (!text.trim()) return { status: "refused", reason: `「${layer}」是空的；空格子应保留原文字，不要传入` };
  }
  const { project_id: projectId, title, batch_id: batchId, row, texts } = input as unknown as BatchInput;
  const root = source.root, revision = source.document.revision;
  const document: ImageDocument = { ...structuredClone(source.document), project_id: projectId, title, revision: 1, parent_sha256: null,
    change: { author: "system", summary: batchSummary(batchId, row, source.document.project_id, revision), operations: ["create"] } };
  for (const [layer, text] of Object.entries(texts)) {
    const object = document.objects.find((item) => item.id === layer);
    if (object?.kind !== "text") return { status: "refused", reason: `没有叫「${layer}」的文字图层` };
    if (isLocked(document, object)) return { status: "refused", reason: `文字图层「${layer}」已锁定` };
    object.text = text;
  }
  try { checkTextGlyphs(source.font, document.objects.filter((object) => object.kind === "text"), source.fonts); }
  catch { return { status: "refused", reason: "有字体里没有的字符" }; }
  document.schema = documentSchema(document);
  const fitted = await fitText(root, source.font, source.fonts, document);
  if (typeof fitted === "string") return { status: "refused", reason: fitted };
  const bytes = await writeSibling(root, target, document);
  return { status: "created", project_id: projectId, title, shrunk: fitted, sha256: sha256(bytes) };
}

export type BatchRowOutcome =
  | { row: number; status: "created"; project_id: string; title: string; shrunk: number; sha256: string }
  | { row: number; status: "refused"; reason: string };

/**
 * Writes every row of a table as a project `<source>-<batch>-<row>` beside the source, in
 * table order; a refused row is reported with its reason and writes nothing, the others stay.
 * Shared by the page (through the Host) and the Agent's tool.
 */
export async function createBatch(cwd: string, input: { project_id: string; revision: number; rows: readonly { row?: number; texts: readonly { layer: string; text: string }[] }[] }):
  Promise<{ batch_id: string; results: BatchRowOutcome[] }> {
  const { project_id: projectId, revision, rows } = input;
  if (!rows.length || rows.length > BATCH_LIMITS.rows) throw new Error(`A batch has 1–${BATCH_LIMITS.rows} rows`);
  const source = await readProject(projectRoot(cwd, projectId), { revision });
  const batchId = `b${randomUUID().replaceAll("-", "").slice(0, 7)}`;
  const results: BatchRowOutcome[] = [];
  // Rows keep their table numbers when given (a sheet may skip rows with nothing to change).
  for (const [index, entry] of rows.entries()) {
    const row = entry.row ?? index + 1, cells = entry.texts, texts = Object.fromEntries(cells.map((cell) => [cell.layer, cell.text]));
    if (Object.keys(texts).length !== cells.length) { results.push({ row, status: "refused", reason: "同一个文字图层出现了两次" }); continue; }
    const label = (cells[0]?.text ?? "").replace(/\s+/gu, " ").trim().slice(0, 40) || `第 ${row} 行`;
    const title = `${source.document.title.slice(0, 150)} · ${label}`, targetId = `${projectId.slice(0, 48)}-${batchId}-${row}`;
    try {
      const target = projectRoot(cwd, targetId);
      await ensureProjectParent(target);
      const result = await batchVariant(source, target, { project_id: targetId, title, batch_id: batchId, row, texts });
      results.push(result.status === "refused" ? { row, status: "refused", reason: result.reason }
        : { row, status: "created", project_id: targetId, title, shrunk: result.shrunk.length, sha256: result.sha256 });
    } catch (error) {
      // Product words only: an engine or file-system message would leak English and local paths.
      results.push({ row, status: "refused", reason: errorCode(error) === "ENOSPC" ? "磁盘空间不足，没能写入这一行" : "没能写入这一行，请重试" });
    }
  }
  return { batch_id: batchId, results };
}
