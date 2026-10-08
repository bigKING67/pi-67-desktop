import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { encodeJson, errorCode, sha256, writeOnce } from "./content-store.js";
import { LIMITS, record, id, number, string, digest, validateAsset, isRecord, type Asset, type ChangeAuthor, type ImageObject, type JsonRecord } from "./document.js";
import { regularPath, readBytes, readAsset } from "./raster.js";
import { maskBytes, compositeRaster, validateContext, type CompositeQa, type EditContext, type MaskData } from "./composite.js";
import { validateExecution, readExecution, type ExecutionBinding, type ExecutionReceipt } from "./provider-store.js";
import { inspectAlpha, requireAlpha } from "./provider-alpha.js";
import type { ProjectState } from "./project.js";

export const CANDIDATE_SCHEMA = "newmoney.image-candidate.v1";
export const LEGACY_CANDIDATE_SCHEMAS: readonly string[] = ["creative-craft.local-image-candidate.v1"];
export const MASK_KEYS = ["generation_mask", "protection_mask", "blend_mask"] as const;
export type MaskKey = typeof MASK_KEYS[number];
export type CandidateMode = "replace" | "masked";

export interface MaskBinding { file: string; sha256: string; width: number; height: number }
export interface CandidateEdit extends Record<MaskKey, MaskBinding> { coordinate_space: "target-raster"; width: number; height: number; context: EditContext }
export interface Candidate {
  schema: string; id: string; project_id: string; base_revision: number; base_sha256: string; target_id: string; base_asset: Asset;
  mode: CandidateMode; summary: string; source: Asset; output: Asset; edit: CandidateEdit | null; qa: CompositeQa | null; execution?: ExecutionBinding;
}
export interface CandidateEntry {
  directory: string; candidate: Candidate; sha256: string; source: Buffer; rendered: Buffer; output: Buffer;
  masks?: Record<MaskKey, MaskData>; receipt: ExecutionReceipt | null;
}
export interface Decision { candidate_id: string; candidate_sha256: string; author: ChangeAuthor; summary: string }

export const candidateBytes = encodeJson;
const candidateDirectory = (root: string, candidateId: string): string => { id(candidateId, "candidate id"); return path.join(root, "candidates", candidateId); };

export async function ensureDirectory(directory: string): Promise<void> {
  await regularPath(path.dirname(directory), { directory: true });
  try { await fs.mkdir(directory); } catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
  await regularPath(directory, { directory: true });
}

// Only candidate-shaped directories count; stray entries such as .DS_Store do not.
export async function candidateIds(root: string): Promise<string[]> {
  const directory = path.join(root, "candidates");
  try { await regularPath(directory, { directory: true }); }
  catch (error) { if (errorCode(error) === "ENOENT") return []; throw error; }
  const valid = (name: string): boolean => { try { id(name); return true; } catch { return false; } };
  return (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory() && valid(entry.name)).map((entry) => entry.name).sort();
}

export async function assertCandidateSlot(root: string, candidateId: string): Promise<void> {
  const ids = await candidateIds(root);
  try { await fs.lstat(candidateDirectory(root, candidateId)); throw new Error("Candidate already exists"); }
  catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
  if (ids.length >= 64) throw new Error("Candidate count limit exceeded");
}

export function validateDecision(author: unknown, summary: unknown): asserts author is ChangeAuthor {
  if (!["human", "agent", "system"].includes(author as string)) throw new Error("Invalid decision author");
  string(summary, "decision summary", 500);
}

function validateMask(binding: unknown, width: number, height: number): asserts binding is MaskBinding {
  record(binding, ["file", "sha256", "width", "height"], "mask binding"); digest(binding.sha256);
  if (binding.file !== `masks/${binding.sha256}.png` || binding.width !== width || binding.height !== height) throw new Error("Invalid mask binding");
}

const QA_COUNTS = ["protected_pixels", "outside_blend_pixels", "changed_pixels", "protected_changed_pixels", "outside_blend_changed_pixels"] as const;

export function validateCandidate(value: unknown): Candidate {
  record(value, ["schema", "id", "project_id", "base_revision", "base_sha256", "target_id", "base_asset", "mode", "summary", "source", "output", "edit", "qa", "execution"], "candidate");
  if (value.schema !== CANDIDATE_SCHEMA && !LEGACY_CANDIDATE_SCHEMAS.includes(value.schema as string)) throw new Error("Unsupported candidate schema");
  id(value.id, "candidate id"); id(value.project_id, "project id"); id(value.target_id, "target id");
  number(value.base_revision, "base revision", 1, LIMITS.revisions, true); digest(value.base_sha256); string(value.summary, "candidate summary", 500);
  const base_asset = validateAsset(value.base_asset), source = validateAsset(value.source), output = validateAsset(value.output);
  if (value.execution !== undefined) validateExecution(value.execution);
  const { width, height } = base_asset;
  if ([source, output].some((asset) => asset.width !== width || asset.height !== height)) throw new Error("Candidate must align with target raster dimensions");
  if (output.format !== "png" || output.sha256 !== output.render_sha256) throw new Error("Candidate output must be a canonical PNG");
  if (value.mode !== "replace" && value.mode !== "masked") throw new Error("Unsupported candidate mode");
  if (value.mode === "replace") {
    if (value.edit !== null || value.qa !== null) throw new Error("Replacement has no mask protection guarantee");
  } else {
    const edit = value.edit;
    record(edit, ["coordinate_space", "width", "height", "context", ...MASK_KEYS], "candidate edit");
    if (edit.coordinate_space !== "target-raster" || edit.width !== width || edit.height !== height) throw new Error("Unsupported mask coordinate space");
    validateContext(edit.context, width, height);
    for (const key of MASK_KEYS) validateMask(edit[key], width, height);
    const qa = value.qa;
    record(qa, ["color_space", "alpha_blend", ...QA_COUNTS], "composite QA");
    if (qa.color_space !== "srgb" || qa.alpha_blend !== "premultiplied") throw new Error("Unsupported composite QA profile");
    for (const key of QA_COUNTS) number(qa[key], key, 0, width * height, true);
    if (qa.protected_changed_pixels || qa.outside_blend_changed_pixels || !qa.changed_pixels) throw new Error("Candidate protection QA failed");
  }
  return value as unknown as Candidate;
}

async function boundBytes(root: string, binding: { file: string; sha256: string; render_file?: string; render_sha256?: string }, { rendered = false, limit }: { rendered?: boolean; limit?: number } = {}): Promise<Buffer> {
  const file = rendered ? binding.render_file ?? binding.file : binding.file;
  const expected = rendered ? binding.render_sha256 ?? binding.sha256 : binding.sha256;
  const bytes = await readBytes(path.join(root, file), limit ?? LIMITS.sourceBytes);
  if (sha256(bytes) !== expected) throw new Error(`Candidate binding digest mismatch: ${file}`);
  return bytes;
}

export async function readCandidateEntry(root: string, candidateId: string): Promise<CandidateEntry> {
  const directory = candidateDirectory(root, candidateId);
  const bytes = await readBytes(path.join(directory, "candidate.json"), 100_000);
  const candidate = validateCandidate(JSON.parse(bytes.toString("utf8")));
  if (candidate.id !== candidateId) throw new Error("Candidate identity mismatch");
  const { original: source, rendered } = await readAsset(root, candidate.source);
  const receipt = candidate.execution === undefined ? null : await readExecution(root, candidate.execution, candidate.source);
  const { original: output } = await readAsset(root, candidate.output);
  if (isRecord(receipt?.parameters) && receipt.parameters.background === "transparent") requireAlpha(await inspectAlpha(output));
  const entry: CandidateEntry = { directory, candidate, sha256: sha256(bytes), source, rendered, output, receipt };
  if (candidate.mode === "masked" && candidate.edit) {
    const { width, height } = candidate.edit;
    const masks = {} as Record<MaskKey, MaskData>;
    for (const key of MASK_KEYS) {
      const maskFile = await boundBytes(root, candidate.edit[key]);
      masks[key] = await maskBytes(maskFile, width, height, { protection: key === "protection_mask" });
    }
    entry.masks = masks;
  }
  return entry;
}

export async function verifyCandidateAgainst(root: string, project: ProjectState, entry: CandidateEntry): Promise<ImageObject> {
  const candidate = entry.candidate, doc = project.document;
  if (candidate.project_id !== doc.project_id || candidate.base_revision !== doc.revision || candidate.base_sha256 !== project.sha256) throw new Error("Candidate base revision conflict: re-read and restage explicitly");
  const object = doc.objects.find((item) => item.id === candidate.target_id);
  if (!object || object.kind !== "image") throw new Error("Candidate target must be an existing image object");
  const asset = doc.assets.find((item) => item.id === object.asset_id);
  if (JSON.stringify(asset) !== JSON.stringify(candidate.base_asset)) throw new Error("Candidate target asset binding changed");
  let expected: Buffer;
  if (candidate.mode === "replace" || !candidate.edit || !entry.masks) expected = entry.rendered;
  else {
    const original = await boundBytes(root, candidate.base_asset, { rendered: true, limit: LIMITS.renderBytes });
    const result = await compositeRaster(original, entry.rendered, { width: candidate.edit.width, height: candidate.edit.height, context: candidate.edit.context,
      generation: entry.masks.generation_mask.data, protection: entry.masks.protection_mask.data, blend: entry.masks.blend_mask.data });
    expected = result.png;
    if (JSON.stringify(result.qa) !== JSON.stringify(candidate.qa)) throw new Error("Candidate QA does not match recomputed composite");
  }
  if (sha256(expected) !== candidate.output.sha256 || !expected.equals(entry.output)) throw new Error("Candidate output differs from recomputed result");
  return object;
}

export async function readDiscard(entry: CandidateEntry): Promise<Decision | null> {
  const file = path.join(entry.directory, "discard.json");
  let bytes: Buffer;
  // 500 UTF-16 units may each need a six-byte JSON escape; fields and IDs fit
  // in the remaining space. Keep every accepted summary readable after writing.
  try { bytes = await readBytes(file, 4096); } catch (error) { if (errorCode(error) === "ENOENT") return null; throw error; }
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  record(value, ["candidate_id", "candidate_sha256", "author", "summary"], "discard");
  if (value.candidate_id !== entry.candidate.id || value.candidate_sha256 !== entry.sha256) throw new Error("Discard decision binding mismatch");
  validateDecision(value.author, value.summary);
  return value as unknown as Decision;
}

export async function decisionPending(entry: CandidateEntry): Promise<boolean> {
  try { await readBytes(path.join(entry.directory, ".decision-lock"), 2000); return true; }
  catch (error) { if (errorCode(error) === "ENOENT") return false; throw error; }
}

export async function withDecisionLock<T>(root: string, candidateId: string, run: () => Promise<T>): Promise<T> {
  const directory = await regularPath(candidateDirectory(root, candidateId), { directory: true });
  const file = path.join(directory, ".decision-lock");
  try { await fs.writeFile(file, candidateBytes({ pid: process.pid, created_at: new Date().toISOString() }), { flag: "wx" }); }
  catch (error) { if (errorCode(error) === "EEXIST") throw new Error("Candidate decision in progress; inspect before recovery"); throw error; }
  try { return await run(); } finally { await fs.unlink(file); }
}

export interface LockRelease { candidate_id: string; author: ChangeAuthor; summary: string; released_at: string; lock_sha256: string; lock: JsonRecord | null }

// Manual recovery for a lock left by a killed process. Decisions are re-derived
// from history/discard.json, so releasing the lock never fabricates an outcome.
export async function releaseDecisionLock(root: string, candidateId: string, author: unknown, summary: unknown): Promise<LockRelease> {
  validateDecision(author, summary);
  const directory = await regularPath(candidateDirectory(root, candidateId), { directory: true });
  const file = path.join(directory, ".decision-lock");
  let bytes: Buffer;
  try { bytes = await readBytes(file, 2000); } catch (error) { if (errorCode(error) === "ENOENT") throw new Error("No decision lock to release"); throw error; }
  let holder: JsonRecord | null = null;
  try { const parsed: unknown = JSON.parse(bytes.toString("utf8")); holder = isRecord(parsed) ? parsed : null; } catch { /* unreadable lock bodies are released without a holder check */ }
  const pid = holder?.pid;
  if (typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0) {
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { alive = errorCode(error) === "EPERM"; }
    if (alive) throw new Error("Decision lock holder process is still running");
  }
  const released: LockRelease = { candidate_id: candidateId, author, summary: summary as string, released_at: new Date().toISOString(), lock_sha256: sha256(bytes), lock: holder };
  await writeOnce(path.join(directory, `lock-release-${randomUUID()}.json`), { bytes: candidateBytes(released) });
  await fs.unlink(file);
  return released;
}

export async function publishCandidate(root: string, candidate: Candidate): Promise<{ directory: string; candidate: Candidate; sha256: string }> {
  validateCandidate(candidate);
  await assertCandidateSlot(root, candidate.id);
  await ensureDirectory(path.join(root, "candidates"));
  const directory = candidateDirectory(root, candidate.id);
  await fs.mkdir(directory);
  try {
    if ((await candidateIds(root)).length > 64) throw new Error("Candidate count limit exceeded");
    const bytes = candidateBytes(candidate);
    await writeOnce(path.join(directory, "candidate.json"), { bytes }, { expected: sha256(bytes), conflict: "Candidate already exists" });
    return { directory, candidate, sha256: sha256(bytes) };
  } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
}
