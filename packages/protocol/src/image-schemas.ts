import { IMAGE_ID_PATTERN, IMAGE_PROJECT_LIMITS } from "@pi67/domain";
import { strictObject, Type, Value, type TSchema } from "./typebox-schema.js";
import type { ImageCommandPayloads, ImageCommandResults, ImageEventPayloads } from "./image-command-messages.js";

// Structure only. The engine re-validates every document and batch (bounds
// inside the canvas, locks, glyphs, text fit), so these schemas admit what the
// engine may accept and reject what it never would.
const L = IMAGE_PROJECT_LIMITS;
const IdSchema = Type.String({ minLength: 1, maxLength: 64, pattern: IMAGE_ID_PATTERN });
const Sha256Schema = Type.String({ minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" });
const RevisionSchema = Type.Integer({ minimum: 1, maximum: L.revisions });
const ColorSchema = Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9a-fA-F]{6}$" });
const CoordinateSchema = Type.Number({ minimum: 0, maximum: L.edge });
const SizeSchema = Type.Number({ minimum: 1, maximum: L.edge });
const OpacitySchema = Type.Number({ minimum: 0, maximum: 1 });
const SummarySchema = Type.String({ minLength: 1, maxLength: L.summary });
const TextSchema = Type.String({ minLength: 1, maxLength: L.text });
const FitSchema = Type.Union([Type.Literal("contain"), Type.Literal("cover"), Type.Literal("fill")]);
const AlignSchema = Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right")]);
const FontSizeSchema = Type.Number({ minimum: 8, maximum: 500 });
const LineHeightSchema = Type.Number({ minimum: 1, maximum: 2 });
const RadiusSchema = Type.Number({ minimum: 0, maximum: L.edge / 2 });
const AuthorSchema = Type.Union([Type.Literal("human"), Type.Literal("agent"), Type.Literal("system")]);
const TimestampSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

const CanvasSchema = strictObject({
  width: Type.Integer({ minimum: L.minCanvasEdge, maximum: L.edge }),
  height: Type.Integer({ minimum: L.minCanvasEdge, maximum: L.edge }),
  background: ColorSchema
});
const common = {
  id: IdSchema, locked: Type.Boolean(), visible: Type.Boolean(),
  x: CoordinateSchema, y: CoordinateSchema, width: SizeSchema, height: SizeSchema, opacity: OpacitySchema
};
const RasterObjectSchema = strictObject({ ...common, kind: Type.Literal("image"), asset_id: IdSchema, fit: FitSchema });
const TextObjectSchema = strictObject({
  ...common, kind: Type.Literal("text"), text: TextSchema, font_size: FontSizeSchema, color: ColorSchema, align: AlignSchema, line_height: LineHeightSchema
});
const RectObjectSchema = strictObject({ ...common, kind: Type.Literal("rect"), color: ColorSchema, radius: RadiusSchema });
const SceneObjectSchema = Type.Union([RasterObjectSchema, TextObjectSchema, RectObjectSchema]);
const AssetSchema = strictObject({
  id: IdSchema,
  file: Type.String({ minLength: 1, maxLength: 160 }),
  sha256: Sha256Schema,
  format: Type.Union([Type.Literal("png"), Type.Literal("jpeg"), Type.Literal("webp")]),
  width: Type.Integer({ minimum: 1, maximum: L.edge }),
  height: Type.Integer({ minimum: 1, maximum: L.edge }),
  render_file: Type.String({ minLength: 1, maxLength: 160 }),
  render_sha256: Sha256Schema
});
const DocumentSchema = strictObject({
  schema: Type.String({ minLength: 1, maxLength: 128 }),
  project_id: IdSchema,
  title: Type.String({ minLength: 1, maxLength: L.title }),
  revision: RevisionSchema,
  parent_sha256: Type.Union([Sha256Schema, Type.Null()]),
  canvas: CanvasSchema,
  assets: Type.Array(AssetSchema, { maxItems: L.assets }),
  font: strictObject({
    profile: Type.String({ minLength: 1, maxLength: 128 }),
    family: Type.String({ minLength: 1, maxLength: 128 }),
    file: Type.String({ minLength: 1, maxLength: 160 }),
    sha256: Sha256Schema,
    weight: Type.Integer({ minimum: 1, maximum: 1000 })
  }),
  objects: Type.Array(SceneObjectSchema, { minItems: 1, maxItems: L.objects }),
  change: strictObject({
    author: AuthorSchema,
    summary: SummarySchema,
    operations: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { minItems: 1, maxItems: L.operations }),
    candidate: Type.Optional(strictObject({ id: IdSchema, sha256: Sha256Schema }))
  })
});

const PatchSchema = Type.Object({
  locked: Type.Optional(Type.Boolean()), visible: Type.Optional(Type.Boolean()),
  x: Type.Optional(CoordinateSchema), y: Type.Optional(CoordinateSchema), width: Type.Optional(SizeSchema), height: Type.Optional(SizeSchema),
  opacity: Type.Optional(OpacitySchema), asset_id: Type.Optional(IdSchema), fit: Type.Optional(FitSchema),
  text: Type.Optional(TextSchema), font_size: Type.Optional(FontSizeSchema), color: Type.Optional(ColorSchema),
  align: Type.Optional(AlignSchema), line_height: Type.Optional(LineHeightSchema), radius: Type.Optional(RadiusSchema)
}, { additionalProperties: false, minProperties: 1 });
const EditOperationSchema = Type.Union([
  strictObject({ type: Type.Literal("update_object"), id: IdSchema, patch: PatchSchema }),
  strictObject({ type: Type.Literal("add_object"), object: Type.Union([TextObjectSchema, RectObjectSchema]) }),
  strictObject({ type: Type.Literal("remove_object"), id: IdSchema }),
  strictObject({ type: Type.Literal("reorder_objects"), ids: Type.Array(IdSchema, { minItems: 1, maxItems: L.objects }) }),
  strictObject({ type: Type.Literal("set_canvas"), canvas: CanvasSchema }),
  strictObject({ type: Type.Literal("revert_to"), revision: RevisionSchema })
]);

const CandidateStatusSchema = Type.Union([
  Type.Literal("ready"), Type.Literal("stale"), Type.Literal("accepted"), Type.Literal("discarded"),
  Type.Literal("decision_pending"), Type.Literal("incomplete"), Type.Literal("unreadable")
]);
const CandidateSummarySchema = strictObject({
  candidateId: IdSchema,
  status: CandidateStatusSchema,
  targetId: Type.Optional(IdSchema),
  mode: Type.Optional(Type.Union([Type.Literal("replace"), Type.Literal("masked")])),
  baseRevision: Type.Optional(RevisionSchema),
  summary: Type.Optional(SummarySchema),
  outputSha256: Type.Optional(Sha256Schema),
  generated: Type.Optional(Type.Boolean()),
  protectedChangedPixels: Type.Optional(Type.Integer({ minimum: 0, maximum: L.pixels }))
});
const ProjectSummarySchema = strictObject({
  projectId: IdSchema,
  title: Type.String({ minLength: 1, maxLength: L.title }),
  revision: RevisionSchema,
  canvas: CanvasSchema,
  updatedAt: TimestampSchema,
  readyCandidates: Type.Integer({ minimum: 0, maximum: L.candidates })
});
const RevisionResultSchema = strictObject({ projectId: IdSchema, revision: RevisionSchema, sha256: Sha256Schema, dryRun: Type.Boolean() });
const ProjectRefSchema = strictObject({ projectId: IdSchema });

export const ImageCommandPayloadSchemas: Record<keyof ImageCommandPayloads, TSchema> = {
  "image.project.list": strictObject({}),
  "image.project.read": strictObject({ projectId: IdSchema, revision: Type.Optional(RevisionSchema) }),
  "image.project.edit": strictObject({
    projectId: IdSchema, baseRevision: RevisionSchema, summary: SummarySchema,
    operations: Type.Array(EditOperationSchema, { minItems: 1, maxItems: L.operations }), dryRun: Type.Optional(Type.Boolean())
  }),
  "image.project.render": strictObject({
    projectId: IdSchema, revision: Type.Optional(RevisionSchema), candidateId: Type.Optional(IdSchema),
    previewMax: Type.Optional(Type.Integer({ minimum: 64, maximum: L.edge }))
  }),
  "image.candidate.list": ProjectRefSchema,
  "image.candidate.accept": strictObject({ projectId: IdSchema, candidateId: IdSchema, baseRevision: RevisionSchema, summary: SummarySchema }),
  "image.candidate.discard": strictObject({ projectId: IdSchema, candidateId: IdSchema, summary: SummarySchema })
};

export const ImageCommandResultSchemas: Record<keyof ImageCommandResults, TSchema> = {
  "image.project.list": strictObject({ projects: Type.Array(ProjectSummarySchema, { maxItems: 10_000 }) }),
  "image.project.read": strictObject({ projectId: IdSchema, revision: RevisionSchema, latestRevision: RevisionSchema, sha256: Sha256Schema, document: DocumentSchema }),
  "image.project.edit": RevisionResultSchema,
  "image.project.render": strictObject({
    projectId: IdSchema, revision: RevisionSchema, candidateId: Type.Optional(IdSchema), pngSha256: Sha256Schema,
    width: Type.Integer({ minimum: 1, maximum: L.edge }), height: Type.Integer({ minimum: 1, maximum: L.edge })
  }),
  "image.candidate.list": strictObject({ projectId: IdSchema, candidates: Type.Array(CandidateSummarySchema, { maxItems: L.candidates }) }),
  "image.candidate.accept": RevisionResultSchema,
  "image.candidate.discard": strictObject({ projectId: IdSchema, candidateId: IdSchema, status: Type.Literal("discarded") })
};

export const ImageEventPayloadSchemas: Record<keyof ImageEventPayloads, TSchema> = {
  "image.project.changed": strictObject({ projectId: IdSchema, revision: RevisionSchema, sha256: Sha256Schema, author: AuthorSchema }),
  "image.candidate.changed": strictObject({ projectId: IdSchema, candidateId: IdSchema, status: CandidateStatusSchema }),
  "image.job.changed": strictObject({
    projectId: IdSchema,
    jobId: IdSchema,
    kind: Type.Union([Type.Literal("render"), Type.Literal("generate"), Type.Literal("composite"), Type.Literal("variants")]),
    state: Type.Union([Type.Literal("queued"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled")]),
    progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 }))
  })
};

/** Structural check of an engine document before it crosses the Agent port. */
export const isImageDocument = (value: unknown): boolean => Value.Check(DocumentSchema, value);

export { DocumentSchema as ImageDocumentSchema, EditOperationSchema as ImageEditOperationSchema, CandidateStatusSchema as ImageCandidateStatusSchema };
