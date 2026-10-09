import * as fs from "node:fs/promises";
import path from "node:path";
import { Type, type TSchema } from "typebox";
import { IMAGE_PROVIDER_ID, imageCandidateActions } from "@pi67/domain";
import type { ImageDocument, ImageGenerator } from "@pi67/image-engine";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiImageGenerator, type ImageRegistry } from "./image-workbench-generator.js";

type ToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];
type ToolContext = Parameters<ToolDefinition["execute"]>[4];
type ToolResult = Awaited<ReturnType<ToolDefinition["execute"]>>;
type Params = Record<string, unknown>;

const isObject = (value: unknown): value is Params => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }], details: value as never });
const str = (params: Params, key: string): string => { const value = params[key]; if (typeof value !== "string" || !value) throw new Error(`${key} is required`); return value; };
const int = (params: Params, key: string): number => { const value = params[key]; if (!Number.isInteger(value)) throw new Error(`${key} must be an integer`); return value as number; };
// Sharp, resvg and the font load on the first image call, never with the session.
const loadEngine = () => import("@pi67/image-engine");
type Engine = Awaited<ReturnType<typeof loadEngine>>;
/** Local files the tools read resolve against the session's Workspace, as the safety policy does. */
const local = (cwd: string, value: unknown): unknown => typeof value === "string" ? path.resolve(cwd, value) : value;

/** A compact view the model can reason about without re-reading revision files. */
function documentSummary(doc: ImageDocument, latestRevision: number): Record<string, unknown> {
  return {
    project_id: doc.project_id, title: doc.title, revision: doc.revision, latest_revision: latestRevision, canvas: doc.canvas,
    objects: doc.objects.map((object) => ({
      id: object.id, kind: object.kind, locked: object.locked, visible: object.visible, box: [object.x, object.y, object.width, object.height], opacity: object.opacity,
      ...(object.kind === "text" ? { text: object.text, font_size: object.font_size, color: object.color, align: object.align, line_height: object.line_height } : {}),
      ...(object.kind === "image" ? { asset_id: object.asset_id, fit: object.fit } : {}),
      ...(object.kind === "rect" ? { color: object.color, radius: object.radius } : {})
    })),
    assets: doc.assets.map((asset) => ({ id: asset.id, width: asset.width, height: asset.height }))
  };
}

const SURFACES: Readonly<Record<string, string>> = { "openai-images": "openai.image_api", "ark-images": "volcengine.ark_image_api" };

/**
 * Resolves `newmoney-images-<source>/<model>` to an authenticated Pi image model
 * from the user's image sources (ADR 0010 decision 14) and the job profile and
 * execution surface it runs under. Nothing is written before this succeeds.
 */
async function sourceModel(engine: Engine, ctx: Pick<ToolContext, "modelRegistry">, value: string): Promise<{ generator: ImageGenerator; modelId: string; profile: string; surface: string }> {
  const slash = value.indexOf("/"), provider = value.slice(0, slash), modelId = value.slice(slash + 1);
  if (slash < 1 || !provider.startsWith(`${IMAGE_PROVIDER_ID}-`)) throw new Error("model must be <provider>/<model> of an image source listed by image_models (Providers named newmoney-images-…)");
  const model = (await ctx.modelRegistry.getAvailableOfType("image", provider)).find((candidate) => candidate.id === modelId);
  if (!model) throw new Error("IMAGE_MODEL_UNAVAILABLE: that image source model is not configured or has no key; add it in Settings → 图像生成.");
  const surface = SURFACES[model.api];
  const profile = surface === undefined ? undefined : engine.profileForModel(surface, modelId);
  if (surface === undefined || profile === undefined) throw new Error("IMAGE_MODEL_UNSUPPORTED: this image API is not supported by the image engine.");
  return { generator: createPiImageGenerator(ctx.modelRegistry as unknown as ImageRegistry, model), modelId, profile, surface };
}

const projectId = Type.String({ description: "Image project id (letters, digits, - and _; starts with a letter)." });
const optional = <T extends TSchema>(schema: T) => Type.Optional(schema);

export function imageTools(): ToolDefinition[] {
  return [
    {
      name: "image_project_create_from_photo", label: "Create image project",
      description: "Create an editable image project from one local product photo. The photo stays locked at native size; headline, brand and caption become editable text objects.",
      promptSnippet: "Create an editable image project from a local photo",
      parameters: Type.Object({
        project_id: projectId, source: Type.String({ description: "Path of an opaque PNG, JPEG or WebP photo, absolute or relative to the Workspace." }),
        headline: Type.String(), brand: optional(Type.String()), caption: optional(Type.String()), title: optional(Type.String()),
        template: optional(Type.Union([Type.Literal("brand-detail"), Type.Literal("xiaohongshu-cover")])),
        background: optional(Type.String({ description: "#RRGGBB canvas background." })), dry_run: optional(Type.Boolean())
      }),
      async execute(_id, raw, _signal, _update, ctx) {
        const params = raw as Params, id = str(params, "project_id"), engine = await loadEngine(), root = engine.projectRoot(ctx.cwd, id);
        const brief: Params = { project_id: id, source: local(ctx.cwd, str(params, "source")), headline: str(params, "headline") };
        for (const key of ["brand", "caption", "title", "template", "background"]) if (params[key] !== undefined) brief[key] = params[key];
        // The engine needs the container folder even for a dry run; only that empty folder is created.
        await engine.ensureProjectParent(root);
        const created = await engine.createPhotoProject(root, brief, { dryRun: params.dry_run === true });
        return text({ ...documentSummary(created.document, created.document.revision), sha256: created.sha256, dry_run: created.dry_run === true, layout: created.layout });
      }
    },
    {
      name: "image_project_read", label: "Read image project",
      description: "Read an image project's current or historical revision: canvas, objects (id, kind, box, text) and assets.",
      promptSnippet: "Read an image project's objects and revision",
      promptGuidelines: ["Read the project before editing; submit edits against the revision you read."],
      parameters: Type.Object({ project_id: projectId, revision: optional(Type.Integer({ minimum: 1 })) }),
      async execute(_id, raw, _signal, _update, ctx) {
        const params = raw as Params, engine = await loadEngine();
        const project = await engine.readProject(engine.projectRoot(ctx.cwd, str(params, "project_id")), { revision: params.revision as number | undefined });
        return text({ ...documentSummary(project.document, project.latest_revision), sha256: project.sha256 });
      }
    },
    {
      name: "image_project_edit", label: "Edit image project",
      description: "Apply one batch of object edits as a new revision: update_object, add_object, remove_object, reorder_objects, set_canvas, add_asset, revert_to. Use dry_run first for layout changes. Text is set exactly; never ask an image model to draw copy, prices or logos.",
      promptSnippet: "Edit image project objects as one revision",
      promptGuidelines: [
        "Put copy, prices and logos in text or image objects instead of generated pixels.",
        "Change one main variable per iteration and keep locked objects untouched.",
        "A revision conflict means someone else edited the project: read it again and decide before retrying."
      ],
      parameters: Type.Object({
        project_id: projectId, base_revision: Type.Integer({ minimum: 1 }), summary: Type.String({ minLength: 1, maxLength: 500 }),
        operations: Type.Array(Type.Any(), { minItems: 1, maxItems: 100 }), dry_run: optional(Type.Boolean())
      }),
      async execute(_id, raw, _signal, _update, ctx) {
        const params = raw as Params, engine = await loadEngine();
        const result = await engine.editBatch(engine.projectRoot(ctx.cwd, str(params, "project_id")), {
          base_revision: int(params, "base_revision"), author: "agent", summary: str(params, "summary"), operations: params.operations
        }, { dryRun: params.dry_run === true });
        return text({ revision: result.document.revision, sha256: result.sha256, dry_run: result.dry_run === true });
      }
    },
    {
      name: "image_render", label: "Render image",
      description: "Render a revision or a candidate. preview returns a 640px image you can inspect; export writes a full-size PNG and SVG with a receipt.",
      promptSnippet: "Render an image project preview or export",
      promptGuidelines: ["Look at the actual preview before claiming a visual result; a completed render is not visual approval."],
      parameters: Type.Object({
        project_id: projectId, mode: Type.Union([Type.Literal("preview"), Type.Literal("export")]),
        revision: optional(Type.Integer({ minimum: 1 })), candidate_id: optional(Type.String())
      }),
      async execute(_id, raw, signal, _update, ctx) {
        const params = raw as Params, id = str(params, "project_id"), mode = params.mode === "export" ? "export" : "preview", engine = await loadEngine();
        const output = await engine.workDirectory(ctx.cwd, id, mode);
        const { receipt } = await engine.renderProject(engine.projectRoot(ctx.cwd, id), output, {
          revision: params.revision as number | undefined, candidateId: params.candidate_id as string | undefined, previewMax: mode === "preview" ? 640 : 0, signal
        });
        const summary = { output, revision: receipt.revision, png: receipt.outputs?.png, visual_quality: receipt.visual_quality };
        if (mode === "export") return text(summary);
        const png = await fs.readFile(path.join(output, "image.png"));
        return { content: [{ type: "text", text: JSON.stringify(summary) }, { type: "image", mimeType: "image/png", data: png.toString("base64") }], details: summary as never };
      }
    },
    {
      name: "image_candidates", label: "List image candidates",
      description: "List staged candidates with status (ready, stale, accepted, discarded, decision_pending) and what may be done with each.",
      promptSnippet: "List an image project's staged candidates",
      parameters: Type.Object({ project_id: projectId }),
      async execute(_id, raw, _signal, _update, ctx) {
        const engine = await loadEngine();
        const candidates = await engine.listCandidates(engine.projectRoot(ctx.cwd, str(raw as Params, "project_id")));
        return text(candidates.map((item) => "candidate" in item
          ? { candidate_id: item.candidate.id, status: item.status, target_id: item.candidate.target_id, mode: item.candidate.mode, base_revision: item.candidate.base_revision,
            summary: item.candidate.summary, protected_changed_pixels: item.candidate.qa?.protected_changed_pixels ?? null, actions: imageCandidateActions(item.status) }
          : { candidate_id: item.candidate_id, status: item.status, error: item.error }));
      }
    },
    {
      name: "image_candidate_decide", label: "Accept or discard candidate",
      description: "Accept a ready candidate as a new revision, or discard it. Decisions are final.",
      promptSnippet: "Accept or discard a staged image candidate",
      promptGuidelines: ["Accept or discard only when the user decided or explicitly delegated the choice; otherwise present the candidates and ask."],
      parameters: Type.Object({
        project_id: projectId, candidate_id: Type.String(), decision: Type.Union([Type.Literal("accept"), Type.Literal("discard")]),
        summary: Type.String({ minLength: 1, maxLength: 500 }), base_revision: optional(Type.Integer({ minimum: 1 }))
      }),
      async execute(_id, raw, _signal, _update, ctx) {
        const params = raw as Params, engine = await loadEngine(), root = engine.projectRoot(ctx.cwd, str(params, "project_id"));
        const input = { candidate_id: str(params, "candidate_id"), author: "agent", summary: str(params, "summary") };
        if (params.decision === "discard") return text(await engine.discardCandidate(root, input));
        const result = await engine.acceptCandidate(root, { ...input, base_revision: int(params, "base_revision") });
        return text({ status: "accepted", revision: result.document.revision, sha256: result.sha256 });
      }
    },
    {
      name: "image_generate", label: "Generate image candidate",
      description: "Run one Image Job v2 on a model from the user's image sources and stage the result as a candidate for one image object. Nothing is accepted automatically; masked edits keep protected pixels byte-identical. The job's provider_profile and execution_surface are filled from the model.",
      promptSnippet: "Generate or edit one image layer through the configured Pi image model",
      promptGuidelines: [
        "Use this for an image project's layer; for a one-off image in conversation with no project, use generate_image.",
        "Each call is one paid request and is never retried automatically; inspect the candidate before generating again.",
        "Edits need a change list and a preserve list; reference images need an explicit role."
      ],
      parameters: Type.Object({
        project_id: projectId, candidate_id: Type.String(), target_id: Type.String(), base_revision: Type.Integer({ minimum: 1 }),
        model: Type.String({ minLength: 3, maxLength: 200, description: "<provider>/<model> from image_models, Provider named newmoney-images-<source>." }),
        job: Type.Any({ description: "creative-craft.image-job.v2 object (declared_status ready, single_turn, one PNG)." }),
        references: optional(Type.Array(Type.Object({ asset_id: Type.String(), source: Type.String() }), { maxItems: 3 })),
        edit: optional(Type.Object({
          context: Type.Object({ x: Type.Integer(), y: Type.Integer(), width: Type.Integer(), height: Type.Integer() }),
          generation_mask: Type.String(), protection_mask: Type.String(), blend_mask: Type.String()
        })),
        output_policy: optional(Type.Union([Type.Literal("strict"), Type.Literal("resize_to_target")]))
      }),
      async execute(_id, raw, signal, _update, ctx) {
        const params = raw as Params, id = str(params, "project_id"), engine = await loadEngine();
        const { generator, modelId, profile, surface } = await sourceModel(engine, ctx, str(params, "model"));
        const job = isObject(params.job) ? { ...params.job, provider_profile: profile, execution_surface: surface } : params.job;
        const directory = await engine.workDirectory(ctx.cwd, id, "job");
        await fs.mkdir(directory);
        const jobPath = path.join(directory, "job.json");
        await fs.writeFile(jobPath, JSON.stringify(job ?? null), { flag: "wx" });
        const spec: Params = { job: jobPath, candidate_id: str(params, "candidate_id"), target_id: str(params, "target_id"),
          base_revision: int(params, "base_revision"), model: modelId,
          references: Array.isArray(params.references) ? params.references.map((ref: Params) => ({ ...ref, source: local(ctx.cwd, ref.source) })) : params.references ?? [] };
        if (params.edit !== undefined) {
          const edit = params.edit as Params;
          spec.edit = { ...edit, generation_mask: local(ctx.cwd, edit.generation_mask), protection_mask: local(ctx.cwd, edit.protection_mask), blend_mask: local(ctx.cwd, edit.blend_mask) };
        }
        if (params.output_policy !== undefined) spec.output_policy = params.output_policy;
        const result = await engine.executeProvider(engine.projectRoot(ctx.cwd, id), spec, { generator, signal, operator: "agent" });
        if (result.status === "dry_run") return text(result);
        return text({ candidate_id: result.candidate.candidate.id, status: result.candidate.status, outcome: result.receipt.outcome,
          model: result.receipt.model, protected_changed_pixels: result.candidate.candidate.qa?.protected_changed_pixels ?? null, job: result.job });
      }
    }
  ];
}
