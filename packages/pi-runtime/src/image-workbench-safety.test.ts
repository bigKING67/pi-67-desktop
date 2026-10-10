import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { classifyImageWorkbenchToolIntent, isImageWorkbenchToolName } from "./image-workbench-tool-safety.js";
import { imageTools } from "./image-workbench-tools.js";
import { extensionTool, safetyHandler, sdkTool, trustedPolicy } from "./safety-extension-test-fixture.js";
import type { DesktopApprovalRequester } from "./safety-extension.js";

const NAMES = imageTools().map((tool) => tool.name);
const tools = () => NAMES.map((name) => sdkTool(name));
const LABEL = "New Money 图像工作台";

async function workspace(): Promise<string> {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "image-safety-")));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
const job = { provider_profile: "openai.gpt-image-2.5-sunburst.2026-09-08", prompt: { scene: "secret campaign copy" } };
const generate = (extra: Record<string, unknown> = {}) => ({ project_id: "poster", candidate_id: "warm", target_id: "background", base_revision: 1, model: "newmoney-images-gateway/gpt-image-2.5-sunburst", job, ...extra });

describe("image workbench tool safety", () => {
  it("recognises exactly the seven workbench tools", () => {
    expect(NAMES.every(isImageWorkbenchToolName)).toBe(true);
    expect(["generate_image", "image_models", "image_delete", "read"].some(isImageWorkbenchToolName)).toBe(false);
  });

  it("classifies project reads and writes as Workspace actions on the project folder", async () => {
    const cwd = await workspace();
    const intent = (toolName: string, input: Record<string, unknown>) => classifyImageWorkbenchToolIntent(toolName, input, cwd, LABEL, []);
    expect(await intent("image_project_read", { project_id: "poster" })).toEqual({ toolName: "image_project_read", category: "workspace-read", target: ".newmoney/images/poster", targetKind: "tool", sourceLabel: LABEL });
    expect((await intent("image_candidates", { project_id: "poster" })).category).toBe("workspace-read");
    expect((await intent("image_project_edit", { project_id: "poster", base_revision: 1, summary: "x", operations: [{ type: "update_object", id: "photo", patch: { locked: false } }] })).category).toBe("workspace-write");
    expect((await intent("image_render", { project_id: "poster", mode: "preview" })).category).toBe("workspace-write");
    expect((await intent("image_candidate_decide", { project_id: "poster", candidate_id: "a", decision: "discard", summary: "x" })).category).toBe("workspace-write");
  });

  it("classifies a photo by where it lives and never approves sensitive sources", async () => {
    const cwd = await workspace();
    const create = (source: string) => classifyImageWorkbenchToolIntent("image_project_create_from_photo", { project_id: "poster", source, headline: "春季" }, cwd, LABEL, []);
    expect(await create("photos/bottle.png")).toMatchObject({ category: "workspace-write", target: ".newmoney/images/poster" });
    const outside = path.join(os.tmpdir(), "outside-photo.png");
    expect(await create(outside)).toMatchObject({ category: "external-path", targetKind: "path" });
    expect((await create(path.join(os.homedir(), ".ssh", "id_ed25519"))).category).toBe("credential-or-auth");
  });

  it("refuses a malformed edit before approval, naming the mismatch, and checks imported assets by path", async () => {
    const cwd = await workspace();
    const edit = (operations: unknown[]) => classifyImageWorkbenchToolIntent("image_project_edit", { project_id: "poster", base_revision: 1, summary: "x", operations }, cwd, LABEL, []);
    // The shapes the first real run guessed: none may reach an approval or the engine.
    for (const guessed of [{ type: "update_object", id: "photo", locked: false }, { type: "update_object", object_id: "photo", patch: { locked: false } },
      { op: "update_object", id: "photo", updates: { locked: false } }, { type: "unlock_object", id: "photo" }]) {
      const refused = await edit([guessed]);
      expect(refused).toMatchObject({ category: "unverified-tool" });
      expect(refused).toHaveProperty("nonApprovableReason", expect.stringMatching(/^图像工作台 Tool 输入不符合已注册合同（\/operations\/0/u));
    }
    expect((await edit([{ type: "add_asset", asset: { id: "logo", source: "brand/logo.png" } }])).category).toBe("workspace-write");
    expect(await edit([{ type: "add_asset", asset: { id: "logo", source: path.join(os.tmpdir(), "private.png") } }])).toMatchObject({ category: "external-path", targetKind: "path" });
    expect((await edit([{ type: "add_asset", asset: { id: "key", source: path.join(os.homedir(), ".ssh", "id_ed25519") } }])).category).toBe("credential-or-auth");
  });

  it("submits generation to the image Provider and reports files from outside the Workspace", async () => {
    const cwd = await workspace();
    const intent = (input: Record<string, unknown>) => classifyImageWorkbenchToolIntent("image_generate", input, cwd, LABEL, []);
    expect(await intent(generate())).toEqual({ toolName: "image_generate", category: "external-submit", target: "newmoney-images-gateway/gpt-image-2.5-sunburst", targetKind: "tool", sourceLabel: LABEL });
    const edit = { context: { x: 0, y: 0, width: 8, height: 8 }, generation_mask: "masks/g.png", protection_mask: "masks/p.png", blend_mask: path.join(os.tmpdir(), "blend.png") };
    expect((await intent(generate({ references: [{ asset_id: "style", source: path.join(os.tmpdir(), "ref.png") }], edit }))).target).toBe("newmoney-images-gateway/gpt-image-2.5-sunburst · 含 2 个工作区外文件");
    expect((await intent(generate({ references: [{ asset_id: "key", source: path.join(os.homedir(), ".aws", "credentials") }] }))).category).toBe("credential-or-auth");
  });

  it("refuses inputs outside the registered contract", async () => {
    const cwd = await workspace();
    for (const [toolName, input] of [
      ["image_project_read", {}], ["image_project_read", { project_id: 7 }], ["image_project_edit", { project_id: "poster", base_revision: 1, summary: "x", operations: [] }],
      ["image_render", { project_id: "poster", mode: "print" }], ["image_generate", generate({ base_revision: "1" })], ["image_generate", generate({ model: undefined })], ["image_unknown", { project_id: "poster" }]
    ] as const) {
      expect(await classifyImageWorkbenchToolIntent(toolName, input, cwd, LABEL, []), toolName).toMatchObject({ category: "unverified-tool", nonApprovableReason: expect.any(String) });
    }
  });

  it("lets AUTO edit the project without asking, asks once per generation without the prompt, and keeps PLAN read-only", async () => {
    const cwd = await workspace();
    const request = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "allowed" });
    const policy = { ...trustedPolicy(), cwd, taskToolMode: "auto" as const };
    const handler = safetyHandler(policy, request, tools);
    const call = (toolName: string, input: Record<string, unknown>) => handler({ toolCallId: toolName, toolName, input }, { hasUI: true });
    expect(await call("image_project_edit", { project_id: "poster", base_revision: 1, summary: "改标题", operations: [{ type: "update_object", id: "headline", patch: { text: "春日" } }] })).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    expect(await call("image_generate", generate())).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({ category: "external-submit", scope: "single-tool-call" });
    expect(JSON.stringify(request.mock.calls)).not.toContain("secret campaign copy");
    const plan = safetyHandler(policy, request, tools, undefined, undefined, () => "plan");
    expect(await plan({ toolCallId: "r", toolName: "image_project_read", input: { project_id: "poster" } }, { hasUI: true })).toBeUndefined();
    expect(await plan({ toolCallId: "e", toolName: "image_render", input: { project_id: "poster", mode: "export" } }, { hasUI: true })).toMatchObject({ block: true });
  });

  it("rejects workbench tool names registered by anything but Desktop", async () => {
    const request = vi.fn(async () => ({ status: "allowed" as const }));
    const policy = { ...trustedPolicy(), cwd: await workspace(), taskToolMode: "yolo" as const };
    for (const registered of [[extensionTool("image_project_read")], [sdkTool("image_project_read"), sdkTool("image_project_read")], []]) {
      const handler = safetyHandler(policy, request, () => registered);
      expect(await handler({ toolCallId: "r", toolName: "image_project_read", input: { project_id: "poster" } }, { hasUI: true })).toMatchObject({ block: true });
    }
    expect(request).not.toHaveBeenCalled();
  });
});
