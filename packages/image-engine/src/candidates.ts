import path from "node:path";
import sharp from "sharp";
import { errorCode, errorMessage, sha256, writeOnce } from "./content-store.js";
import { LIMITS, record, id, string, isLocked, isRecord, type Asset } from "./document.js";
import { readProject, editBatch, type ProjectState, type PublishedRevision } from "./project.js";
import { importRaster, saveAsset, regularPath, readAsset } from "./raster.js";
import { importMask, compositeRaster, validateContext, type CompositeQa, type MaskData } from "./composite.js";
import { readExecution, type ExecutionBinding, type ExecutionReceipt } from "./provider-store.js";
import { inspectAlpha, requireAlpha } from "./provider-alpha.js";
import {
  CANDIDATE_SCHEMA, MASK_KEYS, candidateBytes, ensureDirectory, assertCandidateSlot, publishCandidate, readCandidateEntry, verifyCandidateAgainst,
  readDiscard, decisionPending, withDecisionLock, candidateIds, releaseDecisionLock, validateDecision,
  type Candidate, type CandidateEdit, type CandidateEntry, type Decision, type LockRelease, type MaskKey
} from "./candidate-store.js";

export type CandidateStatus = "ready" | "stale" | "accepted" | "discarded" | "decision_pending";
export interface CandidateInspection {
  candidate: Candidate; sha256: string; status: CandidateStatus; current_revision: number; accepted_revision: number | null;
  applied_in_current: boolean; stale: boolean; decision_pending: boolean;
  /** The verified execution receipt of a generated candidate; null for local composites. */
  receipt: ExecutionReceipt | null;
}
export interface CandidateListFailure { candidate_id: string; status: "incomplete" | "unreadable"; error: string }
export interface StagedCandidate { candidate: Candidate; sha256: string; status: "ready" | "stale"; current_revision: number }

// Re-encoding alone is not a change. Hidden RGB under alpha=0 still counts:
// resampling can bleed it into visible pixels (see the alpha acceptance probe).
async function sameDecodedPixels(a: Buffer, b: Buffer): Promise<boolean> {
  const [x, y] = await Promise.all([a, b].map((png) => sharp(png).ensureAlpha().raw().toBuffer()));
  return x !== undefined && y !== undefined && x.equals(y);
}

export async function stageCandidate(root: string, input: unknown, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<StagedCandidate> {
  record(input, ["id", "base_revision", "target_id", "source", "mode", "summary", "edit", "execution"], "candidate input");
  id(input.id, "candidate id"); id(input.target_id, "target id"); string(input.summary, "candidate summary", 500);
  const mode = input.mode;
  if (mode !== "replace" && mode !== "masked") throw new Error("Unsupported candidate mode");
  if (input.base_revision === undefined) throw new Error("Candidate needs an explicit base revision");
  signal?.throwIfAborted();
  const project = await readProject(root, { revision: input.base_revision as number });
  await assertCandidateSlot(root, input.id);
  const object = project.document.objects.find((item) => item.id === input.target_id);
  if (!object || object.kind !== "image") throw new Error("Candidate target must be an existing image object");
  if (isLocked(project.document, object)) throw new Error(`Object is locked: ${object.id}`);
  const asset = project.document.assets.find((item) => item.id === object.asset_id) as Asset;
  const source = await importRaster({ id: "candidate-source", source: input.source });
  const receipt = input.execution === undefined ? null : await readExecution(root, input.execution, source.asset);
  if (source.asset.width !== asset.width || source.asset.height !== asset.height) throw new Error("Candidate must align with target raster dimensions; resize explicitly before staging");
  let edit: CandidateEdit | null = null, qa: CompositeQa | null = null, png = source.rendered;
  const masks: ({ key: MaskKey } & MaskData)[] = [];
  if (mode === "masked") {
    record(input.edit, ["context", ...MASK_KEYS], "edit input");
    validateContext(input.edit.context, asset.width, asset.height);
    const bindings = {} as CandidateEdit;
    for (const key of MASK_KEYS) {
      const mask = await importMask(input.edit[key] as string, asset.width, asset.height, { protection: key === "protection_mask" });
      bindings[key] = { file: `masks/${mask.sha256}.png`, sha256: mask.sha256, width: mask.width, height: mask.height };
      masks.push({ key, ...mask });
    }
    edit = { ...bindings, coordinate_space: "target-raster", width: asset.width, height: asset.height, context: structuredClone(input.edit.context) };
    const original = (await readAsset(root, asset)).rendered;
    const byKey = (key: MaskKey): Buffer => masks.find((mask) => mask.key === key)?.data ?? Buffer.alloc(0);
    const result = await compositeRaster(original, source.rendered, { width: asset.width, height: asset.height, context: edit.context,
      generation: byKey("generation_mask"), protection: byKey("protection_mask"), blend: byKey("blend_mask") }, { signal });
    png = result.png; qa = result.qa;
  } else {
    if (input.edit !== undefined) throw new Error("Replacement input must not carry mask metadata");
    if (sha256(png) === asset.render_sha256 || await sameDecodedPixels(png, (await readAsset(root, asset)).rendered)) throw new Error("Candidate makes no raster change");
  }
  if (isRecord(receipt?.parameters) && receipt.parameters.background === "transparent") requireAlpha(await inspectAlpha(png));
  if (png.length > LIMITS.renderBytes) throw new Error("Candidate output byte limit exceeded");
  signal?.throwIfAborted();
  const hash = sha256(png);
  const output: Asset = { id: `image-${hash.slice(0, 32)}`, file: `assets/${hash}.png`, sha256: hash, format: "png", width: asset.width, height: asset.height, render_file: `assets/${hash}.png`, render_sha256: hash };
  const candidate: Candidate = { schema: CANDIDATE_SCHEMA, id: input.id, project_id: project.document.project_id, base_revision: project.document.revision,
    base_sha256: project.sha256, target_id: object.id, base_asset: asset, mode, summary: input.summary,
    source: source.asset, output, edit, qa };
  if (input.execution !== undefined) candidate.execution = structuredClone(input.execution) as ExecutionBinding;
  await regularPath(path.join(root, "assets"), { directory: true });
  await saveAsset(root, source);
  await saveAsset(root, { asset: output, original: png, rendered: png });
  if (masks.length && edit) {
    await ensureDirectory(path.join(root, "masks"));
    for (const mask of masks) await writeOnce(path.join(root, edit[mask.key].file), { bytes: mask.bytes }, { expected: mask.sha256 });
  }
  signal?.throwIfAborted();
  const result = await publishCandidate(root, candidate);
  const current = await readProject(root);
  return { candidate, sha256: result.sha256, status: current.sha256 === candidate.base_sha256 ? "ready" : "stale", current_revision: current.document.revision };
}

function accepted(entry: CandidateEntry, project: ProjectState): { sha256: string; revision: number } | undefined {
  const decision = Object.hasOwn(project.candidate_decisions, entry.candidate.id) ? project.candidate_decisions[entry.candidate.id] : undefined;
  if (decision && decision.sha256 !== entry.sha256) throw new Error("Accepted candidate digest mismatch");
  return decision;
}

export async function inspectCandidate(root: string, candidateId: string): Promise<CandidateInspection> {
  const current = await readProject(root);
  const entry = await readCandidateEntry(root, candidateId);
  const base = entry.candidate.base_revision === current.document.revision ? current : await readProject(root, { revision: entry.candidate.base_revision });
  await verifyCandidateAgainst(root, base, entry);
  const decision = accepted(entry, current), discarded = await readDiscard(entry), pending = await decisionPending(entry);
  if (decision && discarded) throw new Error("Inconsistent candidate decisions");
  const stale = current.sha256 !== entry.candidate.base_sha256;
  const status: CandidateStatus = decision ? "accepted" : discarded ? "discarded" : pending ? "decision_pending" : stale ? "stale" : "ready";
  const object = current.document.objects.find((item) => item.id === entry.candidate.target_id);
  return { candidate: entry.candidate, sha256: entry.sha256, status, current_revision: current.document.revision, accepted_revision: decision?.revision ?? null,
    applied_in_current: !!decision && object?.kind === "image" && object.asset_id === entry.candidate.output.id, stale, decision_pending: pending, receipt: entry.receipt };
}

export async function listCandidates(root: string): Promise<(CandidateInspection | CandidateListFailure)[]> {
  await readProject(root);
  const ids = await candidateIds(root);
  if (ids.length > 64) throw new Error("Candidate count limit exceeded");
  const results: (CandidateInspection | CandidateListFailure)[] = [];
  // One damaged entry is reported in place; candidate-read/accept stay strict.
  for (const candidateId of ids) {
    try { results.push(await inspectCandidate(root, candidateId)); }
    catch (error) {
      const missingPath = typeof error === "object" && error !== null && "path" in error && typeof error.path === "string" ? error.path : "";
      const incomplete = errorCode(error) === "ENOENT" && path.basename(missingPath) === "candidate.json";
      results.push({ candidate_id: candidateId, status: incomplete ? "incomplete" : "unreadable",
        error: incomplete ? "candidate.json missing (interrupted staging); inspect and remove the directory to reuse this ID" : errorMessage(error) });
    }
  }
  return results;
}

export async function unlockCandidate(root: string, input: unknown): Promise<{ status: "unlocked"; candidate: CandidateInspection } & LockRelease> {
  record(input, ["candidate_id", "author", "summary"], "unlock input");
  await readProject(root);
  const released = await releaseDecisionLock(root, input.candidate_id as string, input.author, input.summary);
  return { status: "unlocked", ...released, candidate: await inspectCandidate(root, input.candidate_id as string) };
}

export async function discardCandidate(root: string, input: unknown): Promise<{ status: "discarded"; project_revision: number } & Decision> {
  record(input, ["candidate_id", "author", "summary"], "discard input");
  const candidateId = input.candidate_id as string;
  return withDecisionLock(root, candidateId, async () => {
    const project = await readProject(root), entry = await readCandidateEntry(root, candidateId);
    if (entry.candidate.project_id !== project.document.project_id) throw new Error("Candidate project identity mismatch");
    if (accepted(entry, project)) throw new Error("Candidate already accepted");
    if (await readDiscard(entry)) throw new Error("Candidate already discarded");
    validateDecision(input.author, input.summary);
    const decision: Decision = { candidate_id: candidateId, candidate_sha256: entry.sha256, author: input.author, summary: input.summary as string };
    await writeOnce(path.join(entry.directory, "discard.json"), { bytes: candidateBytes(decision) }, { conflict: "Candidate already discarded" });
    return { status: "discarded", ...decision, project_revision: project.document.revision };
  });
}

export async function acceptCandidate(root: string, input: unknown, options?: { dryRun?: boolean }): Promise<PublishedRevision> {
  record(input, ["candidate_id", "base_revision", "author", "summary"], "accept input");
  return editBatch(root, { base_revision: input.base_revision, author: input.author, summary: input.summary,
    operations: [{ type: "accept_candidate", candidate_id: input.candidate_id }] }, options);
}
