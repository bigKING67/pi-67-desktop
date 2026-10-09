import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ALPHA_ERRORS, inspectAlpha, requireAlpha, verifyAlpha, type AlphaEvidence } from "./provider-alpha.js";
import { encodeJson, errorCode, errorMessage, sha256, writeOnce } from "./content-store.js";
import { id, record, number, LIMITS, isRecord, type JsonRecord } from "./document.js";
import { readProject } from "./project.js";
import { readBytes } from "./raster.js";
import { ensureDirectory, assertCandidateSlot } from "./candidate-store.js";
import { stageCandidate, type StagedCandidate } from "./candidates.js";
import { profileAllowsModel } from "./provider-profiles.js";
import { normalizeImage, type OutputPolicy } from "./provider-normalize.js";
import { canonicalContracts, type ImageContracts } from "./contracts.js";
import { ImageGenerationError, numericUsage, type ImageGenerationCall, type ImageGenerator } from "./provider-generator.js";
import { prepareRequest, compileJob, MASK_KEYS, type PreparedRequest, type ProviderRequestRecord, type ProviderSpec } from "./provider-prepare.js";

export interface ReceiptOutput { asset_id: string; path: string; sha256: string; mime_type: string; bytes: number }
export interface ProviderReceipt extends JsonRecord {
  schema_version: "creative-craft.execution-receipt.v1"; receipt_id: string; job_id: string; job_sha256: string; provider_profile: string;
  execution_surface: string; model: string; snapshot: null; host: string; operator: string; started_at: string; completed_at: string;
  outcome: "succeeded" | "partial" | "failed" | "cancelled"; request_or_prompt_sha256: string; parameters: JsonRecord;
  provider_execution_id: string | null; outputs: ReceiptOutput[]; provider_errors: JsonRecord[]; moderation_result: null; limitations: string[];
}
export interface ProviderOptions {
  /** Routes the request through Pi; absent when no Pi image model is configured. */
  generator?: ImageGenerator | undefined; contracts?: ImageContracts | undefined; signal?: AbortSignal | undefined;
  timeoutMs?: number; dryRun?: boolean; operator?: string;
}
export class ProviderError extends Error {
  constructor(message: string, readonly receipt?: ProviderReceipt, readonly output?: string) { super(message); }
}

const HOST = "newmoney.image-engine";
const KNOWN_ERRORS = new Set(["preflight_revision_conflict", "provider_unavailable", "http_error", "response_size_limit", "invalid_image_response", "invalid_image_size", "output_dimensions_or_format_mismatch", ...ALPHA_ERRORS]);

export async function executeProvider(root: string, spec: unknown, options: ProviderOptions = {}): Promise<{ status: "candidate"; job: string; receipt: ProviderReceipt; candidate: StagedCandidate } | { status: "dry_run"; request: ProviderRequestRecord; network_requests: 0 }> {
  const { signal, timeoutMs = 180_000, dryRun = false, operator = "agent", generator } = options;
  const contracts = options.contracts ?? canonicalContracts;
  number(timeoutMs, "Provider timeout", 1, 300_000, true);
  const prepared = await prepareRequest(root, spec, contracts);
  if (dryRun) return { status: "dry_run", request: prepared.request, network_requests: 0 };
  signal?.throwIfAborted();
  if (!generator) throw new ProviderError("Image generation unavailable: no Pi image model is configured");
  const jobs = path.join(root, "jobs"); await ensureDirectory(jobs);
  const directory = path.join(jobs, prepared.job.job_id);
  await fs.mkdir(directory); // Exclusive durable claim: same job is never retried automatically.
  const save = (name: string, bytes: Buffer): Promise<boolean> => writeOnce(path.join(directory, name), { bytes });
  const started = new Date().toISOString();
  await save("job.json", prepared.jobBytes);
  await save("prompt-pack.md", Buffer.from(prepared.compiled.pack));
  await save("request.json", encodeJson(prepared.request));
  for (const ref of prepared.refs) await save(`reference-${ref.id}.png`, ref.bytes);
  if (prepared.providerMask && prepared.masks) {
    await save("provider-mask.png", prepared.providerMask);
    for (const key of MASK_KEYS) await save(`${key}.png`, prepared.masks[key].bytes);
  }
  await save("started.json", encodeJson({ started_at: started, status: "prepared", client_post_limit: 1 }));
  const call: ImageGenerationCall = { endpoint: prepared.request.endpoint, parameters: prepared.parameters, prompt: prepared.compiled.prompt,
    references: prepared.refs.map((ref) => ({ id: ref.id, bytes: ref.bytes })), mask: prepared.providerMask };
  const timeout = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const parameters: JsonRecord = { ...prepared.parameters, endpoint: prepared.request.endpoint, context: prepared.spec.edit?.context ?? null,
    client_post_attempts: 0, usage: null, billing: { state: "UNVERIFIED", actual_cost: null, currency: null } };
  const receipt: ProviderReceipt = { schema_version: "creative-craft.execution-receipt.v1", receipt_id: `receipt-${prepared.job.job_id}`,
    job_id: prepared.job.job_id, job_sha256: sha256(prepared.jobBytes), provider_profile: String(prepared.job.provider_profile),
    execution_surface: String(prepared.job.execution_surface), model: prepared.parameters.model, snapshot: null,
    host: HOST, operator, started_at: started, completed_at: started, outcome: "failed",
    request_or_prompt_sha256: sha256(encodeJson(prepared.request)), parameters, provider_execution_id: null, outputs: [], provider_errors: [], moderation_result: null,
    limitations: ["Requested alias does not verify the actual upstream snapshot.", "Gateway billing and internal retries are unverified.",
      "Provider masks guide generation; deterministic composition protects pixels.", "This receipt is execution evidence, not visual approval."] };
  const canvas = isRecord(prepared.job.canvas) ? prepared.job.canvas : {};
  let rejected: string | undefined;
  try {
    combined.throwIfAborted();
    // A price/human edit during preparation must not be charged against an old basis.
    if ((await readProject(root)).sha256 !== prepared.project.sha256) throw new Error("preflight_revision_conflict");
    parameters.client_post_attempts = 1;
    const outcome = await generator(call, combined);
    if (outcome.httpStatus !== undefined) parameters.http_status = outcome.httpStatus;
    parameters.usage = numericUsage(outcome.usage);
    if (outcome.requestId && /^[a-zA-Z0-9_-]{1,200}$/.test(outcome.requestId)) receipt.provider_execution_id = outcome.requestId;
    if (outcome.images.length !== 1) throw new Error("invalid_image_response");
    let output: Buffer = outcome.images[0] as Buffer;
    if (!output.length || output.length > LIMITS.sourceBytes) throw new Error("invalid_image_size");
    const { info } = await sharp(output, { limitInputPixels: LIMITS.pixels, failOn: "warning" }).raw().toBuffer({ resolveWithObject: true });
    const meta = await sharp(output).metadata();
    parameters.returned_image = { format: meta.format, width: info.width, height: info.height, depth: meta.depth, pages: meta.pages ?? 1 };
    // Preserve a decodable rejected result for offline diagnosis; do not charge
    // for regenerating a result that has already reached this client.
    if (["png", "jpeg", "webp"].includes(meta.format ?? "") && (meta.pages ?? 1) === 1) {
      const received = `received-output.${meta.format ?? "png"}`;
      await save(received, output);
      receipt.outputs = [{ asset_id: `received-${prepared.job.job_id}`, path: `jobs/${prepared.job.job_id}/${received}`, sha256: sha256(output), mime_type: `image/${meta.format ?? "png"}`, bytes: output.length }];
    }
    let transparency: { received: AlphaEvidence; output?: AlphaEvidence } | undefined;
    if (canvas.background === "transparent") {
      transparency = { received: await inspectAlpha(output) };
      parameters.transparency = transparency;
      requireAlpha(transparency.received);
    }
    const normalized = await normalizeImage(output, prepared.asset.width, prepared.asset.height, prepared.request.output_policy);
    output = normalized.bytes; parameters.output_normalization = normalized.normalization;
    if (transparency) {
      transparency.output = normalized.normalization ? await inspectAlpha(output) : transparency.received;
      requireAlpha(transparency.output);
    }
    // The paid body is already local; a late timeout/cancel must not discard it.
    await save("output.png", output);
    const finalOutput: ReceiptOutput = { asset_id: `generated-${prepared.job.job_id}`, path: `jobs/${prepared.job.job_id}/output.png`, sha256: sha256(output), mime_type: "image/png", bytes: output.length };
    receipt.outputs = normalized.normalization ? [...receipt.outputs, finalOutput] : [finalOutput];
    receipt.outcome = "succeeded";
  } catch (error) {
    receipt.outcome = receipt.outputs.length ? "partial" : signal?.aborted ? "cancelled" : "failed";
    if (error instanceof ImageGenerationError) {
      if (error.httpStatus !== undefined) parameters.http_status = error.httpStatus;
      rejected = error.rejectedParameter;
      if (!error.sent) parameters.client_post_attempts = 0;
    }
    const message = errorMessage(error);
    // A specific local verdict outranks an abort that fired while it was being computed.
    receipt.provider_errors = [{ code: KNOWN_ERRORS.has(message) ? message : timeout.aborted ? "timeout" : signal?.aborted ? "cancelled" : "transport_or_response_error",
      upstream_execution_unknown: parameters.client_post_attempts === 1 && !receipt.outputs.length }];
  }
  if (parameters.client_post_attempts === 0) {
    // Nothing left this client: release the claim so the job can run after re-reading the project.
    await fs.rm(directory, { recursive: true, force: true });
    throw new ProviderError(`No Provider request sent (${String(receipt.provider_errors[0]?.code)}); job claim released`);
  }
  receipt.completed_at = new Date().toISOString();
  const receiptBytes = encodeJson(receipt);
  if (!contracts.validateReceipt(receipt).valid) {
    // Never lose evidence of a POST; provider recovery promotes it after inspection.
    await save("receipt.unvalidated.json", receiptBytes);
    throw new ProviderError("Provider receipt validation failed; unvalidated receipt and any received output retained. Use provider recovery; do not repeat generation.", receipt, directory);
  }
  await save("receipt.json", receiptBytes);
  if (receipt.outcome !== "succeeded") {
    const hint = rejected ? ` The image service rejected the request parameter \`${rejected}\`; change it before trying again.` : "";
    throw new ProviderError(`Provider execution failed or cancelled; see bound receipt. No automatic retry.${hint}`, receipt, directory);
  }
  const candidate = await publishProviderCandidate(root, directory, { candidateId: prepared.spec.candidate_id, request: prepared.request, receipt, receiptBytes,
    receiptFile: "receipt.json", job: prepared.job, jobBytes: prepared.jobBytes });
  return { status: "candidate", job: directory, receipt, candidate };
}

interface PublishInput {
  candidateId: string; request: ProviderRequestRecord; receipt: ProviderReceipt; receiptBytes: Buffer; receiptFile: string;
  job: PreparedRequest["job"]; jobBytes: Buffer; recovered?: boolean;
}

// Provider success and candidate publication are separate outcomes. Staging is
// local and is not cancelled: a paid output should not end as candidate_failed.
async function publishProviderCandidate(root: string, directory: string, input: PublishInput): Promise<StagedCandidate> {
  const { candidateId, request, receipt, receiptBytes, receiptFile, job, jobBytes, recovered = false } = input;
  const execution = { job_id: job.job_id, job_sha256: sha256(jobBytes), receipt_file: `jobs/${job.job_id}/${receiptFile}`, receipt_sha256: sha256(receiptBytes) };
  const stage: JsonRecord = { id: candidateId, base_revision: request.base_revision, target_id: request.target_id, source: path.join(directory, "output.png"),
    mode: request.provider_mask_sha256 ? "masked" : "replace", summary: String(job.intended_use).slice(0, 500), execution };
  if (request.provider_mask_sha256) stage.edit = { context: receipt.parameters.context, ...Object.fromEntries(MASK_KEYS.map((key) => [key, path.join(directory, `${key}.png`)])) };
  const flag = recovered ? { recovered: true } : {};
  const result = (value: JsonRecord): Promise<boolean> => writeOnce(path.join(directory, "result.json"), { bytes: encodeJson(value) });
  try {
    const candidate = await stageCandidate(root, stage);
    await result({ status: "candidate", ...flag, candidate_id: candidateId, candidate_sha256: candidate.sha256, candidate_status: candidate.status });
    return candidate;
  } catch (cause) {
    await result({ status: "candidate_failed", ...flag, provider_outcome: "succeeded",
      reason_code: ALPHA_ERRORS.includes(errorMessage(cause)) ? errorMessage(cause) : "candidate_validation_failed" });
    throw new ProviderError(`Provider ${recovered ? "output recovered" : "succeeded"}; candidate staging failed. Output retained; do not repeat generation.`, receipt, directory);
  }
}

// Promote a receipt kept only because validation failed after the POST.
async function boundReceipt(directory: string, contracts: ImageContracts): Promise<Buffer> {
  const file = path.join(directory, "receipt.json");
  try { return await readBytes(file, 1_000_000); } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
  const bytes = await readBytes(path.join(directory, "receipt.unvalidated.json"), 1_000_000);
  const verdict = contracts.validateReceipt(JSON.parse(bytes.toString("utf8")));
  if (!verdict.valid) throw new Error(`Canonical contract validation failed: ${verdict.errors.slice(0, 5).join("; ")}`);
  await writeOnce(file, { bytes });
  return bytes;
}

export async function recoverProvider(root: string, input: unknown, options: { contracts?: ImageContracts } = {}): Promise<{ status: "recovered_candidate"; network_requests: 0; receipt: ProviderReceipt; candidate: StagedCandidate }> {
  const contracts = options.contracts ?? canonicalContracts;
  record(input, ["job_id", "candidate_id", "output_policy"], "Provider recovery");
  id(input.job_id, "job id"); id(input.candidate_id, "candidate id");
  const jobId = input.job_id, candidateId = input.candidate_id;
  await assertCandidateSlot(root, candidateId);
  const directory = path.join(root, "jobs", jobId);
  const oldBytes = await boundReceipt(directory, contracts), old = JSON.parse(oldBytes.toString("utf8")) as ProviderReceipt;
  if (!contracts.validateReceipt(old).valid) throw new Error("Canonical contract validation failed: recovery receipt");
  const jobBytes = await readBytes(path.join(directory, "job.json"), 1_000_000), job = JSON.parse(jobBytes.toString("utf8")) as PreparedRequest["job"];
  compileJob(contracts, job);
  const requestBytes = await readBytes(path.join(directory, "request.json"), 1_000_000), request = JSON.parse(requestBytes.toString("utf8")) as ProviderRequestRecord;
  if (old.job_sha256 !== sha256(jobBytes) || old.job_id !== jobId || job.job_id !== jobId ||
      old.request_or_prompt_sha256 !== sha256(requestBytes) || !profileAllowsModel(job.provider_profile, old.model) || old.model !== request.parameters.model ||
      old.provider_profile !== job.provider_profile || old.execution_surface !== job.execution_surface) throw new Error("Recovery receipt binding mismatch");
  if (old.outcome === "succeeded") {
    // A complete output whose receipt was only just promoted (or whose publication was interrupted).
    try { await fs.lstat(path.join(directory, "result.json")); throw new Error("Provider job already recorded a result"); }
    catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
    const candidate = await publishProviderCandidate(root, directory, { candidateId, request, receipt: old, receiptBytes: oldBytes, receiptFile: "receipt.json", job, jobBytes, recovered: true });
    return { status: "recovered_candidate", network_requests: 0, receipt: old, candidate };
  }
  if (input.output_policy !== "resize_to_target") throw new Error("Recovery requires explicit resize_to_target policy");
  if (old.outcome !== "partial" || old.outputs.length !== 1 || old.provider_errors[0]?.code !== "output_dimensions_or_format_mismatch") throw new Error("Recovery requires a bound partial size-mismatch receipt");
  const received = old.outputs[0] as ReceiptOutput;
  if (received.path !== `jobs/${jobId}/received-output.png` || received.mime_type !== "image/png") throw new Error("Recovery supports retained PNG only");
  const bytes = await readBytes(path.join(root, received.path), LIMITS.sourceBytes);
  if (sha256(bytes) !== received.sha256 || bytes.length !== received.bytes) throw new Error("Retained output digest mismatch");
  const transparentJob = isRecord(job.canvas) && job.canvas.background === "transparent";
  const oldTransparency = isRecord(old.parameters.transparency) ? old.parameters.transparency : {};
  if (transparentJob) {
    if (old.parameters.background !== "transparent" || request.parameters.background !== "transparent") throw new Error("Transparency request binding mismatch");
    await verifyAlpha(bytes, oldTransparency.received);
  }
  const project = await readProject(root, { revision: request.base_revision });
  if (project.sha256 !== request.base_sha256 || project.document.project_id !== request.project_id) throw new Error("Recovery project basis mismatch");
  const object = project.document.objects.find((item) => item.id === request.target_id);
  const asset = object?.kind === "image" ? project.document.assets.find((item) => item.id === object.asset_id) : undefined;
  if (!asset || object?.locked) throw new Error("Invalid recovery target");
  const normalized = await normalizeImage(bytes, asset.width, asset.height, input.output_policy as OutputPolicy);
  if (!normalized.normalization) throw new Error("Recovery requires actual dimension normalization");
  const alpha = transparentJob ? requireAlpha(await inspectAlpha(normalized.bytes)) : null;
  await fs.writeFile(path.join(directory, "normalization-started.json"), encodeJson({ source_receipt_sha256: sha256(oldBytes), policy: input.output_policy }), { flag: "wx" });
  await writeOnce(path.join(directory, "output.png"), { bytes: normalized.bytes }, { expected: sha256(normalized.bytes) });
  const receipt = structuredClone(old); receipt.receipt_id += "-normalized"; receipt.completed_at = new Date().toISOString(); receipt.outcome = "succeeded"; receipt.provider_errors = [];
  receipt.parameters.output_normalization = normalized.normalization; receipt.parameters.source_receipt_sha256 = sha256(oldBytes); receipt.parameters.recovery_client_post_attempts = 0;
  if (alpha && isRecord(receipt.parameters.transparency)) receipt.parameters.transparency.output = alpha;
  receipt.outputs.push({ asset_id: `normalized-${jobId}`, path: `jobs/${jobId}/output.png`, sha256: sha256(normalized.bytes), mime_type: "image/png", bytes: normalized.bytes.length });
  receipt.limitations.push("Original Provider size mismatch remains recorded; output was explicitly resampled offline, without another request.");
  if (!contracts.validateReceipt(receipt).valid) throw new Error("Canonical contract validation failed: normalized receipt");
  const receiptBytes = encodeJson(receipt); await writeOnce(path.join(directory, "normalized-receipt.json"), { bytes: receiptBytes });
  const candidate = await publishProviderCandidate(root, directory, { candidateId, request, receipt, receiptBytes, receiptFile: "normalized-receipt.json", job, jobBytes, recovered: true });
  return { status: "recovered_candidate", network_requests: 0, receipt, candidate };
}

export type { ProviderSpec, ProviderRequestRecord };
