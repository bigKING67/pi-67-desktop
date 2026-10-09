import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { imageProviderBaseUrl, imageProviderRegistration, piAgentDirectory } from "./image-provider.js";
import initializeImageWorkbench from "./index.js";

async function agentDir(models?: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-pi-extension-"));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  if (models !== undefined) await fs.writeFile(path.join(directory, "models.json"), models);
  return directory;
}

describe("image Provider configuration", () => {
  it("resolves Pi's agent directory like Pi does", () => {
    expect(piAgentDirectory({ PI_CODING_AGENT_DIR: "/srv/pi" })).toBe("/srv/pi");
    expect(piAgentDirectory({ PI_CODING_AGENT_DIR: "~/pi" })).toBe(path.join(os.homedir(), "pi"));
    expect(piAgentDirectory({})).toBe(path.join(os.homedir(), ".pi", "agent"));
  });

  it("reads only the base URL of the newmoney-images entry from models.json (JSONC allowed)", async () => {
    const dir = await agentDir(`{
      // user comment
      "providers": { "codex": { "baseUrl": "http://127.0.0.1:8317/v1" }, "newmoney-images": { "baseUrl": " http://127.0.0.1:8317/v1 ", "apiKey": "secret", }, },
    }`);
    expect(imageProviderBaseUrl(dir)).toBe("http://127.0.0.1:8317/v1");
  });

  it("is absent without the file, the entry, a base URL or valid JSON", async () => {
    expect(imageProviderBaseUrl(await agentDir())).toBeUndefined();
    for (const content of ['{"providers":{"codex":{"baseUrl":"x"}}}', '{"providers":{"newmoney-images":{"apiKey":"k"}}}', '{"providers":{"newmoney-images":{"baseUrl":"  "}}}', "{ broken", "[]", '{"providers":[]}']) {
      expect(imageProviderBaseUrl(await agentDir(content)), content).toBeUndefined();
    }
  });

  it("registers the engine's Provider profiles as Pi image models on the openai-images API", () => {
    const registration = imageProviderRegistration("https://images.example/v1") as { baseUrl: string; models: { id: string; type: string; api: string }[]; images: Record<string, unknown> };
    expect(registration.baseUrl).toBe("https://images.example/v1");
    expect(registration.models.map((model) => [model.id, model.type, model.api])).toEqual([
      ["gpt-image-2.5-flare", "image", "openai-images"], ["gpt-image-2.5-sunburst", "image", "openai-images"]
    ]);
    expect(Object.keys(registration.images)).toEqual(["openai-images"]);
  });

  it("always registers the tools and registers the Provider only when configured", async () => {
    const pi = { registerTool: vi.fn(), registerProvider: vi.fn() };
    initializeImageWorkbench(pi as never, await agentDir());
    expect(pi.registerTool).toHaveBeenCalledTimes(7); expect(pi.registerProvider).not.toHaveBeenCalled();
    initializeImageWorkbench(pi as never, await agentDir('{"providers":{"newmoney-images":{"baseUrl":"https://images.example/v1"}}}'));
    expect(pi.registerProvider).toHaveBeenCalledWith("newmoney-images", expect.objectContaining({ baseUrl: "https://images.example/v1" }));
  });
});
