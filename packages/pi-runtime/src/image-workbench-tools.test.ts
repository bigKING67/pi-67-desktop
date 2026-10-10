import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, onTestFinished } from "vitest";
import { IMAGE_LIBRARY_MARKER } from "@pi67/domain";
import { projectRoot, readProject } from "@pi67/image-engine";
import { imageTools } from "./image-workbench-tools.js";
import type { GenerateImages } from "./image-workbench-openai-images.js";

type Tool = ReturnType<typeof imageTools>[number];
type Model = Parameters<GenerateImages>[0];
const imageModel = (id: string, api = "openai-images") => ({ id, provider: "newmoney-images-gateway", api, baseUrl: "https://images.example/v1" }) as Model;

async function workspace(): Promise<string> {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "image-tools-")));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
function harness(cwd: string, options: { available?: Model[]; image?: Buffer } = {}) {
  const generated: unknown[] = [];
  const modelRegistry = {
    getAvailableOfType: (_type: string, provider: string) => Promise.resolve((options.available ?? []).filter((model) => model.provider === provider)),
    generateImages: (...args: unknown[]) => {
      generated.push(args);
      return Promise.resolve({ api: "openai-images", provider: "newmoney-images", model: "gpt-image-2.5-sunburst", stopReason: "stop", timestamp: 1,
        output: options.image ? [{ type: "image", mimeType: "image/png", data: options.image.toString("base64") }] : [] });
    }
  };
  const tools = new Map(imageTools().map((tool) => [tool.name, tool] as const));
  const call = async (name: string, params: Record<string, unknown>) => {
    const tool = tools.get(name) as Tool;
    return tool.execute("call-1", params as never, undefined, undefined, { cwd, modelRegistry } as never);
  };
  const json = async (name: string, params: Record<string, unknown>) => {
    const result = await call(name, params);
    const first = result.content[0];
    return JSON.parse(first?.type === "text" ? first.text : "null") as Record<string, unknown>;
  };
  return { call, json, generated, names: [...tools.keys()] };
}
const job = (overrides: Record<string, unknown> = {}) => ({
  schema_version: "creative-craft.image-job.v2", job_id: "warm-background", brief_id: "brief-1", direction_id: "direction-1", selected_route_id: "route-1",
  declared_status: "ready", provider_profile: "openai.gpt-image-2.5-sunburst.2026-09-08", execution_surface: "openai.image_api", task_type: "generate",
  execution_mode: "single_turn", intended_use: "Warm studio background", asset_refs: [],
  canvas: { size: "1024x1024", quality: "low", format: "png", compression: null, background: "opaque", variants: 1 },
  prompt: { scene: "Warm studio", subject: "Empty tabletop", composition: "Centered", lighting: "Soft window light", materials_style: "Matte",
    exact_text: [], references: [], change: [], preserve: [], constraints: [], exclude: [] },
  inspection: ["brief adherence"], rights: { status: "CLEARED", notes: "" }, ...overrides
});

describe("image workbench tools", { timeout: 120_000 }, () => {
  it("registers seven tools", () => {
    expect(harness("/tmp").names).toEqual(["image_project_create_from_photo", "image_project_read", "image_project_edit", "image_render", "image_candidates", "image_candidate_decide", "image_generate"]);
  });

  it("creates, reads, edits, renders, generates, lists and accepts through the engine", async () => {
    const cwd = await workspace();
    const photo = path.join(cwd, "photo.png");
    await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#d8c8b0" } }).png().toFile(photo);
    const proposed = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#f0e0c8" } }).png().toBuffer();
    const t = harness(cwd, { available: [imageModel("gpt-image-2.5-sunburst")], image: proposed });

    const dry = await t.json("image_project_create_from_photo", { project_id: "poster", source: photo, headline: "春日焕新", dry_run: true });
    expect(dry.dry_run).toBe(true);
    await expect(fs.stat(path.join(cwd, ".newmoney/images/poster"))).rejects.toMatchObject({ code: "ENOENT" });
    const created = await t.json("image_project_create_from_photo", { project_id: "poster", source: photo, headline: "春日焕新", brand: "GROLAND" });
    expect(created.revision).toBe(1);
    expect(await fs.stat(path.join(cwd, ".newmoney/images/poster/revisions"))).toBeTruthy();

    const read = await t.json("image_project_read", { project_id: "poster" });
    expect((read.objects as { id: string }[]).map((object) => object.id)).toEqual(["photo", "brand", "headline"]);
    expect(read.latest_revision).toBe(1);

    expect((await t.json("image_project_edit", { project_id: "poster", base_revision: 1, summary: "改标题", operations: [{ type: "update_object", id: "headline", patch: { text: "自在新生" } }] })).revision).toBe(2);
    // Fonts are the person's to add: the Agent's schema has no add_font, and read lists none yet.
    const font = new URL("../../image-engine/src/test-support/fonts/KaTeX_SansSerif-Regular.ttf", import.meta.url).pathname;
    await expect(t.call("image_project_edit", { project_id: "poster", base_revision: 2, summary: "加字体", operations: [{ type: "add_font", font: { id: "brand", source: font } }] }))
      .rejects.toThrow(/FONTS_ARE_ADDED_BY_THE_PERSON/u);
    expect((await t.json("image_project_read", { project_id: "poster" })).fonts).toEqual([]);
    await expect(t.call("image_project_edit", { project_id: "poster", base_revision: 1, summary: "过期", operations: [{ type: "update_object", id: "headline", patch: { text: "x" } }] }))
      .rejects.toThrow(/Revision conflict/);
    expect((await t.json("image_project_edit", { project_id: "poster", base_revision: 2, summary: "解锁照片", operations: [{ type: "update_object", id: "photo", patch: { locked: false } }] })).revision).toBe(3);

    const preview = await t.call("image_render", { project_id: "poster", mode: "preview" });
    expect(preview.content.map((item) => item.type)).toEqual(["text", "image"]);
    const exported = await t.json("image_render", { project_id: "poster", mode: "export" });
    expect((exported.png as { width: number }).width).toBe(1024); expect(exported.visual_quality).toBe("UNVERIFIED");
    expect(String(exported.output).startsWith(path.join(cwd, ".newmoney/image-work/poster/export-"))).toBe(true);

    // The job names another profile; the chosen source model decides the profile and surface.
    const generated = await t.json("image_generate", { project_id: "poster", candidate_id: "warm", target_id: "photo", base_revision: 3,
      model: "newmoney-images-gateway/gpt-image-2.5-sunburst", job: job({ provider_profile: "openai.gpt-image-2.5-flare.2026-09-08" }) });
    expect(generated).toMatchObject({ candidate_id: "warm", status: "ready", outcome: "succeeded", model: "gpt-image-2.5-sunburst" });
    expect(t.generated).toHaveLength(1);
    expect((await readProject(projectRoot(cwd, "poster"))).document.revision).toBe(3);

    const listed = await t.call("image_candidates", { project_id: "poster" });
    const candidates = listed.details as unknown as { candidate_id: string; status: string; actions: { accept: boolean } }[];
    expect(candidates).toEqual([expect.objectContaining({ candidate_id: "warm", status: "ready", actions: expect.objectContaining({ accept: true }) })]);

    expect(await t.json("image_candidate_decide", { project_id: "poster", candidate_id: "warm", decision: "accept", base_revision: 3, summary: "用户选定暖色背景" }))
      .toMatchObject({ status: "accepted", revision: 4 });
    const history = await readProject(projectRoot(cwd, "poster"));
    expect(history.document.change).toMatchObject({ author: "agent", operations: ["accept_candidate"] });
  });

  it("lets the Agent turn and mirror an object, read it back and straighten it", async () => {
    const cwd = await workspace();
    await sharp({ create: { width: 640, height: 640, channels: 3, background: "#d8c8b0" } }).png().toFile(path.join(cwd, "photo.png"));
    const t = harness(cwd);
    await t.json("image_project_create_from_photo", { project_id: "poster", source: "photo.png", headline: "春日" });
    expect((await t.json("image_project_edit", { project_id: "poster", base_revision: 1, summary: "斜放标题", operations: [{ type: "update_object", id: "headline", patch: { rotation: -8, flip_x: true } }] })).revision).toBe(2);
    const turned = (await t.json("image_project_read", { project_id: "poster" })).objects as { id: string; rotation?: number; flip_x?: boolean }[];
    expect(turned.find((object) => object.id === "headline")).toMatchObject({ rotation: -8, flip_x: true });
    expect((await t.json("image_project_edit", { project_id: "poster", base_revision: 2, summary: "摆正", operations: [{ type: "update_object", id: "headline", patch: { rotation: null, flip_x: null } }] })).revision).toBe(3);
    expect(((await t.json("image_project_read", { project_id: "poster" })).objects as { id: string }[]).find((object) => object.id === "headline")).not.toHaveProperty("rotation");
    // And add an ellipse with a gradient, which reads back with its fill.
    const ring = { id: "ring", kind: "ellipse", locked: false, visible: true, x: 10, y: 10, width: 80, height: 80, opacity: 1, color: "#ff0000",
      gradient: { type: "linear", angle: 0, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#ffffff" }] } };
    expect((await t.json("image_project_edit", { project_id: "poster", base_revision: 3, summary: "加圆", operations: [{ type: "add_object", object: ring }] })).revision).toBe(4);
    expect(((await t.json("image_project_read", { project_id: "poster" })).objects as { id: string }[]).find((object) => object.id === "ring"))
      .toMatchObject({ kind: "ellipse", color: "#ff0000", gradient: { type: "linear", angle: 0 } });
    // And adjust the (unlocked) photo, which reads back with its adjustments.
    const photo = ((await t.json("image_project_read", { project_id: "poster" })).objects as { id: string; kind: string }[]).find((object) => object.kind === "image")!;
    await t.json("image_project_edit", { project_id: "poster", base_revision: 4, summary: "解锁", operations: [{ type: "update_object", id: photo.id, patch: { locked: false } }] });
    expect((await t.json("image_project_edit", { project_id: "poster", base_revision: 5, summary: "调暗", operations: [{ type: "update_object", id: photo.id, patch: { adjust: { brightness: 0.8, blur: 2 } } }] })).revision).toBe(6);
    expect(((await t.json("image_project_read", { project_id: "poster" })).objects as { id: string }[]).find((object) => object.id === photo.id))
      .toMatchObject({ adjust: { brightness: 0.8, blur: 2 } });
    // And group the headline with the ring, which reads back as a group.
    expect((await t.json("image_project_edit", { project_id: "poster", base_revision: 6, summary: "编组", operations: [{ type: "group_objects", group: { id: "title-set", name: "标题" }, ids: ["headline", "ring"] }] })).revision).toBe(7);
    const grouped = await t.json("image_project_read", { project_id: "poster" });
    expect(grouped.groups).toEqual([{ id: "title-set", name: "标题", locked: false, visible: true, opacity: 1 }]);
    expect((grouped.objects as { id: string }[]).find((object) => object.id === "ring")).toMatchObject({ group_id: "title-set" });
  });

  it("resolves an imported asset against the Workspace, not the Host's own directory", async () => {
    const cwd = await workspace();
    await sharp({ create: { width: 640, height: 640, channels: 3, background: "#d8c8b0" } }).png().toFile(path.join(cwd, "photo.png"));
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "#b5452f" } }).png().toFile(path.join(cwd, "logo.png"));
    const t = harness(cwd);
    await t.json("image_project_create_from_photo", { project_id: "poster", source: "photo.png", headline: "春日" });
    expect((await t.json("image_project_edit", { project_id: "poster", base_revision: 1, summary: "加角标素材",
      operations: [{ type: "add_asset", asset: { id: "logo", source: "logo.png" } }] })).revision).toBe(2);
    expect((await readProject(projectRoot(cwd, "poster"))).document.assets.map((asset) => asset.id)).toContain("logo");
  });

  it("builds the job from a plain instruction and refuses repairable mistakes before any request", async () => {
    const cwd = await workspace();
    const photo = path.join(cwd, "photo.png");
    await sharp({ create: { width: 800, height: 600, channels: 3, background: "#d8c8b0" } }).png().toFile(photo);
    const proposed = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#f0e0c8" } }).png().toBuffer();
    const t = harness(cwd, { available: [imageModel("gpt-image-2.5-sunburst")], image: proposed });
    await t.json("image_project_create_from_photo", { project_id: "poster", source: photo, headline: "春日" });
    const model = "newmoney-images-gateway/gpt-image-2.5-sunburst";
    const intent = { project_id: "poster", target_id: "photo", model, instruction: "把背景换成暖色影棚", preserve: ["商品和包装"] };

    await expect(t.call("image_generate", intent)).rejects.toThrow(/TARGET_LOCKED: photo is locked/);
    await t.json("image_project_edit", { project_id: "poster", base_revision: 1, summary: "解锁", operations: [{ type: "update_object", id: "photo", patch: { locked: false } }] });
    await expect(t.call("image_generate", { ...intent, base_revision: 1 })).rejects.toThrow(/REVISION_CONFLICT: the project is at revision 2/);
    await expect(t.call("image_generate", { ...intent, target_id: "headline" })).rejects.toThrow(/TARGET_NOT_IMAGE/);
    expect(t.generated).toHaveLength(0);

    // No job, candidate id or revision: the tool sizes the job to the layer and attaches the current image.
    const edited = await t.json("image_generate", intent);
    expect(edited).toMatchObject({ status: "ready", outcome: "succeeded", model: "gpt-image-2.5-sunburst" });
    expect(String(edited.candidate_id)).toMatch(/^cand-[a-z0-9]+-[a-z0-9]{4}$/u);
    const [, context, options] = t.generated[0] as [unknown, { input?: unknown[]; prompt?: string }, Record<string, unknown>];
    expect(JSON.stringify(context)).toContain("把背景换成暖色影棚");
    expect(JSON.stringify(context)).toContain("image/png");
    expect(JSON.stringify(options ?? {})).not.toContain("UNVERIFIED");

    const fresh = await t.json("image_generate", { ...intent, mode: "generate", instruction: "暖色影棚里的空桌面", candidate_id: "fresh" });
    expect(fresh).toMatchObject({ candidate_id: "fresh", status: "ready" });
    expect(JSON.stringify(t.generated[1])).not.toContain("image/png\",\"data");
    expect((await readProject(projectRoot(cwd, "poster"))).document.revision).toBe(2);
  });

  it("sends project images as role references after the edited one and refuses ones it cannot use", async () => {
    const cwd = await workspace();
    await sharp({ create: { width: 800, height: 600, channels: 3, background: "#d8c8b0" } }).png().toFile(path.join(cwd, "photo.png"));
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "#b5452f" } }).png().toFile(path.join(cwd, "mood.png"));
    const proposed = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#f0e0c8" } }).png().toBuffer();
    const t = harness(cwd, { available: [imageModel("gpt-image-2.5-sunburst")], image: proposed });
    await t.json("image_project_create_from_photo", { project_id: "poster", source: "photo.png", headline: "春日" });
    await t.json("image_project_edit", { project_id: "poster", base_revision: 1, summary: "加参考", operations: [{ type: "add_asset", asset: { id: "mood", source: "mood.png" } }] });
    await t.json("image_project_edit", { project_id: "poster", base_revision: 2, summary: "解锁", operations: [{ type: "update_object", id: "photo", patch: { locked: false } }] });
    const intent = { project_id: "poster", target_id: "photo", model: "newmoney-images-gateway/gpt-image-2.5-sunburst", instruction: "按参考图换成同样的色调" };
    const photoAsset = (await readProject(projectRoot(cwd, "poster"))).document.assets[0]!.id;

    await expect(t.call("image_generate", { ...intent, references: [{ asset_id: "nope", role: "keep-style" }] })).rejects.toThrow(/REFERENCE_NOT_FOUND/);
    await expect(t.call("image_generate", { ...intent, references: [{ asset_id: photoAsset, role: "keep-subject" }] })).rejects.toThrow(/REFERENCE_IS_TARGET/);
    await expect(t.call("image_generate", { ...intent, references: [{ asset_id: "mood" }] })).rejects.toThrow(/REFERENCE_ROLE_REQUIRED/);
    await expect(t.call("image_generate", { ...intent, mode: "generate", references: [{ asset_id: "mood", role: "keep-style" }] })).rejects.toThrow(/REFERENCES_NEED_EDIT/);
    await expect(t.call("image_generate", { ...intent, references: [{ asset_id: "mood", role: "keep-style" }, { asset_id: "mood", role: "take-composition" }] })).rejects.toThrow(/DUPLICATE_REFERENCE/);
    await expect(t.call("image_generate", { project_id: "poster", target_id: "photo", model: intent.model, job: job(), references: [{ asset_id: "mood" }] })).rejects.toThrow(/REFERENCE_SOURCE_REQUIRED/);
    expect(t.generated).toHaveLength(0);

    const edited = await t.json("image_generate", { ...intent, candidate_id: "toned", references: [{ asset_id: "mood", role: "keep-style" }] });
    expect(edited).toMatchObject({ candidate_id: "toned", status: "ready", outcome: "succeeded" });
    const [, context] = t.generated[0] as [unknown, { messages?: unknown }];
    expect(JSON.stringify(context).match(/image\/png/gu)).toHaveLength(2);
    const written = JSON.parse(await fs.readFile(path.join(projectRoot(cwd, "poster"), "jobs/toned/job.json"), "utf8")) as {
      asset_refs: string[]; prompt: { references: { asset_id: string; role: string }[] } };
    expect(written.asset_refs).toEqual([photoAsset, "mood"]);
    expect(written.prompt.references[1]).toEqual({ asset_id: "mood", role: "match this image's style, palette and lighting", preserve: [] });
  });

  it("refuses generation before writing anything when the source model is unknown, unavailable or not an image source", async () => {
    const cwd = await workspace();
    const photo = path.join(cwd, "photo.png");
    await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#d8c8b0" } }).png().toFile(photo);
    const t = harness(cwd, { available: [imageModel("gpt-image-2.5-flare")] });
    await t.json("image_project_create_from_photo", { project_id: "poster", source: photo, headline: "春日" });
    await t.json("image_project_edit", { project_id: "poster", base_revision: 1, summary: "解锁", operations: [{ type: "update_object", id: "photo", patch: { locked: false } }] });
    const generate = (model: string) => t.call("image_generate", { project_id: "poster", candidate_id: "warm", target_id: "photo", base_revision: 2, model, job: job() });
    await expect(generate("newmoney-images-gateway/gpt-image-2.5-sunburst")).rejects.toThrow(/IMAGE_MODEL_UNAVAILABLE/);
    await expect(generate("openrouter-images/flux")).rejects.toThrow(/image source/);
    await expect(generate("gpt-image-2.5-flare")).rejects.toThrow(/image source/);
    expect(t.generated).toHaveLength(0);
    await expect(fs.readdir(path.join(cwd, ".newmoney/image-work/poster"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("discards candidates and rejects missing required parameters", async () => {
    const cwd = await workspace();
    const t = harness(cwd);
    await expect(t.call("image_candidate_decide", { project_id: "poster", decision: "discard", summary: "x" })).rejects.toThrow(/candidate_id is required/);
    await expect(t.call("image_candidate_decide", { project_id: "poster", candidate_id: "c", decision: "accept", summary: "x" })).rejects.toThrow();
    await expect(t.call("image_project_read", { project_id: "../escape" })).rejects.toThrow(/Invalid image project id/);
  });

  it("places library projects at the library root", async () => {
    const cwd = await workspace();
    await fs.writeFile(path.join(cwd, IMAGE_LIBRARY_MARKER), "{}");
    expect(projectRoot(cwd, "poster")).toBe(path.join(cwd, "poster"));
    await fs.rm(path.join(cwd, IMAGE_LIBRARY_MARKER));
    expect(projectRoot(cwd, "poster")).toBe(path.join(cwd, ".newmoney", "images", "poster"));
  });
});
