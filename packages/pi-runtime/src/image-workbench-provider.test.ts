import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { PROFILE_MODELS } from "@pi67/image-engine";
import { imageProviderBaseUrl, imageProviderRegistration } from "./image-workbench-provider.js";

async function agentDir(models?: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-pi-extension-"));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  if (models !== undefined) await fs.writeFile(path.join(directory, "models.json"), models);
  return directory;
}

describe("image Provider configuration", () => {
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
    for (const model of registration.models) expect([...PROFILE_MODELS.values()]).toContain(model.id);
  });
});
