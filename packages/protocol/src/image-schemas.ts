import { IMAGE_ADJUST_LIMITS, IMAGE_BATCH_LIMITS, IMAGE_BRAND_LIMITS, IMAGE_GROUP_LIMIT, IMAGE_ID_PATTERN, IMAGE_TEMPLATE_SLOT_LIMIT, IMAGE_PROJECT_LIMITS, IMAGE_SIZE_PRESETS, IMAGE_USER_FONT_LIMIT } from "@pi67/domain";
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
const RotationSchema = Type.Number({ minimum: -180, maximum: 180 });
// Spelled out so the static type is the literal union; the parity test in image-schemas.test.ts fails if it drifts from IMAGE_BLEND_MODES.
const BlendSchema = Type.Union([
  Type.Literal("multiply"), Type.Literal("screen"), Type.Literal("overlay"), Type.Literal("darken"), Type.Literal("lighten"),
  Type.Literal("color-dodge"), Type.Literal("color-burn"), Type.Literal("hard-light"), Type.Literal("soft-light"), Type.Literal("difference"),
  Type.Literal("exclusion"), Type.Literal("hue"), Type.Literal("saturation"), Type.Literal("color"), Type.Literal("luminosity")
]);
const MaskSchema = strictObject({ asset_id: IdSchema, invert: Type.Optional(Type.Literal(true)) });
const common = {
  id: IdSchema, locked: Type.Boolean(), visible: Type.Boolean(),
  x: CoordinateSchema, y: CoordinateSchema, width: SizeSchema, height: SizeSchema, opacity: OpacitySchema,
  rotation: Type.Optional(RotationSchema), flip_x: Type.Optional(Type.Literal(true)), flip_y: Type.Optional(Type.Literal(true)),
  blend: Type.Optional(BlendSchema), mask: Type.Optional(MaskSchema), group_id: Type.Optional(IdSchema)
};
const GroupNameSchema = Type.String({ minLength: 1, maxLength: 64 });
const GroupSchema = strictObject({ id: IdSchema, name: GroupNameSchema, locked: Type.Boolean(), visible: Type.Boolean(), opacity: OpacitySchema });
// The engine also refuses neutral values (1, or a 0 blur) and an empty object.
const adjustRange = (key: keyof typeof IMAGE_ADJUST_LIMITS) => Type.Optional(Type.Number({ minimum: IMAGE_ADJUST_LIMITS[key][0], maximum: IMAGE_ADJUST_LIMITS[key][1] }));
const AdjustSchema = strictObject({ brightness: adjustRange("brightness"), contrast: adjustRange("contrast"), saturation: adjustRange("saturation"), blur: adjustRange("blur") });
const RasterObjectSchema = strictObject({ ...common, kind: Type.Literal("image"), asset_id: IdSchema, fit: FitSchema, adjust: Type.Optional(AdjustSchema) });
const TextObjectSchema = strictObject({
  ...common, kind: Type.Literal("text"), text: TextSchema, font_size: FontSizeSchema, color: ColorSchema, align: AlignSchema, line_height: LineHeightSchema,
  font_id: Type.Optional(IdSchema)
});
// Stops must also be in offset order; the engine refuses that, a schema cannot say it.
const GradientStopsSchema = Type.Array(strictObject({ offset: Type.Number({ minimum: 0, maximum: 1 }), color: ColorSchema }), { minItems: 2, maxItems: 5 });
const GradientSchema = Type.Union([
  strictObject({ type: Type.Literal("linear"), angle: Type.Optional(Type.Number({ minimum: 0, maximum: 360 })), stops: GradientStopsSchema }),
  strictObject({ type: Type.Literal("radial"), stops: GradientStopsSchema })
]);
const RectObjectSchema = strictObject({ ...common, kind: Type.Literal("rect"), color: ColorSchema, radius: RadiusSchema, gradient: Type.Optional(GradientSchema) });
const EllipseObjectSchema = strictObject({ ...common, kind: Type.Literal("ellipse"), color: ColorSchema, gradient: Type.Optional(GradientSchema) });
const SceneObjectSchema = Type.Union([RasterObjectSchema, TextObjectSchema, RectObjectSchema, EllipseObjectSchema]);
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
  fonts: Type.Optional(Type.Array(strictObject({
    id: IdSchema, family: Type.String({ minLength: 1, maxLength: 64 }), file: Type.String({ minLength: 1, maxLength: 160 }),
    sha256: Sha256Schema, bytes: Type.Integer({ minimum: 1, maximum: 20_000_000 }), format: Type.Union([Type.Literal("ttf"), Type.Literal("otf")])
  }), { minItems: 1, maxItems: IMAGE_USER_FONT_LIMIT })),
  // Members are contiguous and every group has one; the engine refuses that, a schema cannot say it.
  groups: Type.Optional(Type.Array(GroupSchema, { minItems: 1, maxItems: IMAGE_GROUP_LIMIT })),
  // Slots are text or image layers of this document; the engine checks that, a schema cannot.
  template: Type.Optional(strictObject({ slots: Type.Array(IdSchema, { maxItems: IMAGE_TEMPLATE_SLOT_LIMIT, uniqueItems: true }) })),
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
  align: Type.Optional(AlignSchema), line_height: Type.Optional(LineHeightSchema), radius: Type.Optional(RadiusSchema),
  font_id: Type.Optional(Type.Union([IdSchema, Type.Null()])),
  rotation: Type.Optional(Type.Union([RotationSchema, Type.Null()])),
  flip_x: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])), flip_y: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  gradient: Type.Optional(Type.Union([GradientSchema, Type.Null()])),
  blend: Type.Optional(Type.Union([BlendSchema, Type.Null()])), mask: Type.Optional(Type.Union([MaskSchema, Type.Null()])),
  adjust: Type.Optional(Type.Union([AdjustSchema, Type.Null()])), group_id: Type.Optional(Type.Union([IdSchema, Type.Null()]))
}, { additionalProperties: false, minProperties: 1 });
const GroupPatchSchema = Type.Object({
  name: Type.Optional(GroupNameSchema), locked: Type.Optional(Type.Boolean()), visible: Type.Optional(Type.Boolean()), opacity: Type.Optional(OpacitySchema)
}, { additionalProperties: false, minProperties: 1 });
const EditOperationSchema = Type.Union([
  strictObject({ type: Type.Literal("update_object"), id: IdSchema, patch: PatchSchema }),
  strictObject({ type: Type.Literal("add_object"), object: Type.Union([TextObjectSchema, RectObjectSchema, EllipseObjectSchema]) }),
  strictObject({ type: Type.Literal("remove_object"), id: IdSchema }),
  strictObject({ type: Type.Literal("reorder_objects"), ids: Type.Array(IdSchema, { minItems: 1, maxItems: L.objects }) }),
  strictObject({ type: Type.Literal("set_canvas"), canvas: CanvasSchema }),
  strictObject({ type: Type.Literal("revert_to"), revision: RevisionSchema }),
  strictObject({ type: Type.Literal("group_objects"), group: strictObject({ id: IdSchema, name: GroupNameSchema }), ids: Type.Array(IdSchema, { minItems: 1, maxItems: L.objects }) }),
  strictObject({ type: Type.Literal("update_group"), id: IdSchema, patch: GroupPatchSchema }),
  strictObject({ type: Type.Literal("ungroup"), id: IdSchema }),
  strictObject({ type: Type.Literal("set_template"), slots: Type.Union([Type.Array(IdSchema, { maxItems: IMAGE_TEMPLATE_SLOT_LIMIT, uniqueItems: true }), Type.Null()]) })
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
  protectedChangedPixels: Type.Optional(Type.Integer({ minimum: 0, maximum: L.pixels })),
  receipt: Type.Optional(strictObject({
    model: Type.String({ minLength: 1, maxLength: 128 }),
    quality: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
    size: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,4}x[1-9][0-9]{0,4}$" })),
    durationMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 86_400_000 }))
  }))
});
const ProjectSummarySchema = strictObject({
  projectId: IdSchema,
  title: Type.String({ minLength: 1, maxLength: L.title }),
  revision: RevisionSchema,
  canvas: CanvasSchema,
  updatedAt: TimestampSchema,
  readyCandidates: Type.Integer({ minimum: 0, maximum: L.candidates }),
  derivedFrom: Type.Optional(strictObject({ projectId: IdSchema, revision: RevisionSchema, preset: Type.Optional(Type.Union(IMAGE_SIZE_PRESETS.map((preset) => Type.Literal(preset)))) })),
  batch: Type.Optional(strictObject({ batchId: IdSchema, row: Type.Integer({ minimum: 1, maximum: IMAGE_BATCH_LIMITS.rows }), projectId: IdSchema, revision: RevisionSchema })),
  template: Type.Optional(Type.Literal(true)),
  fromTemplate: Type.Optional(strictObject({ projectId: IdSchema, revision: RevisionSchema }))
});
const RevisionResultSchema = strictObject({ projectId: IdSchema, revision: RevisionSchema, sha256: Sha256Schema, dryRun: Type.Boolean() });
const ProjectRefSchema = strictObject({ projectId: IdSchema });
const ConversationSchema = strictObject({
  sessionPath: Type.String({ minLength: 1, maxLength: 4096 }),
  sessionFileIdentity: Type.String({ minLength: 1, maxLength: 512 })
});

/** One export set: the source revision plus one file per size preset, or every row of a batch (P5). */
export const IMAGE_EXPORT_SET_MAX_ITEMS = Math.max(IMAGE_SIZE_PRESETS.length + 1, IMAGE_BATCH_LIMITS.rows);

const SizePresetSchema = Type.Union(IMAGE_SIZE_PRESETS.map((preset) => Type.Literal(preset)));

const BrandNameSchema = Type.String({ minLength: 1, maxLength: IMAGE_BRAND_LIMITS.name });
const BrandColorSchema = strictObject({ id: IdSchema, name: BrandNameSchema, value: ColorSchema });
const BrandSpecSchema = strictObject({ id: IdSchema, name: BrandNameSchema, width: Type.Integer({ minimum: 64, maximum: L.edge }), height: Type.Integer({ minimum: 64, maximum: L.edge }),
  max_bytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: 100_000_000 })), background: Type.Optional(Type.Literal("white")) });
const BrandKitSchema = strictObject({
  schema: Type.String({ minLength: 1, maxLength: 64 }), revision: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
  colors: Type.Array(BrandColorSchema, { maxItems: IMAGE_BRAND_LIMITS.colors }),
  fonts: Type.Array(strictObject({ id: IdSchema, family: Type.String({ minLength: 1, maxLength: 64 }), file: Type.String({ minLength: 1, maxLength: 160 }), sha256: Sha256Schema,
    bytes: Type.Integer({ minimum: 1, maximum: 20_000_000 }), format: Type.Union([Type.Literal("ttf"), Type.Literal("otf")]) }), { maxItems: IMAGE_BRAND_LIMITS.fonts }),
  logos: Type.Array(strictObject({ id: IdSchema, name: BrandNameSchema, file: Type.String({ minLength: 1, maxLength: 160 }), render_file: Type.String({ minLength: 1, maxLength: 160 }),
    sha256: Sha256Schema, render_sha256: Sha256Schema, width: Type.Integer({ minimum: 1, maximum: 16_384 }), height: Type.Integer({ minimum: 1, maximum: 16_384 }) }), { maxItems: IMAGE_BRAND_LIMITS.logos }),
  specs: Type.Array(BrandSpecSchema, { maxItems: IMAGE_BRAND_LIMITS.specs })
});
export const ImageCommandPayloadSchemas: Record<keyof ImageCommandPayloads, TSchema> = {
  "image.project.list": strictObject({}),
  "image.project.createFromPhoto": strictObject({
    projectId: IdSchema, attachmentId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }),
    headline: Type.String({ minLength: 1, maxLength: L.text }), title: Type.Optional(Type.String({ minLength: 1, maxLength: L.title }))
  }),
  "image.project.read": strictObject({ projectId: IdSchema, revision: Type.Optional(RevisionSchema) }),
  "image.project.history": ProjectRefSchema,
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
  "image.candidate.discard": strictObject({ projectId: IdSchema, candidateId: IdSchema, summary: SummarySchema }),
  "image.project.conversation.set": strictObject({ projectId: IdSchema, conversation: ConversationSchema }),
  "image.project.checkText": strictObject({ projectId: IdSchema, revision: Type.Optional(RevisionSchema), candidateId: Type.Optional(IdSchema) }),
  "image.project.addAsset": strictObject({ projectId: IdSchema, baseRevision: RevisionSchema,
    attachmentId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }) }),
  "image.project.addFont": strictObject({ projectId: IdSchema, baseRevision: RevisionSchema,
    attachmentId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }) }),
  "image.project.derive": strictObject({ projectId: IdSchema, revision: RevisionSchema,
    presets: Type.Array(SizePresetSchema, { minItems: 1, maxItems: IMAGE_SIZE_PRESETS.length, uniqueItems: true }) }),
  // Each layer once per row; the engine refuses a repeat, a schema cannot say it. `row` is the
  // table's own row number, so refusals and the library name the row the person sees.
  "image.batch.create": strictObject({ projectId: IdSchema, revision: RevisionSchema, rows: Type.Array(strictObject({ row: Type.Integer({ minimum: 1, maximum: IMAGE_BATCH_LIMITS.rows }),
    texts: Type.Array(strictObject({ layer: IdSchema, text: Type.String({ minLength: 1, maxLength: IMAGE_BATCH_LIMITS.characters }) }), { minItems: 1, maxItems: IMAGE_BATCH_LIMITS.texts }) }),
  { minItems: 1, maxItems: IMAGE_BATCH_LIMITS.rows }) }),
  "image.batch.remove": strictObject({ batchId: IdSchema }),
  "image.brand.read": strictObject({}),
  "image.project.useBrandFont": strictObject({ projectId: IdSchema, baseRevision: RevisionSchema, fontId: IdSchema, objectId: IdSchema }),
  "image.project.addBrandLogo": strictObject({ projectId: IdSchema, baseRevision: RevisionSchema, logoId: IdSchema }),
  "image.project.deriveSize": strictObject({ projectId: IdSchema, revision: RevisionSchema, width: Type.Integer({ minimum: L.minCanvasEdge, maximum: L.edge }),
    height: Type.Integer({ minimum: L.minCanvasEdge, maximum: L.edge }), name: BrandNameSchema }),
  "image.brand.edit": strictObject({ baseRevision: Type.Integer({ minimum: 0, maximum: 1_000_000 }), operations: Type.Array(Type.Union([
    strictObject({ type: Type.Literal("set_color"), color: BrandColorSchema }), strictObject({ type: Type.Literal("remove_color"), id: IdSchema }),
    strictObject({ type: Type.Literal("set_spec"), spec: BrandSpecSchema }), strictObject({ type: Type.Literal("remove_spec"), id: IdSchema }),
    strictObject({ type: Type.Literal("remove_font"), id: IdSchema }), strictObject({ type: Type.Literal("remove_logo"), id: IdSchema })
  ]), { minItems: 1, maxItems: 32 }) }),
  "image.brand.addFont": strictObject({ baseRevision: Type.Integer({ minimum: 0, maximum: 1_000_000 }), attachmentId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }) }),
  "image.brand.addLogo": strictObject({ baseRevision: Type.Integer({ minimum: 0, maximum: 1_000_000 }), name: BrandNameSchema,
    attachmentId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }) }),
  "image.template.create": strictObject({ projectId: IdSchema, revision: RevisionSchema }),
  "image.template.instantiate": strictObject({ templateId: IdSchema, projectId: IdSchema, title: Type.String({ minLength: 1, maxLength: L.title }),
    texts: Type.Array(strictObject({ layer: IdSchema, text: TextSchema }), { maxItems: IMAGE_TEMPLATE_SLOT_LIMIT }),
    images: Type.Array(strictObject({ layer: IdSchema, attachmentId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }) }), { maxItems: IMAGE_TEMPLATE_SLOT_LIMIT }) })
};

const BatchRowSchema = Type.Integer({ minimum: 1, maximum: IMAGE_BATCH_LIMITS.rows });
export const ImageCommandResultSchemas: Record<keyof ImageCommandResults, TSchema> = {
  "image.project.list": strictObject({ projects: Type.Array(ProjectSummarySchema, { maxItems: 10_000 }) }),
  "image.project.read": strictObject({ projectId: IdSchema, revision: RevisionSchema, latestRevision: RevisionSchema, sha256: Sha256Schema, document: DocumentSchema,
    conversation: Type.Optional(ConversationSchema) }),
  "image.project.createFromPhoto": RevisionResultSchema,
  "image.project.history": strictObject({ projectId: IdSchema, revisions: Type.Array(strictObject({
    revision: RevisionSchema, author: AuthorSchema, summary: Type.String({ maxLength: 500 }), operationCount: Type.Integer({ minimum: 0, maximum: L.operations }),
    candidateId: Type.Optional(IdSchema), writtenAt: TimestampSchema
  }), { maxItems: L.revisions }) }),
  "image.project.edit": RevisionResultSchema,
  "image.project.render": strictObject({
    projectId: IdSchema, revision: RevisionSchema, candidateId: Type.Optional(IdSchema), pngSha256: Sha256Schema,
    width: Type.Integer({ minimum: 1, maximum: L.edge }), height: Type.Integer({ minimum: 1, maximum: L.edge })
  }),
  "image.candidate.list": strictObject({ projectId: IdSchema, candidates: Type.Array(CandidateSummarySchema, { maxItems: L.candidates }) }),
  "image.candidate.accept": RevisionResultSchema,
  "image.candidate.discard": strictObject({ projectId: IdSchema, candidateId: IdSchema, status: Type.Literal("discarded") }),
  "image.project.conversation.set": ProjectRefSchema,
  "image.project.addAsset": strictObject({ projectId: IdSchema, revision: RevisionSchema, sha256: Sha256Schema, dryRun: Type.Boolean(), assetId: IdSchema }),
  "image.project.checkText": strictObject({ projectId: IdSchema, revision: RevisionSchema, candidateId: Type.Optional(IdSchema),
    texts: Type.Array(strictObject({ objectId: IdSchema, text: TextSchema, read: Type.String({ maxLength: 4000 }), passed: Type.Boolean(),
      contrast: Type.Optional(Type.Number({ minimum: 1, maximum: 21 })), lowContrast: Type.Boolean() }), { maxItems: L.objects }) }),
  "image.project.addFont": strictObject({ projectId: IdSchema, revision: RevisionSchema, sha256: Sha256Schema, dryRun: Type.Boolean(),
    fontId: IdSchema, family: Type.String({ minLength: 1, maxLength: 64 }) }),
  "image.project.derive": strictObject({ projectId: IdSchema, revision: RevisionSchema, results: Type.Array(Type.Union([
    strictObject({ preset: SizePresetSchema, status: Type.Literal("derived"), projectId: IdSchema, title: Type.String({ minLength: 1, maxLength: L.title }), canvas: CanvasSchema,
      shrunkText: Type.Integer({ minimum: 0, maximum: L.objects }) }),
    strictObject({ preset: SizePresetSchema, status: Type.Literal("refused"), reason: Type.String({ minLength: 1, maxLength: 500 }) })
  ]), { maxItems: IMAGE_SIZE_PRESETS.length }) }),
  "image.batch.create": strictObject({ projectId: IdSchema, revision: RevisionSchema, batchId: IdSchema, results: Type.Array(Type.Union([
    strictObject({ row: BatchRowSchema, status: Type.Literal("created"), projectId: IdSchema, title: Type.String({ minLength: 1, maxLength: L.title }),
      shrunkText: Type.Integer({ minimum: 0, maximum: L.objects }) }),
    strictObject({ row: BatchRowSchema, status: Type.Literal("refused"), reason: Type.String({ minLength: 1, maxLength: 500 }) })
  ]), { maxItems: IMAGE_BATCH_LIMITS.rows }) }),
  "image.batch.remove": strictObject({ batchId: IdSchema, removed: Type.Array(IdSchema, { maxItems: IMAGE_BATCH_LIMITS.rows }) }),
  "image.brand.read": BrandKitSchema,
  "image.project.useBrandFont": RevisionResultSchema,
  "image.project.addBrandLogo": strictObject({ projectId: IdSchema, revision: RevisionSchema, sha256: Sha256Schema, dryRun: Type.Boolean(), objectId: IdSchema }),
  "image.project.deriveSize": strictObject({ projectId: IdSchema, revision: RevisionSchema, result: Type.Union([
    strictObject({ status: Type.Literal("derived"), projectId: IdSchema, title: Type.String({ minLength: 1, maxLength: L.title }), canvas: CanvasSchema,
      shrunkText: Type.Integer({ minimum: 0, maximum: L.objects }) }),
    strictObject({ status: Type.Literal("refused"), reason: Type.String({ minLength: 1, maxLength: 500 }) })]) }),
  "image.brand.edit": BrandKitSchema,
  "image.brand.addFont": BrandKitSchema,
  "image.brand.addLogo": BrandKitSchema,
  "image.template.create": strictObject({ projectId: IdSchema, title: Type.String({ minLength: 1, maxLength: L.title }), slots: Type.Array(IdSchema, { maxItems: IMAGE_TEMPLATE_SLOT_LIMIT }) }),
  "image.template.instantiate": Type.Union([strictObject({ status: Type.Literal("created"), projectId: IdSchema }),
    strictObject({ status: Type.Literal("refused"), reason: Type.String({ minLength: 1, maxLength: 500 }) })])
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

/** Preview naming shared by Host (writer) and Main (reader); Main reaches domain policy only through protocol. */
export { imagePreviewRelativePath, isImageId, IMAGE_PROJECT_LIMITS } from "@pi67/domain";

/** Structural check of an engine document before it crosses the Agent port. */
export const isImageDocument = (value: unknown): boolean => Value.Check(DocumentSchema, value);

export { DocumentSchema as ImageDocumentSchema, EditOperationSchema as ImageEditOperationSchema, CandidateStatusSchema as ImageCandidateStatusSchema };
