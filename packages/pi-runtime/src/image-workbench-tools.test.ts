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
