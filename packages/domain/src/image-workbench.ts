// Image workbench policy (ADR 0010, docs/architecture/image-workbench-product-model.md).
// The image engine owns project truth; these types mirror its document and
// candidate contract for the protocol, and the policies decide what the UI and
// Agent may do without knowing engine internals.

/** Mirrors `packages/image-engine` LIMITS; an engine test fails if they drift. */
export const IMAGE_PROJECT_LIMITS = {
  pixels: 16_777_216,
  edge: 8192,
  minCanvasEdge: 64,
  objects: 100,
  assets: 64,
  operations: 100,
  revisions: 1000,
  candidates: 64,
  title: 200,
  summary: 500,
  text: 2000
} as const;

/** Project, object, asset and candidate identifiers share the engine's pattern. */
export const IMAGE_ID_PATTERN = "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$";
const IMAGE_ID = new RegExp(IMAGE_ID_PATTERN, "u");
export const isImageId = (value: unknown): value is string => typeof value === "string" && IMAGE_ID.test(value);

export type ImageChangeAuthor = "human" | "agent" | "system";
export type ImageRasterFormat = "png" | "jpeg" | "webp";
export type ImageFit = "contain" | "cover" | "fill";
export type ImageTextAlign = "left" | "center" | "right";

export interface ImageCanvas { width: number; height: number; background: string }
export interface ImageAsset {
  id: string; file: string; sha256: string; format: ImageRasterFormat; width: number; height: number; render_file: string; render_sha256: string;
}
interface ImageObjectBase {
  id: string; locked: boolean; visible: boolean; x: number; y: number; width: number; height: number; opacity: number;
  /** Degrees clockwise about the box centre, −180…180 (P4, document schema v3). */
  rotation?: number;
  flip_x?: true; flip_y?: true;
  /** How the object composites onto what is below it; absent means normal (P4, v3). */
  blend?: ImageBlendMode;
  /** A project raster read by luminance (white shows, black hides) over the box (P4, v3). */
  mask?: ImageObjectMask;
  /** The group this object belongs to; members are contiguous in paint order (P4, v3). */
  group_id?: string;
}
export const IMAGE_BLEND_MODES = ["multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light",
  "difference", "exclusion", "hue", "saturation", "color", "luminosity"] as const;
export type ImageBlendMode = typeof IMAGE_BLEND_MODES[number];
export interface ImageObjectMask { asset_id: string; invert?: true }
export interface ImageRasterObject extends ImageObjectBase { kind: "image"; asset_id: string; fit: ImageFit; adjust?: ImageAdjust }
/** Factors (1 = unchanged, never written) and a blur in canvas pixels (0 = none), drawn over the image's own pixels (P4, v3). */
export interface ImageAdjust { brightness?: number; contrast?: number; saturation?: number; blur?: number }
/** Inclusive range of each adjustment. */
export const IMAGE_ADJUST_LIMITS: Readonly<Record<keyof ImageAdjust, readonly [number, number]>> = { brightness: [0, 2], contrast: [0, 2], saturation: [0, 2], blur: [0, 100] };
export interface ImageTextObject extends ImageObjectBase {
  kind: "text"; text: string; font_size: number; color: string; align: ImageTextAlign; line_height: number;
  /** A user font from the document's `fonts`; absent means the built-in font. */
  font_id?: string;
}
/** A linear (with `angle`, CSS degrees) or radial fill of 2–5 ordered stops; replaces `color` when present (P4). */
export type ImageGradient =
  | { type: "linear"; angle?: number; stops: { offset: number; color: string }[] }
  | { type: "radial"; stops: { offset: number; color: string }[] };
export interface ImageRectObject extends ImageObjectBase { kind: "rect"; color: string; radius: number; gradient?: ImageGradient }
/** An ellipse filling its box (P4, schema v3). */
export interface ImageEllipseObject extends ImageObjectBase { kind: "ellipse"; color: string; gradient?: ImageGradient }
export type ImageSceneObject = ImageRasterObject | ImageTextObject | ImageRectObject | ImageEllipseObject;
export interface ImageFontBinding { profile: string; family: string; file: string; sha256: string; weight: number }
export interface ImageUserFont { id: string; family: string; file: string; sha256: string; bytes: number; format: "ttf" | "otf" }
/** At most this many user fonts per project. */
export const IMAGE_USER_FONT_LIMIT = 8;
/** A flat layer group: lock and visibility apply to every member, opacity to the group as one picture (P4, v3). */
export interface ImageGroup { id: string; name: string; locked: boolean; visible: boolean; opacity: number }
/** At most this many groups per project. */
export const IMAGE_GROUP_LIMIT = 32;
/** The group an object belongs to, if any. */
export const imageObjectGroup = (document: Pick<ImageDocument, "groups">, object: ImageSceneObject): ImageGroup | undefined =>
  object.group_id === undefined ? undefined : document.groups?.find((group) => group.id === object.group_id);
/**
 * The object as it behaves: locked by itself or its group, and visible only while its group is.
 * For display and gestures; a lock or visibility toggle still writes the object's own flag.
 */
export function imageObjectInEffect<T extends ImageSceneObject>(document: Pick<ImageDocument, "groups">, object: T): T {
  const group = imageObjectGroup(document, object);
  return group && (group.locked || !group.visible) ? { ...object, locked: object.locked || group.locked, visible: object.visible && group.visible } : object;
}
/** Images (photo, generated layers, masks) one project may hold. */
export const IMAGE_ASSET_LIMIT = 64;
export interface ImageChange { author: ImageChangeAuthor; summary: string; operations: string[]; candidate?: { id: string; sha256: string } }
export interface ImageDocument {
  schema: string; project_id: string; title: string; revision: number; parent_sha256: string | null;
  canvas: ImageCanvas; assets: ImageAsset[]; font: ImageFontBinding; fonts?: ImageUserFont[]; groups?: ImageGroup[]; objects: ImageSceneObject[]; change: ImageChange;
}

/**
 * Edits a renderer may submit. `add_asset` is deliberately absent: importing a
 * file needs a path, and paths reach the engine only through Main's dialogs or
 * the Agent's tools, never from renderer payloads.
 */
type Optional = "font_id" | "rotation" | "flip_x" | "flip_y" | "gradient" | "blend" | "mask" | "adjust" | "group_id";
type PatchFields = Partial<Omit<ImageRasterObject, "id" | "kind" | Optional> & Omit<ImageTextObject, "id" | "kind" | Optional> & Omit<ImageRectObject, "id" | "kind" | Optional>>
  & {
    /** Rect and ellipse: a gradient fill, or `null` for the solid colour. */ gradient?: ImageGradient | null;
    /** `null` returns to normal blending. */ blend?: ImageBlendMode | null;
    /** `null` removes the mask. */ mask?: ImageObjectMask | null;
    /** Joins a group (the group must stay contiguous), or `null` leaves it. */ group_id?: string | null;
    /** Image only: replaces every adjustment; unchanged values are dropped, `null` removes them all. */ adjust?: ImageAdjust | null;
    /** Text only: a bound user font, or `null` for the built-in font. */ font_id?: string | null;
    /** `null` or 0 removes the rotation. */ rotation?: number | null;
    /** `null` or false removes the flip. */ flip_x?: boolean | null; flip_y?: boolean | null;
  };
export type ImageObjectPatch = { [Key in keyof PatchFields]: PatchFields[Key] };
export type ImageEditOperation =
  | { type: "update_object"; id: string; patch: ImageObjectPatch }
  | { type: "add_object"; object: ImageTextObject | ImageRectObject | ImageEllipseObject }
  | { type: "remove_object"; id: string }
  | { type: "reorder_objects"; ids: string[] }
  | { type: "set_canvas"; canvas: ImageCanvas }
  | { type: "revert_to"; revision: number }
  | { type: "group_objects"; group: { id: string; name: string }; ids: string[] }
  | { type: "update_group"; id: string; patch: ImageGroupPatch }
  | { type: "ungroup"; id: string };
/** A lock change must be the only field and the only operation in its batch, as for objects. */
export type ImageGroupPatch = Partial<Pick<ImageGroup, "name" | "locked" | "visible" | "opacity">>;

export type ImageCandidateStatus = "ready" | "stale" | "accepted" | "discarded" | "decision_pending";
export type ImageCandidateListStatus = ImageCandidateStatus | "incomplete" | "unreadable";
export type ImageCandidateMode = "replace" | "masked";

export interface ImageCandidateActions { accept: boolean; discard: boolean; compare: boolean; restage: boolean; unlock: boolean }

/**
 * What a person may do with a candidate. Stale candidates are never accepted
 * in place: their basis changed, so they must be re-staged against the current
 * revision. Decisions are terminal; an interrupted decision needs an explicit,
 * audited unlock before anything else.
 */
export function imageCandidateActions(status: ImageCandidateListStatus): ImageCandidateActions {
  switch (status) {
    case "ready": return { accept: true, discard: true, compare: true, restage: false, unlock: false };
    case "stale": return { accept: false, discard: true, compare: true, restage: true, unlock: false };
    case "accepted": case "discarded": return { accept: false, discard: false, compare: true, restage: false, unlock: false };
    case "decision_pending": return { accept: false, discard: false, compare: true, restage: false, unlock: true };
    case "incomplete": case "unreadable": return { accept: false, discard: false, compare: false, restage: false, unlock: false };
  }
}

/** Typed reasons for engine refusals, carried in protocol error details. */
export type ImageEngineFailure =
  | "revision_conflict" | "locked" | "text_overflow" | "missing_glyph" | "limit_exceeded"
  | "not_found" | "candidate_decided" | "decision_pending" | "invalid";

const FAILURE_PATTERNS: readonly [RegExp, ImageEngineFailure][] = [
  [/Revision conflict|base revision conflict|Candidate base revision conflict|Revision changed/u, "revision_conflict"],
  [/Object is locked|locked object|Cannot reorder a locked/u, "locked"],
  [/Text overflow|narrower than glyph/u, "text_overflow"],
  [/Missing font glyphs/u, "missing_glyph"],
  [/limit (?:exceeded|reached)|limit/u, "limit_exceeded"],
  [/already accepted|already discarded|is discarded/u, "candidate_decided"],
  [/decision in progress/u, "decision_pending"],
  [/ENOENT|Unknown object|Incomplete project|not found/u, "not_found"]
];

/** Classifies an engine error message; anything unrecognised is a plain invalid edit. */
export function imageEngineFailure(message: string): ImageEngineFailure {
  for (const [pattern, failure] of FAILURE_PATTERNS) if (pattern.test(message)) return failure;
  return "invalid";
}

/** Consecutive direct edits within this window coalesce into one revision. */
export const IMAGE_EDIT_COALESCE_MS = 300;

/**
 * Agent and person write the same project; `base_revision` is the only lock.
 * A UI edit computed against an older revision is never rebased silently: the
 * user's pending change is kept and the newer revision shown first.
 */
export function imageEditSubmission(displayedRevision: number, latestRevision: number): "submit" | "refresh-first" {
  return displayedRevision === latestRevision ? "submit" : "refresh-first";
}

export type ImageProjectOwnership = "library" | "workspace";

/** Present at the creative library root; marks a Workspace whose projects sit at its top level. */
export const IMAGE_LIBRARY_MARKER = ".newmoney-library.json";
/** Renders and Agent job inputs live outside every project, under the Workspace. */
export const IMAGE_WORK_DIRECTORY = [".newmoney", "image-work"] as const;
const SHA256 = /^[a-f0-9]{64}$/u;

/** Workspace-relative path of a content-addressed preview; Host writes it, Main serves it by digest. */
export function imagePreviewRelativePath(projectId: string, pngSha256: string): string[] {
  if (!isImageId(projectId) || !SHA256.test(pngSha256)) throw new Error("Invalid image preview reference");
  return [...IMAGE_WORK_DIRECTORY, projectId, "previews", `${pngSha256}.png`];
}

/** Prefix of the Pi Providers the workbench registers, one per image source (ADR 0010 decision 14). */
export const IMAGE_PROVIDER_ID = "newmoney-images";
/** The image APIs Desktop implements for Pi: OpenAI-compatible Images, and Volcengine Ark Seedream. */
export const IMAGE_SOURCE_APIS = ["openai-images", "ark-images"] as const;
export type ImageSourceApi = (typeof IMAGE_SOURCE_APIS)[number];
export const IMAGE_SOURCE_LIMITS = Object.freeze({ sources: 8, modelsPerSource: 32, nameChars: 64, baseUrlBytes: 2048 });
const IMAGE_SOURCE_ID = /^[a-z][a-z0-9-]{0,23}$/u;
const IMAGE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export const isImageSourceId = (value: unknown): value is string => typeof value === "string" && IMAGE_SOURCE_ID.test(value);
export const isImageSourceModelId = (value: unknown): value is string => typeof value === "string" && IMAGE_MODEL_ID.test(value);

/** The Pi Provider id of one image source. */
export function imageSourceProviderId(sourceId: string): string {
  if (!isImageSourceId(sourceId)) throw new Error("Invalid image source id");
  return `${IMAGE_PROVIDER_ID}-${sourceId}`;
}

/**
 * Where a project lives relative to its Workspace root. The creative library is
 * itself the Workspace root, so projects sit at its top level where designers
 * see them; inside an ordinary Workspace they stay in one hidden folder.
 */
export function imageProjectRelativePath(ownership: ImageProjectOwnership, projectId: string): string[] {
  if (!isImageId(projectId)) throw new Error("Invalid image project id");
  return ownership === "library" ? [projectId] : [".newmoney", "images", projectId];
}

export type ImageJobKind = "render" | "generate" | "composite" | "variants";
export type ImageJobState = "queued" | "running" | "completed" | "failed" | "cancelled";
export const isTerminalImageJobState = (state: ImageJobState): boolean => state === "completed" || state === "failed" || state === "cancelled";

export interface ImageTaskBudget { draftCandidates: number; draftQuality: "low" | "medium"; finals: number; finalQuality: "medium" | "high"; rounds: number }
export const DEFAULT_IMAGE_TASK_BUDGET: ImageTaskBudget = { draftCandidates: 4, draftQuality: "low", finals: 1, finalQuality: "high", rounds: 3 };
export interface ImageTaskUsage { draftCandidates: number; finals: number; rounds: number }
export interface ImageGenerationRequest { stage: "draft" | "final"; count: number; quality: "low" | "medium" | "high" }

/**
 * Within budget the Agent proceeds unattended; anything beyond it, or above the
 * budgeted quality, asks the person once. A new round starts only after a
 * prior round finished, so `rounds` counts completed rounds.
 */
export function imageBudgetDecision(budget: ImageTaskBudget, used: ImageTaskUsage, request: ImageGenerationRequest): "proceed" | "ask" {
  if (!Number.isInteger(request.count) || request.count < 1) return "ask";
  if (used.rounds >= budget.rounds) return "ask";
  const rank = { low: 0, medium: 1, high: 2 } as const;
  if (request.stage === "draft") {
    return used.draftCandidates + request.count <= budget.draftCandidates && rank[request.quality] <= rank[budget.draftQuality] ? "proceed" : "ask";
  }
  return used.finals + request.count <= budget.finals && rank[request.quality] <= rank[budget.finalQuality] ? "proceed" : "ask";
}

/** Multi-size export presets (product model §7 F): each becomes a derived project, re-laid out, never a scaled copy. */
export const IMAGE_SIZE_PRESETS = ["1x1", "3x4", "4x5", "9x16", "16x9"] as const;
export type ImageSizePreset = typeof IMAGE_SIZE_PRESETS[number];
export const imageSizePresetLabel = (preset: ImageSizePreset): string => preset.replace("x", ":");

/** Whether a canvas of this size is within the engine's limits (8192 per side, 16.7 million pixels). */
export const imageSizePresetFits = (size: { width: number; height: number }): boolean =>
  size.width <= IMAGE_PROJECT_LIMITS.edge && size.height <= IMAGE_PROJECT_LIMITS.edge && size.width * size.height <= IMAGE_PROJECT_LIMITS.pixels;

/** A preset's pixel size: the source's short edge kept, the other edge from the ratio. */
export function imageSizePresetSize(source: { width: number; height: number }, preset: ImageSizePreset): { width: number; height: number } {
  const [across, down] = preset.split("x").map(Number) as [number, number];
  const short = Math.min(source.width, source.height);
  return across >= down ? { width: Math.round(short * across / down), height: short } : { width: short, height: Math.round(short * down / across) };
}

export type ImageReferenceRole = "keep-subject" | "keep-style" | "take-composition";
export interface ImageMark { id: string; x: number; y: number; width: number; height: number; instruction: string }
export interface ImagePromptContext {
  projectId: string;
  revision: number;
  selectedObjectIds: string[];
  marks: ImageMark[];
  references: { assetId: string; role: ImageReferenceRole }[];
}

/** References stop at two: a Provider takes three input images and the edited one is always first. */
export const IMAGE_PROMPT_CONTEXT_LIMITS = { selected: 32, marks: 16, references: 2, instruction: 500 } as const;
export const IMAGE_REFERENCE_ROLE_LABELS: Readonly<Record<ImageReferenceRole, string>> = { "keep-subject": "保留主体", "keep-style": "保留风格", "take-composition": "取构图" };
export const IMAGE_REFERENCE_ROLES = Object.keys(IMAGE_REFERENCE_ROLE_LABELS) as readonly ImageReferenceRole[];

/**
 * Renders the project page's structured context as a stable text block the
 * Agent reads before acting. It is advisory: the Agent still reads the project
 * and the engine re-validates every batch, so a forged block grants nothing.
 */
export function formatImagePromptContext(context: ImagePromptContext): string {
  if (!isImageId(context.projectId) || !Number.isInteger(context.revision) || context.revision < 1) throw new Error("Invalid image prompt context");
  const limits = IMAGE_PROMPT_CONTEXT_LIMITS;
  if (context.selectedObjectIds.length > limits.selected || context.marks.length > limits.marks || context.references.length > limits.references) {
    throw new Error("Image prompt context exceeds its limits");
  }
  const clean = (text: string): string => Array.from(text, (char) => (char.codePointAt(0) ?? 0) < 0x20 || char === "\u007f" ? " " : char).join("")
    .replace(/\s+/gu, " ").trim().slice(0, limits.instruction);
  const lines = ["<image-context>", `project: ${context.projectId}`, `revision: ${context.revision}`];
  const ids = context.selectedObjectIds.filter(isImageId);
  if (ids.length) lines.push(`selected: ${ids.join(", ")}`);
  for (const mark of context.marks) {
    if (!isImageId(mark.id) || ![mark.x, mark.y, mark.width, mark.height].every((value) => Number.isInteger(value) && value >= 0)) continue;
    lines.push(`mark ${mark.id} [x=${mark.x} y=${mark.y} w=${mark.width} h=${mark.height}]: ${clean(mark.instruction)}`);
  }
  for (const reference of context.references) {
    if (isImageId(reference.assetId)) lines.push(`reference ${reference.assetId}: ${IMAGE_REFERENCE_ROLE_LABELS[reference.role]}`);
  }
  lines.push("</image-context>");
  return lines.join("\n");
}

const IMAGE_CONTEXT_BLOCK = /\n*<image-context>\n[\s\S]*?\n<\/image-context>\s*$/u;

/** The prompt as sent: the person's words, then the context block the image page attaches. */
export function withImagePromptContext(text: string, block: string | undefined): string {
  return block ? `${text.replace(IMAGE_CONTEXT_BLOCK, "")}\n\n${block}` : text;
}

/** The person's words as the transcript shows them; the attached block stays in Pi's history only. */
export function withoutImagePromptContext(text: string): string {
  return text.replace(IMAGE_CONTEXT_BLOCK, "");
}
