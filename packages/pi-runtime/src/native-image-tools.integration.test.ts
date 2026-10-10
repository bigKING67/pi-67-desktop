import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSessionFromServices, createAgentSessionServices, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AssistantImages, ImageContent, ImageModel, ImagesContext, ImagesOptions, Model, Provider, ToolCall, Usage } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { createDesktopCodemodeExtension } from "./codemode-extension.js";
import { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import { callNativeTool } from "./native-mcp.test-support.js";
import { createNativeImageTools } from "./native-image-tools.js";
import { createDesktopSafetyExtension, type DesktopApprovalRequester } from "./safety-extension.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const image: ImageContent = { type: "image", data: PNG, mimeType: "image/png" };
const usage: Usage = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } };
const input = { provider: "image-fixture", model: "image", prompt: "synthetic private prompt" };

describe("SDK-native image generation", () => {
  it("uses the real SDK model/auth seam and preserves images and usage in Pi JSONL", async () => {
    const f = await fixture();
    try {
      const models = await f.run("image_models");
      expect(models?.isError).toBe(false);
      expect(JSON.stringify(models)).toContain("image-fixture");
      expect(JSON.stringify(models)).not.toContain("synthetic-credential");
      expect(JSON.stringify(models)).not.toContain("baseUrl");
      // A guessed Provider id still surfaces the configured sources instead of "nothing configured".
      const guessed = JSON.stringify(await f.run("image_models", { provider: "newmoney-images-auto" }));
      expect(guessed).toContain("image-fixture");
      expect(guessed).toContain("No image model for provider");
      expect(guessed).not.toContain("NATIVE_IMAGE_MODEL_UNAVAILABLE");
      const before = f.session.model;
      const result = await f.run("generate_image", input);
      expect(result).toMatchObject({ isError: false, usage, content: expect.arrayContaining([image]) });
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(f.generate.mock.calls[0]?.[2]).toMatchObject({ apiKey: "synthetic-credential" });
      expect(f.session.model).toEqual(before);
      expect(f.session.getSessionStats().cost).toBeCloseTo(0.03);
      const stored = await readFile(f.session.sessionFile!, "utf8");
      expect(stored).toContain(PNG);
      expect(stored).not.toContain("synthetic-credential");
    } finally { await f.close(); }
  });

  it("reports missing credentials and unknown/chat-only models before generation", async () => {
    const f = await fixture({ authenticated: false });
    try {
      expect(JSON.stringify(await f.run("image_models"))).toContain("NATIVE_IMAGE_MODEL_UNAVAILABLE");
      for (const request of [input, { ...input, model: "chat" }, { ...input, model: "missing" }]) {
        expect((await f.run("generate_image", request))?.isError).toBe(true);
      }
      expect(f.generate).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it("reads explicit references through Pi's nested safety path before submission", async () => {
    const f = await fixture();
    try {
      const path = join(f.root, "reference.png");
      await writeFile(path, Buffer.from(PNG, "base64"));
      const result = await f.run("generate_image", { ...input, referencePaths: [path] });
      expect(result?.isError).toBe(false);
      expect(result?.nestedCalls?.calls).toEqual(expect.arrayContaining([expect.objectContaining({ name: "read", status: "ok" })]));
      expect(f.generate.mock.calls[0]?.[1].input.some((block) => block.type === "image")).toBe(true);
    } finally { await f.close(); }
  });

  it("does not submit after a reference read is denied or the model lacks image input", async () => {
    const f = await fixture();
    try {
      f.approve.mockImplementation(async (request) => ({ status: request.toolName === "generate_image" ? "allowed" : "denied" }));
      expect((await f.run("generate_image", { ...input, referencePaths: [join(tmpdir(), "unrelated-image.png")] }))?.isError).toBe(true);
      expect((await f.run("generate_image", { ...input, model: "text-only", referencePaths: ["unused.png"] }))?.isError).toBe(true);
      expect(f.generate).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it.each(["error", "aborted", "empty", "malformed", "too-many"] as const)("reports %s results without fallback and retains billed usage", async (reply) => {
    const f = await fixture({ reply });
    try {
      const result = await f.run("generate_image", input);
      expect(result).toMatchObject({ isError: true, usage });
      expect(result?.content.every((block) => block.type === "text")).toBe(true);
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain("synthetic-private-error");
    } finally { await f.close(); }
  });

  it("propagates abort to the SDK provider and settles without an image success", async () => {
    const f = await fixture({ reply: "pending" });
    try {
      const pending = f.run("generate_image", input);
      await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(1));
      await f.session.abort();
      expect(f.generate.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
      await pending;
      expect(f.session.isStreaming).toBe(false);
    } finally { await f.close(); }
  });

  it("keeps the same generation authorization inside Codemode and leaves model globals disabled", async () => {
    const f = await fixture();
    try {
      const result = await f.run("codemode", { code: `text(typeof models); const r = await tools.generate_image(${JSON.stringify(input)}); for (const b of r.content ?? []) { if (b.type === 'image') image(b); }` });
      expect(result?.isError).toBe(false);
      expect(JSON.stringify(result)).toContain("undefined");
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(f.approve.mock.calls.some(([request]) => request.toolName === "generate_image" && request.category === "external-submit")).toBe(true);
    } finally { await f.close(); }
  }, 20_000);
});

async function fixture(options: { authenticated?: boolean; reply?: "error" | "aborted" | "empty" | "malformed" | "too-many" | "pending" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi67-native-image-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  const approve = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "allowed" });
  const bridge = new DesktopExtensionUiBridge(() => undefined);
  const services = await createAgentSessionServices({ cwd: root, agentDir,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", images: { autoResize: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
      extensionFactories: [createDesktopCodemodeExtension(), createDesktopSafetyExtension(
        () => ({ cwd: root, trust: "trusted", taskToolMode: "auto" }), approve)] }
  });
  const chat: Model<"openai-responses"> = { provider: "image-fixture", id: "chat", name: "Chat", api: "openai-responses",
    baseUrl: "https://synthetic.invalid", input: ["text"], reasoning: false, contextWindow: 32_768, maxTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const imageModel: ImageModel<"openrouter-images"> = { provider: chat.provider, id: "image", name: "Synthetic image", type: "image",
    api: "openrouter-images", baseUrl: chat.baseUrl, input: ["text", "image"], output: ["image"], cost: chat.cost };
  const generate = vi.fn<(model: ImageModel<"openrouter-images">, context: ImagesContext, request?: ImagesOptions) => Promise<AssistantImages>>(
    async (model, _context, request) => {
      if (options.reply === "pending") await new Promise<void>((resolve) => request?.signal?.addEventListener("abort", () => resolve(), { once: true }));
      const stopReason = options.reply === "error" ? "error" : options.reply === "aborted" || request?.signal?.aborted ? "aborted" : "stop";
      return { api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), usage, stopReason,
        errorMessage: "synthetic-private-error",
        output: options.reply === "empty" ? [] : options.reply === "malformed" ? [{ ...image, data: "invalid" }]
          : options.reply === "too-many" ? Array.from({ length: 5 }, () => image) : [image] };
    });
  const provider: Provider<"openai-responses"> = { id: chat.provider, name: "Synthetic image provider",
    auth: { apiKey: { name: "Synthetic", resolve: async () => options.authenticated === false ? undefined : ({ auth: { apiKey: "synthetic-credential" } }) } },
    getModels: () => [chat], getAllModels: () => [chat, imageModel, { ...imageModel, id: "text-only", input: ["text"] }],
    stream: () => { throw new Error("Synthetic image test must not request a chat provider."); },
    streamSimple: () => { throw new Error("Synthetic image test must not request a chat provider."); }, generateImages: generate
  };
  services.modelRuntime.registerNativeProvider(provider);
  await services.modelRuntime.setRuntimeApiKey("openai", "synthetic-chat-credential");
  const { session } = await createAgentSessionFromServices({ services, model: { ...chat, provider: "openai" },
    sessionManager: SessionManager.create(root, join(root, "sessions")), customTools: createNativeImageTools() });
  await session.bindExtensions({ uiContext: bridge.context, mode: "rpc" });
  return { root, session, approve, generate,
    run: (tool: string, args: ToolCall["arguments"] = {}) => callNativeTool(session, tool, args),
    async close() { await session.abort(); session.dispose(); bridge.dispose(); await rm(root, { recursive: true, force: true }); }
  };
}
