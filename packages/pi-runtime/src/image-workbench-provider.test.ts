import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type { PiImageGenerationSource } from "@pi67/protocol";
import { imageSourceRegistrations, readImageGenerationSources } from "./image-workbench-provider.js";

type Runtime = Parameters<typeof imageSourceRegistrations>[0];
async function agentDir(settings?: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-sources-"));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  if (settings !== undefined) await fs.writeFile(path.join(directory, "settings.json"), settings);
  return directory;
}
const gateway: PiImageGenerationSource = { id: "gateway", name: "本机代理", api: "openai-images", provider: "codex", models: ["gpt-image-2.5-sunburst", "gpt-image-2.5"] };
const ark: PiImageGenerationSource = { id: "ark", name: "火山方舟", api: "ark-images", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-seedream-5-0-260128"] };
const runtime = (key: string | undefined, baseUrl: string | null = "http://127.0.0.1:8317/v1"): Runtime => ({
  getAuth: () => Promise.resolve(key === undefined ? undefined : { auth: { apiKey: key } }),
  getModels: () => (baseUrl ? [{ baseUrl }] : []) as never
}) as unknown as Runtime;

describe("image source Providers", () => {
  it("reads sources from settings.json (JSONC) and treats a missing or invalid file as none", async () => {
    expect(await readImageGenerationSources(await agentDir(`{ // comment
      "pi67Desktop": { "imageGeneration": { "sources": [${JSON.stringify(gateway)}] } }, }`))).toEqual([gateway]);
    expect(await readImageGenerationSources(await agentDir())).toEqual([]);
    expect(await readImageGenerationSources(await agentDir('{ "pi67Desktop": { "imageGeneration": { "sources": [{ "id": "BAD" }] } } }'))).toEqual([]);
  });

  it("registers one Provider per source on its image API, reusing a Provider's address and key literally", async () => {
    const registrations = await imageSourceRegistrations(runtime("sk-$HOME!x"), [gateway, ark]);
    expect(registrations.map(([id]) => id)).toEqual(["newmoney-images-gateway", "newmoney-images-ark"]);
    const [reused, own] = registrations.map(([, config]) => config as { baseUrl: string; apiKey?: string; models: { id: string; api: string; type: string }[]; images: Record<string, unknown> });
    expect(reused).toMatchObject({ baseUrl: "http://127.0.0.1:8317/v1", apiKey: "sk-$$HOME$!x" });
    expect(reused?.models.map((model) => [model.id, model.api, model.type])).toEqual([["gpt-image-2.5-sunburst", "openai-images", "image"], ["gpt-image-2.5", "openai-images", "image"]]);
    expect(Object.keys(reused?.images ?? {})).toEqual(["openai-images"]);
    expect(own).toMatchObject({ baseUrl: "https://ark.cn-beijing.volces.com/api/v3" }); expect(own).not.toHaveProperty("apiKey");
    expect(Object.keys(own?.images ?? {})).toEqual(["ark-images"]);
  });

  it("escapes a key that would otherwise run as a Pi command, and skips a reused Provider without an address", async () => {
    const [[, config] = ["", {}]] = await imageSourceRegistrations(runtime("!rm -rf ~"), [gateway]);
    expect((config as { apiKey: string }).apiKey).toBe("$!rm -rf ~");
    expect(await imageSourceRegistrations(runtime("k", null), [gateway])).toEqual([]);
    expect((await imageSourceRegistrations(runtime(undefined), [gateway]))[0]?.[1]).not.toHaveProperty("apiKey");
  });
});
