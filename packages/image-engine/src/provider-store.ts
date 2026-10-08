import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sha256 } from "./content-store.js";
import { record, id, digest, LIMITS, isRecord, type Asset, type JsonRecord } from "./document.js";
import { readBytes } from "./raster.js";
import { normalizeImage } from "./provider-normalize.js";
import { verifyAlpha } from "./provider-alpha.js";

export interface ExecutionBinding { job_id: string; job_sha256: string; receipt_file: string; receipt_sha256: string }

// Single source of truth: the Provider profiles that enable the image adapter.
// `providers/` sits beside both `src/` and `dist/`.
const providersUrl = new URL("../providers/", import.meta.url);
const profiles = readdirSync(providersUrl, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => JSON.parse(readFileSync(new URL(entry.name, providersUrl), "utf8")) as JsonRecord);
export const PROFILE_MODELS: ReadonlyMap<string, string> = new Map(profiles
  .filter((profile) => isRecord(profile.availability) && profile.availability.network_adapter_in_optional_module === true)
  .map((profile) => [String(profile.profile_id), String(profile.model)] as const)
  .sort(([a], [b]) => a.localeCompare(b)));
export const IMAGE_MODELS: readonly string[] = [...new Set(PROFILE_MODELS.values())];

export function validateExecution(binding: unknown): asserts binding is ExecutionBinding {
  record(binding, ["job_id", "job_sha256", "receipt_file", "receipt_sha256"], "execution binding");
  id(binding.job_id, "job id"); digest(binding.job_sha256); digest(binding.receipt_sha256);
  if (![`jobs/${binding.job_id}/receipt.json`, `jobs/${binding.job_id}/normalized-receipt.json`].includes(binding.receipt_file as string)) throw new Error("Invalid execution receipt path");
}

interface ReceiptOutput { path: string; sha256: string; mime_type: string; bytes: number }
export interface ExecutionReceipt extends JsonRecord {
  outcome: string; model: string; provider_profile: string; execution_surface: string; job_id: string; job_sha256: string; schema_version: string;
  outputs: ReceiptOutput[]; parameters: JsonRecord;
}

export async function readExecution(root: string, binding: unknown, source: Asset): Promise<ExecutionReceipt> {
  validateExecution(binding);
  const jobBytes = await readBytes(path.join(root, "jobs", binding.job_id, "job.json"), 1_000_000);
  const receiptBytes = await readBytes(path.join(root, binding.receipt_file), 1_000_000);
  if (sha256(jobBytes) !== binding.job_sha256 || sha256(receiptBytes) !== binding.receipt_sha256) throw new Error("Execution binding digest mismatch");
  const job = JSON.parse(jobBytes.toString("utf8")) as JsonRecord, receipt = JSON.parse(receiptBytes.toString("utf8")) as ExecutionReceipt;
  const canvas = isRecord(job.canvas) ? job.canvas : {};
  if (job.schema_version !== "creative-craft.image-job.v2" || job.job_id !== binding.job_id || receipt.job_id !== job.job_id || receipt.job_sha256 !== binding.job_sha256 ||
      receipt.schema_version !== "creative-craft.execution-receipt.v1" || receipt.outcome !== "succeeded" ||
      receipt.provider_profile !== job.provider_profile || receipt.execution_surface !== job.execution_surface ||
      !IMAGE_MODELS.includes(receipt.model) || PROFILE_MODELS.get(String(job.provider_profile)) !== receipt.model ||
      !Array.isArray(receipt.outputs) || ![1, 2].includes(receipt.outputs.length)) throw new Error("Execution receipt does not bind a successful image job");
  const jobId = String(job.job_id);
  const output = receipt.outputs.find((item) => item.path === `jobs/${jobId}/output.png`);
  if (!output) throw new Error("Missing final Provider output");
  if (output.sha256 !== source.sha256 || output.mime_type !== "image/png") throw new Error("Candidate source differs from Provider output");
  const bytes = await readBytes(path.join(root, output.path), LIMITS.renderBytes);
  if (bytes.length !== output.bytes || sha256(bytes) !== output.sha256) throw new Error("Provider output digest mismatch");
  const parameters = receipt.parameters;
  const transparency = isRecord(parameters.transparency) ? parameters.transparency : {};
  const transparent = canvas.background === "transparent";
  if (transparent) {
    if (parameters.background !== "transparent") throw new Error("Transparency request binding mismatch");
    await verifyAlpha(bytes, transparency.output);
    if (!parameters.output_normalization) await verifyAlpha(bytes, transparency.received);
  }
  if (isRecord(parameters.output_normalization)) {
    const original = receipt.outputs.find((item) => item.path === `jobs/${jobId}/received-output.png`);
    if (!original) throw new Error("Missing original normalization source");
    const raw = await readBytes(path.join(root, original.path), LIMITS.sourceBytes);
    const n = parameters.output_normalization;
    if (sha256(raw) !== original.sha256 || raw.length !== original.bytes || n.source_sha256 !== original.sha256 || n.output_sha256 !== output.sha256) throw new Error("Normalization source binding mismatch");
    if (transparent) await verifyAlpha(raw, transparency.received);
    const recomputed = await normalizeImage(raw, source.width, source.height, "resize_to_target");
    if (!recomputed.bytes.equals(bytes) || JSON.stringify(recomputed.normalization) !== JSON.stringify(n)) throw new Error("Normalization differs from recomputed result");
  }
  if (binding.receipt_file.endsWith("/normalized-receipt.json")) {
    const oldBytes = await readBytes(path.join(root, "jobs", binding.job_id, "receipt.json"), 1_000_000);
    if (sha256(oldBytes) !== parameters.source_receipt_sha256) throw new Error("Recovery source receipt digest mismatch");
  }
  return receipt;
}
