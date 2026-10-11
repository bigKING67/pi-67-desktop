import * as fs from "node:fs/promises";
import path from "node:path";
import { encodeJson, errorCode, sha256 } from "./content-store.js";
import { isRecord, LIMITS, type JsonRecord } from "./document.js";
import { readProject } from "./project.js";
import { readBytes } from "./raster.js";
import type { PreparedRequest } from "./provider-prepare.js";

// P5 generation cache (decided 2026-10-11): a request identical to one that already succeeded in
// this project reuses that job's output instead of paying for another, unless the caller asks
// for a fresh variation. Generation is not deterministic, so a hit is said in the receipt.

/**
 * The key over everything the Provider would receive and everything that shapes the staged
 * output: the image source (`source`, the Pi provider the request goes to), profile, surface,
 * endpoint and parameters (the model among them), the prompt, the bytes of every reference
 * and of the Provider mask, the output policy and the target's size. Ids, revisions and the
 * candidate are left out: they do not change the pixels asked for.
 */
export function generationCacheKey(prepared: PreparedRequest, source: string | undefined): string {
  const { job, request, asset } = prepared;
  return sha256(encodeJson({ v: 1, source: source ?? null, profile: job.provider_profile, surface: job.execution_surface,
    endpoint: request.endpoint, parameters: request.parameters, output_policy: request.output_policy, prompt_sha256: request.prompt_sha256,
    references: request.references.map((reference) => reference.sha256), provider_mask_sha256: request.provider_mask_sha256,
    target: { width: asset.width, height: asset.height } }));
}

/** A reusable output, and the evidence about those pixels its receipt holds (alpha, resampling, what was returned). */
export interface CachedOutput { jobId: string; receiptSha256: string; bytes: Buffer; evidence: JsonRecord }
const IMAGE_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u;
const EVIDENCE = ["returned_image", "output_normalization", "transparency"] as const;

interface JobEntry { jobId: string; candidateId: string | undefined; output: CachedOutput | undefined }

async function readJson(file: string, max: number): Promise<{ bytes: Buffer; value: unknown } | undefined> {
  try { const bytes = await readBytes(file, max); return { bytes, value: JSON.parse(bytes.toString("utf8")) as unknown }; }
  catch { return undefined; }
}

// One job of the key: the candidate it produced (if any) and, when it succeeded and staged, its verified output.
async function readEntry(root: string, jobId: string, key: string): Promise<JobEntry | undefined> {
  const directory = path.join(root, "jobs", jobId);
  // Every receipt of the key carries it, a partial one later recovered included.
  const receipt = await readJson(path.join(directory, "receipt.json"), 1_000_000);
  if (!receipt || !isRecord(receipt.value) || !isRecord(receipt.value.parameters) || receipt.value.parameters.cache_key !== key) return undefined;
  const result = (await readJson(path.join(directory, "result.json"), 100_000))?.value;
  const candidateId = isRecord(result) && typeof result.candidate_id === "string" && IMAGE_ID.test(result.candidate_id) ? result.candidate_id : undefined;
  if (receipt.value.outcome !== "succeeded" || !isRecord(result) || result.status !== "candidate") return { jobId, candidateId, output: undefined };
  const output = Array.isArray(receipt.value.outputs) ? receipt.value.outputs.at(-1) as unknown : undefined;
  if (!isRecord(output) || output.path !== `jobs/${jobId}/output.png`) return { jobId, candidateId, output: undefined };
  try {
    const bytes = await readBytes(path.join(root, output.path), LIMITS.sourceBytes);
    if (sha256(bytes) !== output.sha256 || bytes.length !== output.bytes) return { jobId, candidateId, output: undefined };
    const parameters = receipt.value.parameters;
    const evidence = Object.fromEntries(EVIDENCE.filter((name) => parameters[name] !== undefined).map((name) => [name, parameters[name]]));
    return { jobId, candidateId, output: { jobId, receiptSha256: sha256(receipt.bytes), bytes, evidence } };
  } catch { return { jobId, candidateId, output: undefined }; }
}

const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

/**
 * The newest job of this project with the same key that succeeded and staged, whose output is
 * still on disk and matches its receipt. Once the person decided on any result of the key —
 * accepted (those pixels are in the project) or discarded (they did not want them) — nothing
 * is reused: asking again means another one. Decisions are read now, not when the request was
 * prepared.
 */
export async function findCachedOutput(root: string, key: string): Promise<CachedOutput | undefined> {
  let names: string[];
  try { names = (await fs.readdir(path.join(root, "jobs"))).sort().reverse(); }
  catch (error) { if (errorCode(error) === "ENOENT") return undefined; throw error; }
  const entries = (await Promise.all(names.map((jobId) => readEntry(root, jobId, key)))).filter((entry) => entry !== undefined);
  if (!entries.length) return undefined;
  const accepted = (await readProject(root)).candidate_decisions;
  for (const { candidateId } of entries) {
    if (candidateId && (Object.hasOwn(accepted, candidateId) || await exists(path.join(root, "candidates", candidateId, "discard.json")))) return undefined;
  }
  return entries.find((entry) => entry.output)?.output;
}
