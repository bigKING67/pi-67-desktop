import { readFileSync } from "node:fs";
import { isRecord, type JsonRecord } from "./document.js";
import { ANY_MODEL, profileAllowsModel, providerProfiles, surfaceProfiles } from "./provider-profiles.js";

// Node port of the creative-craft canonical contracts for Image Job v2 and
// Execution Receipt v1. Error messages mirror the Python validator so the shared
// fixtures in test-support/contract-fixtures.json prove parity.
export interface ContractResult { valid: boolean; errors: string[]; warnings: string[] }
export interface CompiledImageJob { pack: string; prompt: string }
export interface ImageContracts {
  validateJob(data: unknown): ContractResult;
  compileJob(data: JsonRecord): CompiledImageJob;
  validateReceipt(data: unknown): ContractResult;
}

const schemasUrl = new URL("../schemas/", import.meta.url);
const loadSchema = (name: string): JsonRecord => JSON.parse(readFileSync(new URL(name, schemasUrl), "utf8")) as JsonRecord;
const IMAGE_JOB_SCHEMA = loadSchema("image-job-v2.schema.json");
const RECEIPT_SCHEMA = loadSchema("execution-receipt.schema.json");

// Python repr() for the value kinds that appear in schema messages.
function repr(value: unknown): string {
  if (typeof value === "string") return value.includes("'") && !value.includes('"') ? `"${value}"` : `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return `[${value.map(repr).join(", ")}]`;
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}
const jsonPath = (path: readonly (string | number)[]): string => path.map(String).join(".");
const isObject = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const typeMatches = (value: unknown, expected: string): boolean => {
  switch (expected) {
    case "object": return isObject(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return false;
  }
};
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function validateNode(value: unknown, schema: JsonRecord, path: (string | number)[], errors: string[]): void {
  const expected = schema.type;
  const expectedTypes = typeof expected === "string" ? [expected] : Array.isArray(expected) ? expected : undefined;
  if (expectedTypes && !expectedTypes.some((item) => typeof item === "string" && typeMatches(value, item))) {
    errors.push(`${jsonPath(path)} must be ${expectedTypes.map(String).join(" or ")}`);
    return;
  }
  if ("const" in schema && !sameJson(value, schema.const)) errors.push(`${jsonPath(path)} must equal ${repr(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => sameJson(item, value))) errors.push(`${jsonPath(path)} must be one of ${repr(schema.enum)}`);
  if (isObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) if (typeof key === "string" && !(key in value)) errors.push(`${jsonPath([...path, key])} is required`);
    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (isObject(childSchema)) validateNode(child, childSchema, [...path, key], errors);
      else if (schema.additionalProperties === false) errors.push(`${jsonPath([...path, key])} is not allowed`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${jsonPath(path)} must contain at least ${schema.minItems} items`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${jsonPath(path)} must contain at most ${schema.maxItems} items`);
    if (schema.uniqueItems === true) {
      const seen = new Map<string, number>();
      for (const [index, item] of value.entries()) {
        const key = JSON.stringify(item);
        const first = seen.get(key);
        if (first !== undefined) { errors.push(`${jsonPath(path)} must contain unique items; indexes ${first} and ${index} are equal`); break; }
        seen.set(key, index);
      }
    }
    if (isObject(schema.items)) for (const [index, item] of value.entries()) validateNode(item, schema.items, [...path, index], errors);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && Array.from(value).length < schema.minLength) errors.push(`${jsonPath(path)} must contain at least ${schema.minLength} characters`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${jsonPath(path)} does not match pattern ${repr(schema.pattern)}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${jsonPath(path)} must be >= ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${jsonPath(path)} must be <= ${schema.maximum}`);
  }
}

function validateAgainstSchema(data: unknown, schema: JsonRecord): string[] {
  const errors: string[] = [];
  validateNode(data, schema, [], errors);
  return errors;
}

const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
class Result {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  require(condition: boolean, message: string): void { if (!condition) this.errors.push(message); }
  warn(condition: boolean, message: string): void { if (!condition) this.warnings.push(message); }
  toContract(): ContractResult { return { valid: this.errors.length === 0, errors: [...this.errors], warnings: [...this.warnings] }; }
}
const requireString = (r: Result, data: JsonRecord, key: string, prefix = ""): void => r.require(nonempty(data[key]), `${prefix}${key} must be a non-empty string`);
const requireList = (r: Result, data: JsonRecord, key: string, prefix = ""): void => r.require(Array.isArray(data[key]), `${prefix}${key} must be an array`);

function parseImageSize(size: string): [number, number] | null {
  if (size === "auto") return null;
  const match = /^(\d+)x(\d+)$/u.exec(size);
  if (!match) throw new Error("size must be auto or WIDTHxHEIGHT");
  return [Number(match[1]), Number(match[2])];
}

function validateSize(r: Result, size: unknown, profile: JsonRecord | undefined): void {
  if (typeof size !== "string" || !profile) return;
  let parsed: [number, number] | null;
  try { parsed = parseImageSize(size); }
  catch (error) { r.errors.push(`canvas.size: ${error instanceof Error ? error.message : String(error)}`); return; }
  if (!parsed) return;
  const [width, height] = parsed;
  const capabilities = isRecord(profile.capabilities) ? profile.capabilities : {};
  const caps = isRecord(capabilities.size) ? capabilities.size : {};
  const num = (key: string): number => typeof caps[key] === "number" ? caps[key] : Number.NaN;
  r.require(Math.max(width, height) <= num("max_edge_px"), `canvas.size maximum edge exceeds ${String(caps.max_edge_px)}px`);
  r.require(width % num("edge_multiple_px") === 0 && height % num("edge_multiple_px") === 0, `canvas.size edges must be multiples of ${String(caps.edge_multiple_px)}px`);
  r.require(Math.max(width, height) / Math.min(width, height) <= num("max_aspect_ratio"), `canvas.size aspect ratio exceeds ${pyFloat(caps.max_aspect_ratio)}:1`);
  const pixels = width * height;
  r.require(num("min_total_pixels") <= pixels && pixels <= num("max_total_pixels"), "canvas.size total pixels are outside the provider profile");
  if (pixels > num("experimental_above_total_pixels")) r.warnings.push("canvas.size is above the provider profile's experimental reliability boundary");
}

// Python prints floats with a trailing ".0" when integral (3.0), which JSON parsing loses.
const pyFloat = (value: unknown): string => typeof value === "number" && Number.isInteger(value) ? `${value}.0` : String(value);

function validateImageJobSemantics(data: JsonRecord): Result {
  const r = new Result();
  r.require(data.schema_version === "creative-craft.image-job.v2", "schema_version must be creative-craft.image-job.v1 or v2");
  for (const key of ["job_id", "brief_id", "provider_profile", "intended_use"]) requireString(r, data, key);
  r.require(data.task_type === "generate" || data.task_type === "edit", "task_type is invalid");
  r.require(data.execution_mode === "single_turn" || data.execution_mode === "multi_turn", "execution_mode is invalid");
  for (const key of ["direction_id", "selected_route_id", "execution_surface"]) requireString(r, data, key);
  r.require(Array.isArray(data.asset_refs), "asset_refs must be an array");
  if (Array.isArray(data.asset_refs)) r.require(new Set(data.asset_refs.map((item) => JSON.stringify(item))).size === data.asset_refs.length, "asset_refs must not contain duplicates");
  r.require(["draft", "ready", "superseded"].includes(data.declared_status as string), "declared_status is invalid");
  const profileId = data.provider_profile;
  const profile = typeof profileId === "string" ? providerProfiles.get(profileId) : undefined;
  r.require(profile !== undefined, `unknown provider_profile: ${repr(profileId)}`);
  const surfaceId = data.execution_surface;
  const surface = typeof surfaceId === "string" ? surfaceProfiles.get(surfaceId) : undefined;
  r.require(surface !== undefined, `unknown execution_surface: ${repr(surfaceId)}`);
  if (surface) {
    const modes = Array.isArray(surface.modes) ? surface.modes : [];
    const profiles = Array.isArray(surface.provider_profiles) ? surface.provider_profiles : [];
    r.require(surface.available === true, `execution_surface is not currently available: ${repr(surfaceId)}`);
    r.require(profiles.includes(profileId), "execution_surface does not support provider_profile");
    r.require(modes.includes(data.execution_mode), "execution_surface does not support execution_mode");
    r.require(modes.includes(data.task_type), "execution_surface does not support task_type");
  }
  const canvas = data.canvas;
  r.require(isObject(canvas), "canvas must be an object");
  if (isObject(canvas)) {
    for (const key of ["size", "quality", "format", "background"]) requireString(r, canvas, key, "canvas.");
    r.require(["low", "medium", "high", "auto"].includes(canvas.quality as string), "canvas.quality is invalid");
    r.require(["png", "jpeg", "webp"].includes(canvas.format as string), "canvas.format is invalid");
    const compression = canvas.compression;
    r.require(compression === null || (typeof compression === "number" && Number.isInteger(compression) && compression >= 0 && compression <= 100), "canvas.compression must be null or an integer from 0 to 100");
    if (compression !== null && compression !== undefined) r.require(canvas.format === "jpeg" || canvas.format === "webp", "canvas.compression is supported only for jpeg or webp");
    if (canvas.background === "transparent") {
      const capabilities = isRecord(profile?.capabilities) ? profile.capabilities : {};
      r.require(capabilities.transparent_background === true, "transparent background requires a capable v2 provider");
      r.require(canvas.format === "png" || canvas.format === "webp", "transparent background requires PNG/WebP");
    } else r.require(canvas.background === "opaque" || canvas.background === "auto", "canvas.background is invalid");
    r.require(typeof canvas.variants === "number" && Number.isInteger(canvas.variants) && canvas.variants >= 1, "canvas.variants must be an integer >= 1");
    validateSize(r, canvas.size, profile);
  }
  const prompt = data.prompt;
  r.require(isObject(prompt), "prompt must be an object");
  if (isObject(prompt)) {
    for (const key of ["scene", "subject", "composition", "lighting", "materials_style"]) requireString(r, prompt, key, "prompt.");
    for (const key of ["exact_text", "references", "change", "preserve", "constraints", "exclude"]) requireList(r, prompt, key, "prompt.");
    if (data.task_type === "edit") {
      r.warn(Array.isArray(prompt.change) && prompt.change.length > 0, "edit job has no explicit change list");
      r.warn(Array.isArray(prompt.preserve) && prompt.preserve.length > 0, "edit job has no explicit preserve list");
    }
    const seenRefs = new Set<string>();
    for (const [i, ref] of (Array.isArray(prompt.references) ? prompt.references : []).entries()) {
      if (!isObject(ref)) { r.errors.push(`prompt.references[${i}] must be an object`); continue; }
      r.require(nonempty(ref.asset_id), `prompt.references[${i}].asset_id is required`);
      r.require(nonempty(ref.role), `prompt.references[${i}].role is required`);
      if (typeof ref.asset_id === "string") {
        r.require(!seenRefs.has(ref.asset_id), `prompt.references[${i}] duplicates asset_id ${ref.asset_id}`);
        seenRefs.add(ref.asset_id);
      }
    }
  }
  requireList(r, data, "inspection");
  const rights = data.rights;
  r.require(isObject(rights), "rights must be an object");
  if (isObject(rights)) r.require(["CLEARED", "LIMITED", "REJECTED", "UNVERIFIED"].includes(rights.status as string), "rights.status is invalid");
  return r;
}

function parseUtcTimestamp(value: unknown, label: string, r: Result): number | undefined {
  if (!nonempty(value)) { r.errors.push(`${label} must be an ISO-8601 timestamp with timezone`); return undefined; }
  const text = value.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/u.test(text)) { r.errors.push(`${label} must include a timezone offset or Z`); return undefined; }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) { r.errors.push(`${label} must be an ISO-8601 timestamp with timezone`); return undefined; }
  return parsed;
}

function validateReceiptSemantics(data: JsonRecord): Result {
  const r = new Result();
  const profileId = data.provider_profile, surfaceId = data.execution_surface;
  const profile = typeof profileId === "string" ? providerProfiles.get(profileId) : undefined;
  const surface = typeof surfaceId === "string" ? surfaceProfiles.get(surfaceId) : undefined;
  r.require(profile !== undefined, `unknown provider_profile: ${repr(profileId)}`);
  r.require(surface !== undefined, `unknown execution_surface: ${repr(surfaceId)}`);
  if (profile) {
    r.require(data.model === profile.model || (profile.model === ANY_MODEL && profileAllowsModel(profileId, data.model)), "receipt model differs from provider profile");
    if (profile.snapshot !== undefined && profile.snapshot !== null) r.require(data.snapshot === profile.snapshot, "receipt snapshot differs from provider profile");
  }
  if (surface) r.require(Array.isArray(surface.provider_profiles) && surface.provider_profiles.includes(profileId), "execution_surface does not support provider_profile");
  const outputs = Array.isArray(data.outputs) ? data.outputs : [];
  if (data.outcome === "succeeded" || data.outcome === "partial") r.require(outputs.length > 0, `${String(data.outcome)} receipt requires at least one output`);
  if (data.outcome === "failed" || data.outcome === "cancelled") r.require(outputs.length === 0, `${String(data.outcome)} receipt must not claim outputs; use partial`);
  const started = parseUtcTimestamp(data.started_at, "started_at", r), completed = parseUtcTimestamp(data.completed_at, "completed_at", r);
  if (started !== undefined && completed !== undefined) r.require(completed >= started, "completed_at must be at or after started_at");
  const seen = new Set<string>(), seenPaths = new Set<string>();
  for (const [index, output] of outputs.entries()) {
    if (!isObject(output)) continue;
    if (typeof output.asset_id === "string") { r.require(!seen.has(output.asset_id), `outputs[${index}] duplicates asset_id ${output.asset_id}`); seen.add(output.asset_id); }
    if (typeof output.path === "string") { r.require(!seenPaths.has(output.path), `outputs[${index}] duplicates path ${output.path}`); seenPaths.add(output.path); }
  }
  return r;
}

function validateWith(data: unknown, schema: JsonRecord, semantics: (value: JsonRecord) => Result): ContractResult {
  if (!isObject(data)) return { valid: false, errors: ["artifact must be an object"], warnings: [] };
  const structural = validateAgainstSchema(data, schema);
  if (structural.length) return { valid: false, errors: structural, warnings: [] };
  return semantics(data).toContract();
}

export const validateImageJob = (data: unknown): ContractResult => validateWith(data, IMAGE_JOB_SCHEMA, validateImageJobSemantics);
export const validateExecutionReceipt = (data: unknown): ContractResult => validateWith(data, RECEIPT_SCHEMA, validateReceiptSemantics);

const bulletLines = (items: unknown): string[] => (Array.isArray(items) ? items : []).map((item) => String(item).trim()).filter(Boolean).map((value) => `- ${value}`);
const section = (title: string, lines: string[]): string[] => {
  const values = lines.filter((line) => line.trim());
  return values.length ? [`### ${title}`, ...values, ""] : [];
};
const text = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
};

// Exact port of creative_craft_evaluation.compile_image_markdown; the prompt is
// the single fenced block, so a fence inside any field would truncate it.
export function compileImageJob(data: JsonRecord): CompiledImageJob {
  const canvas = isObject(data.canvas) ? data.canvas : {}, prompt = isObject(data.prompt) ? data.prompt : {};
  const declaredStatus = text(data.declared_status ?? data.status ?? "unknown");
  const out = [
    `# Image execution pack — ${text(data.job_id)}`, "",
    `- Provider profile: \`${text(data.provider_profile)}\``, `- Execution surface: \`${text(data.execution_surface ?? "legacy-unspecified")}\``,
    `- Task: \`${text(data.task_type)}\``, `- Execution mode: \`${text(data.execution_mode)}\``, `- Declared status: \`${declaredStatus}\``,
    `- Size: \`${text(canvas.size)}\``, `- Quality: \`${text(canvas.quality)}\``, `- Format: \`${text(canvas.format)}\``,
    `- Compression: \`${canvas.compression === null || canvas.compression === undefined ? "provider default" : text(canvas.compression)}\``,
    `- Background: \`${text(canvas.background)}\``, `- Variants: \`${text(canvas.variants)}\``, "", "## Prompt", ""
  ];
  const lines: string[] = [];
  lines.push(...section("INTENDED USE AND OUTPUT", [text(data.intended_use),
    `Create ${text(canvas.variants)} output variant(s) at ${text(canvas.size)}, ${text(canvas.quality)} quality, ${text(canvas.format)} format, ${text(canvas.background)} background.`]));
  lines.push(...section("BACKGROUND / SCENE", [text(prompt.scene)]));
  lines.push(...section("SUBJECT", [text(prompt.subject)]));
  lines.push(...section("ACTION / EXPRESSION", [text(prompt.action ?? "")]));
  lines.push(...section("COMPOSITION / CAMERA / NEGATIVE SPACE", [text(prompt.composition)]));
  lines.push(...section("LIGHTING", [text(prompt.lighting)]));
  lines.push(...section("MATERIALS / MEDIUM / STYLE", [text(prompt.materials_style)]));
  const exactText: string[] = [];
  for (const item of Array.isArray(prompt.exact_text) ? prompt.exact_text : []) {
    if (!isObject(item)) continue;
    const suffix = [text(item.placement ?? ""), text(item.typography ?? "")].filter(Boolean).join("; ");
    exactText.push(`- "${text(item.text ?? "")}"${suffix ? ` — ${suffix}` : ""}`);
  }
  if (exactText.length) exactText.push("- Include no other text unless explicitly listed.");
  lines.push(...section("EXACT TEXT / TYPOGRAPHY", exactText));
  const referenceLines: string[] = [];
  for (const ref of Array.isArray(prompt.references) ? prompt.references : []) {
    if (!isObject(ref)) continue;
    let line = `- @${text(ref.asset_id)}: ${text(ref.role)}`;
    const preserve = Array.isArray(ref.preserve) ? ref.preserve : [];
    if (preserve.length) line += ` Preserve: ${preserve.map(String).join(", ")}.`;
    referenceLines.push(line);
  }
  lines.push(...section("REFERENCE MAP", referenceLines));
  lines.push(...section("CHANGE ONLY", bulletLines(prompt.change)));
  lines.push(...section("PRESERVE EXACTLY", bulletLines(prompt.preserve)));
  lines.push(...section("CONSTRAINTS", bulletLines(prompt.constraints)));
  lines.push(...section("DO NOT ADD / EXCLUDE", bulletLines(prompt.exclude)));
  out.push("```text", ...lines, "```", "", "## Post-generation inspection", "");
  out.push(...bulletLines(data.inspection));
  const rights = isObject(data.rights) ? data.rights : {};
  out.push("", `Rights status: \`${text(rights.status ?? "UNVERIFIED")}\``, "",
    `This pack was compiled from declared status \`${declaredStatus}\`; compilation is not evidence that an image was generated or approved.`);
  const pack = `${out.join("\n").replace(/\s+$/u, "")}\n`;
  if (pack.split("```").length - 1 !== 2) throw new Error("job text fields must not contain ``` code fences");
  return { pack, prompt: pack.split("```text\n", 2)[1]?.split("\n```", 1)[0] ?? "" };
}

export const canonicalContracts: ImageContracts = {
  validateJob: validateImageJob,
  compileJob: compileImageJob,
  validateReceipt: validateExecutionReceipt
};
