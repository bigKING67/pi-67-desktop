import type { ImageCandidateListStatus, ImageDocument, ImageEditOperation } from "@pi67/domain";
import { describe, expect, expectTypeOf, it } from "vitest";
import { COMMAND_CONTEXT_SCOPE_REQUIREMENTS } from "./protocol-context.js";
import { CommandPayloadSchemas } from "./command-payload-schemas.js";
import { CommandResultSchemas, EventPayloadSchemas } from "./schemas.js";
import { EVENT_CONTEXT_REQUIREMENTS } from "./event-context.js";
import { ImageCandidateStatusSchema, ImageDocumentSchema, ImageEditOperationSchema } from "./image-schemas.js";
import type { ImageCommandPayloads, ImageEventPayloads } from "./image-command-messages.js";
import { Value, type Static, type TSchema } from "./typebox-schema.js";

const sha = "a".repeat(64);
const canvas = { width: 1000, height: 1000, background: "#e4e8dc" };
const text = { id: "headline", kind: "text", locked: false, visible: true, x: 70, y: 202, width: 480, height: 220, opacity: 1, text: "春日焕新", font_size: 72, color: "#263d30", align: "left", line_height: 1.25 };
const document = {
  schema: "newmoney.image-project.v1", project_id: "spring-poster", title: "春日海报", revision: 2, parent_sha256: sha, canvas,
  assets: [{ id: "background", file: `assets/${sha}.png`, sha256: sha, format: "png", width: 1000, height: 1000, render_file: `assets/${sha}.png`, render_sha256: sha }],
  font: { profile: "noto-cjk-sc-static-v1", family: "Noto Sans CJK SC", file: `fonts/${sha}.otf`, sha256: sha, weight: 400 },
  objects: [
    { id: "background", kind: "image", locked: false, visible: true, x: 0, y: 0, width: 1000, height: 1000, opacity: 1, asset_id: "background", fit: "cover" },
    text,
    { id: "badge", kind: "rect", locked: true, visible: true, x: 10, y: 10, width: 40, height: 40, opacity: 0.5, color: "#ffffff", radius: 8 }
  ],
  change: { author: "agent", summary: "Accept background", operations: ["accept_candidate"], candidate: { id: "pink", sha256: sha } }
};
const check = (schema: TSchema, value: unknown): boolean => Value.Check(schema, value);

// Checked by typecheck: a field added on one side only fails the build.
describe("image protocol mirrors domain types", () => {
  it("documents, edit operations and candidate statuses", () => {
    expectTypeOf<Static<typeof ImageDocumentSchema>>().toEqualTypeOf<ImageDocument>();
    expectTypeOf<Static<typeof ImageEditOperationSchema>>().toEqualTypeOf<ImageEditOperation>();
    expectTypeOf<Static<typeof ImageCandidateStatusSchema>>().toEqualTypeOf<ImageCandidateListStatus>();
  });
});

describe("image protocol schemas", () => {
  it("binds every command and event to the Workspace scope", () => {
    // Image source settings (`image.generation.*`) are App-scope configuration, not project commands.
    const commands = Object.keys(CommandPayloadSchemas).filter((type) => type.startsWith("image.") && !type.startsWith("image.generation."));
    expect(commands.sort()).toEqual(["image.candidate.accept", "image.candidate.discard", "image.candidate.list", "image.project.conversation.set", "image.project.createFromPhoto", "image.project.derive", "image.project.edit", "image.project.history", "image.project.list", "image.project.read", "image.project.render"]);
    for (const type of commands) expect(COMMAND_CONTEXT_SCOPE_REQUIREMENTS[type as keyof ImageCommandPayloads], type).toBe("workspace");
    for (const type of ["image.project.changed", "image.candidate.changed", "image.job.changed"] as (keyof ImageEventPayloads)[]) {
      expect(EVENT_CONTEXT_REQUIREMENTS[type]).toEqual({ session: false, operation: false, requiredScope: "workspace" });
    }
  });

  it("accepts a full engine document and rejects loose or out-of-range fields", () => {
    const read = CommandResultSchemas["image.project.read"];
    const result = { projectId: "spring-poster", revision: 2, latestRevision: 3, sha256: sha, document };
    expect(check(read, result)).toBe(true);
    expect(check(read, { ...result, document: { ...document, parent_sha256: null, change: { author: "system", summary: "Create", operations: ["create"] } } })).toBe(true);
    expect(check(read, { ...result, document: { ...document, extra: 1 } })).toBe(false);
    expect(check(read, { ...result, document: { ...document, objects: [] } })).toBe(false);
    expect(check(read, { ...result, document: { ...document, objects: [{ ...text, kind: "svg" }] } })).toBe(false);
    expect(check(read, { ...result, document: { ...document, objects: [{ ...text, color: "red" }] } })).toBe(false);
    expect(check(read, { ...result, document: { ...document, canvas: { ...canvas, width: 8193 } } })).toBe(false);
    expect(check(read, { ...result, document: { ...document, change: { ...document.change, author: "root" } } })).toBe(false);
    expect(check(read, { ...result, sha256: "A".repeat(64) })).toBe(false);
  });

  it("admits renderer edits but never asset imports, paths or unknown operations", () => {
    const edit = CommandPayloadSchemas["image.project.edit"];
    const base = { projectId: "spring-poster", baseRevision: 2, summary: "改标题" };
    const ok: ImageEditOperation[] = [
      { type: "update_object", id: "headline", patch: { text: "自在新生", y: 180 } },
      { type: "add_object", object: { ...text, id: "price", kind: "text" } as Extract<ImageEditOperation, { type: "add_object" }>["object"] },
      { type: "remove_object", id: "badge" }, { type: "reorder_objects", ids: ["background", "headline"] },
      { type: "set_canvas", canvas }, { type: "revert_to", revision: 1 }
    ];
    expect(check(edit, { ...base, operations: ok, dryRun: true })).toBe(true);
    const rejected: unknown[] = [
      { type: "add_asset", asset: { id: "x", source: "/etc/passwd" } },
      { type: "add_object", object: document.objects[0] },
      { type: "update_object", id: "headline", patch: {} },
      { type: "update_object", id: "headline", patch: { kind: "rect" } },
      { type: "update_object", id: "headline", patch: { source: "/tmp/a.png" } },
      { type: "update_object", id: "../x", patch: { x: 1 } },
      { type: "accept_candidate", candidate_id: "pink" },
      { type: "revert_to", revision: 0 }
    ];
    for (const operation of rejected) expect(check(edit, { ...base, operations: [operation] }), JSON.stringify(operation)).toBe(false);
    expect(check(edit, { ...base, operations: [] })).toBe(false);
    expect(check(edit, { ...base, operations: Array.from({ length: 101 }, () => ok[2]) })).toBe(false);
    expect(check(edit, { ...base, summary: "", operations: ok })).toBe(false);
    expect(check(edit, { ...base, author: "agent", operations: ok })).toBe(false);
  });

  it("bounds render, candidate and listing payloads and results", () => {
    expect(check(CommandPayloadSchemas["image.project.render"], { projectId: "p", previewMax: 640, candidateId: "pink" })).toBe(true);
    expect(check(CommandPayloadSchemas["image.project.render"], { projectId: "p", previewMax: 32 })).toBe(false);
    expect(check(CommandPayloadSchemas["image.project.render"], { projectId: "p", output: "/tmp/x" })).toBe(false);
    expect(check(CommandPayloadSchemas["image.candidate.accept"], { projectId: "p", candidateId: "pink", baseRevision: 1, summary: "采用" })).toBe(true);
    expect(check(CommandPayloadSchemas["image.candidate.accept"], { projectId: "p", candidateId: "pink", summary: "采用" })).toBe(false);
    expect(check(CommandPayloadSchemas["image.project.list"], {})).toBe(true);
    expect(check(CommandPayloadSchemas["image.project.list"], { root: "/" })).toBe(false);
    const candidates = CommandResultSchemas["image.candidate.list"];
    expect(check(candidates, { projectId: "p", candidates: [
      { candidateId: "pink", status: "ready", targetId: "background", mode: "masked", baseRevision: 1, summary: "Pink", outputSha256: sha, generated: true, protectedChangedPixels: 0 },
      { candidateId: "interrupted", status: "incomplete" },
      { candidateId: "gen", status: "ready", generated: true, receipt: { model: "gpt-image-2.5-sunburst", quality: "high", size: "1088x1360", durationMs: 22481 } }
    ] })).toBe(true);
    expect(check(candidates, { projectId: "p", candidates: [{ candidateId: "gen", status: "ready", receipt: { model: "m", size: "1088 by 1360" } }] })).toBe(false);
    expect(check(candidates, { projectId: "p", candidates: [{ candidateId: "gen", status: "ready", receipt: { model: "m", prompt: "secret" } }] })).toBe(false);
    expect(check(candidates, { projectId: "p", candidates: [{ candidateId: "pink", status: "approved" }] })).toBe(false);
    expect(check(CommandPayloadSchemas["image.project.derive"], { projectId: "p", revision: 3, presets: ["1x1", "16x9"] })).toBe(true);
    expect(check(CommandPayloadSchemas["image.project.derive"], { projectId: "p", revision: 3, presets: ["1x1", "1x1"] })).toBe(false);
    expect(check(CommandPayloadSchemas["image.project.derive"], { projectId: "p", revision: 3, presets: ["2x1"] })).toBe(false);
    expect(check(CommandPayloadSchemas["image.project.derive"], { projectId: "p", revision: 3, presets: [] })).toBe(false);
    expect(check(CommandResultSchemas["image.project.derive"], { projectId: "p", revision: 3, results: [
      { preset: "4x5", status: "derived", projectId: "p-4x5", title: "海报 · 4:5", canvas, shrunkText: 1 },
      { preset: "16x9", status: "refused", reason: "文字放不下" }
    ] })).toBe(true);
    expect(check(CommandResultSchemas["image.project.derive"], { projectId: "p", revision: 3, results: [{ preset: "4x5", status: "derived", projectId: "../x", title: "t", canvas, shrunkText: 0 }] })).toBe(false);
    expect(check(CommandResultSchemas["image.project.list"], { projects: [{ projectId: "p", title: "海报", revision: 1, canvas, updatedAt: 1, readyCandidates: 3 }] })).toBe(true);
    expect(check(CommandResultSchemas["image.project.render"], { projectId: "p", revision: 1, pngSha256: sha, width: 640, height: 640 })).toBe(true);
    expect(check(CommandResultSchemas["image.candidate.discard"], { projectId: "p", candidateId: "pink", status: "accepted" })).toBe(false);
  });

  it("validates change, candidate and job events", () => {
    expect(check(EventPayloadSchemas["image.project.changed"], { projectId: "p", revision: 3, sha256: sha, author: "agent" })).toBe(true);
    expect(check(EventPayloadSchemas["image.candidate.changed"], { projectId: "p", candidateId: "pink", status: "stale" })).toBe(true);
    expect(check(EventPayloadSchemas["image.job.changed"], { projectId: "p", jobId: "job-1", kind: "generate", state: "running", progress: 0.4 })).toBe(true);
    expect(check(EventPayloadSchemas["image.job.changed"], { projectId: "p", jobId: "job-1", kind: "generate", state: "running", progress: 1.5 })).toBe(false);
    expect(check(EventPayloadSchemas["image.job.changed"], { projectId: "p", jobId: "job-1", kind: "upload", state: "running" })).toBe(false);
  });
});
