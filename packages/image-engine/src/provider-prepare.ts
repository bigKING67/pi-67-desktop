import sharp from "sharp";
import { sha256 } from "./content-store.js";
import { id, record, LIMITS, isRecord, type Asset, type JsonRecord } from "./document.js";
import { readProject, type ProjectState } from "./project.js";
import { readBytes, importRaster } from "./raster.js";
import { assertCandidateSlot } from "./candidate-store.js";
import { maskBytes, validateContext, type EditContext, type MaskData } from "./composite.js";
import { resolveProfileModel } from "./provider-profiles.js";
import type { ImageContracts } from "./contracts.js";
import type { OutputPolicy } from "./provider-normalize.js";

const ADAPTER_SURFACES = new Set(["openai.image_api", "volcengine.ark_image_api"]);
export const MASK_KEYS = ["generation_mask", "protection_mask", "blend_mask"] as const;
type MaskKey = typeof MASK_KEYS[number];

export interface ProviderSpec {
  job: string; candidate_id: string; base_revision: number; target_id: string;
  references: { asset_id: string; source: string }[];
  edit?: { context: EditContext } & Record<MaskKey, string>;
  output_policy?: OutputPolicy;
  /** The image source's model id; required by a generic profile, otherwise equal to the profile's model. */
  model?: string;
}
export interface ProviderRequestRecord {
  endpoint: "images/edits" | "images/generations"; parameters: RequestParameters; output_policy: OutputPolicy; prompt_sha256: string;
  references: { asset_id: string; sha256: string }[]; provider_mask_sha256: string | null; project_id: string;
  base_revision: number; base_sha256: string; target_id: string; candidate_id: string;
}
export interface RequestParameters { model: string; size: string; quality: string; background: string; output_format: "png"; n: 1 }
export interface PreparedRequest {
  job: JsonRecord & { job_id: string }; jobBytes: Buffer; compiled: { pack: string; prompt: string };
  refs: { id: string; bytes: Buffer; sha256: string }[]; masks: Record<MaskKey, MaskData> | undefined; providerMask: Buffer | undefined;
  parameters: RequestParameters; request: ProviderRequestRecord; project: ProjectState; asset: Asset; spec: ProviderSpec;
}

// Validates, compiles and binds a run before any credential is read or byte is sent.
export function compileJob(contracts: ImageContracts, job: unknown): { pack: string; prompt: string } {
  const verdict = contracts.validateJob(job);
  if (!verdict.valid) throw new Error(`Canonical contract validation failed: ${verdict.errors.slice(0, 5).join("; ")}`);
  return contracts.compileJob(job as JsonRecord);
}

export async function prepareRequest(root: string, value: unknown, contracts: ImageContracts): Promise<PreparedRequest> {
  record(value, ["job", "candidate_id", "base_revision", "target_id", "references", "edit", "output_policy", "model"], "Provider input");
  if (value.output_policy !== undefined && !["strict", "resize_to_target"].includes(value.output_policy as string)) throw new Error("Unsupported output policy");
  id(value.candidate_id, "candidate id"); id(value.target_id, "target id");
  const spec = value as unknown as ProviderSpec;
  const jobBytes = await readBytes(spec.job, 1_000_000);
  const job = JSON.parse(jobBytes.toString("utf8")) as JsonRecord;
  id(job.job_id, "job id");
  const compiled = compileJob(contracts, job);
  const canvas = isRecord(job.canvas) ? job.canvas : {};
  // Contracts already bind the surface to the profile; a generic profile takes the source's model.
  const model = resolveProfileModel(job.provider_profile, spec.model);
  if (!model) throw new Error("Provider model does not match the job's provider profile");
  if (job.schema_version !== "creative-craft.image-job.v2" || !ADAPTER_SURFACES.has(String(job.execution_surface)) ||
      job.execution_mode !== "single_turn" || job.declared_status !== "ready" || canvas.format !== "png" || canvas.variants !== 1) throw new Error("Adapter requires a ready single-turn image job with one PNG output");
  if (isRecord(job.rights) && job.rights.status === "REJECTED") throw new Error("Rejected asset rights");
  const project = await readProject(root);
  if (project.document.revision !== spec.base_revision) throw new Error("Provider base revision conflict");
  await assertCandidateSlot(root, spec.candidate_id);
  const object = project.document.objects.find((item) => item.id === spec.target_id);
  if (!object || object.kind !== "image" || object.locked) throw new Error("Provider target must be an unlocked image object");
  const asset = project.document.assets.find((item) => item.id === object.asset_id) as Asset;
  const size = `${asset.width}x${asset.height}`;
  if (canvas.size !== size) throw new Error("Job output size must explicitly match target raster");
  const assetRefs = Array.isArray(job.asset_refs) ? job.asset_refs : [];
  if (!Array.isArray(spec.references) || spec.references.length > 3 || spec.references.length !== assetRefs.length) throw new Error("Reference inputs must match job asset refs (maximum 3)");
  if (new Set(spec.references.map((ref) => ref.asset_id)).size !== spec.references.length) throw new Error("Duplicate reference IDs");
  const refs: PreparedRequest["refs"] = [];
  for (const [index, ref] of spec.references.entries()) {
    record(ref, ["asset_id", "source"], "Provider reference"); id(ref.asset_id, "reference id");
    if (ref.asset_id !== assetRefs[index]) throw new Error("Reference order differs from job");
    const image = await importRaster({ id: ref.asset_id, source: ref.source });
    refs.push({ id: ref.asset_id, bytes: image.rendered, sha256: image.asset.render_sha256 });
  }
  if (job.task_type === "generate" && (refs.length || spec.edit !== undefined)) throw new Error("Generation requires no image refs or masks; use edit for referenced creation");
  if (job.task_type === "edit" && (!refs.length || refs[0]?.id !== asset.id || refs[0].sha256 !== asset.render_sha256)) throw new Error("First edit reference must be the current target raster");
  let masks: Record<MaskKey, MaskData> | undefined, providerMask: Buffer | undefined;
  if (spec.edit !== undefined) {
    if (job.task_type !== "edit") throw new Error("Masks require edit mode");
    record(spec.edit, ["context", ...MASK_KEYS], "Provider edit");
    validateContext(spec.edit.context, asset.width, asset.height);
    const c = spec.edit.context;
    if (c.x !== 0 || c.y !== 0 || c.width !== asset.width || c.height !== asset.height) throw new Error("This Adapter sends full-raster context; cropped context is unsupported");
    const loaded = {} as Record<MaskKey, MaskData>;
    for (const key of MASK_KEYS) loaded[key] = await maskBytes(await readBytes(spec.edit[key], LIMITS.sourceBytes), asset.width, asset.height, { protection: key === "protection_mask" });
    const alpha = Buffer.alloc(asset.width * asset.height * 4, 255); let allowed = 0;
    for (let pixel = 0; pixel < loaded.generation_mask.data.length; pixel++) {
      const generation = loaded.generation_mask.data[pixel] ?? 0, protection = loaded.protection_mask.data[pixel] ?? 0, blend = loaded.blend_mask.data[pixel] ?? 0;
      if (blend && !generation) throw new Error("Blend mask extends outside generation mask");
      if (blend && !protection) allowed++;
      // Local white means change; Provider alpha=0 means change.
      alpha[pixel * 4 + 3] = protection ? 255 : 255 - generation;
    }
    if (!allowed) throw new Error("No editable pixels after protection");
    masks = loaded;
    providerMask = await sharp(alpha, { raw: { width: asset.width, height: asset.height, channels: 4 } }).png().toBuffer();
  }
  const parameters: RequestParameters = { model, size, quality: String(canvas.quality), background: String(canvas.background), output_format: "png", n: 1 };
  const request: ProviderRequestRecord = { endpoint: job.task_type === "edit" ? "images/edits" : "images/generations", parameters,
    output_policy: spec.output_policy ?? "strict", prompt_sha256: sha256(compiled.prompt), references: refs.map((ref) => ({ asset_id: ref.id, sha256: ref.sha256 })),
    provider_mask_sha256: providerMask ? sha256(providerMask) : null, project_id: project.document.project_id,
    base_revision: spec.base_revision, base_sha256: project.sha256, target_id: spec.target_id, candidate_id: spec.candidate_id };
  return { job: job as JsonRecord & { job_id: string }, jobBytes, compiled, refs, masks, providerMask, parameters, request, project, asset, spec };
}
