import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationLocalMemory } from "./application-local-memory.js";
import { loadLocalMemoryIdentity } from "./local-memory-identity.mjs";
import { OPENVIKING_INSTALLATION_NAME, OPENVIKING_QUERY_INSTALLATION_NAME, OPENVIKING_TEAM_INSTALLATION_NAME } from "./openviking-runtime-installer.js";

const roots: string[] = [];
async function fixture() {
  const appData = await mkdtemp(join(tmpdir(), "new-money-application-")); roots.push(appData);
  return { appData, platform: "darwin" as const, arch: "arm64",
    encryption: { isAvailable: vi.fn(() => true), encrypt: (text: string) => Buffer.from(text), decrypt: (value: Buffer) => value.toString() },
    models: { resolve: vi.fn(async () => { throw new Error("No configured Pi model"); }) }
  };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("application local memory wiring", () => {
  it.skipIf(process.platform !== "darwin" || process.arch !== "arm64").each([false, true])("uses only the distinct team revision, including isolated profile: %s", async isolated => {
    const options = await fixture(), separate = await fixture();
    const memory = createApplicationLocalMemory({ ...options, ...(isolated ? { isolatedUserData: separate.appData } : {}) })!;
    const localProfileId = await loadLocalMemoryIdentity(memory.memoryRoot);
    const privatePath = join(memory.memoryRoot, "runtime", OPENVIKING_INSTALLATION_NAME);
    await mkdir(join(privatePath, "runtime"), { recursive: true, mode: 0o700 });
    await writeFile(join(privatePath, "sentinel"), "retained-private-version");
    const teamId = "00000000-0000-4000-8000-000000000001";
    await expect(memory.teamPreparation.prepare({ localProfileId, teamId, scopeKind: "team", scopeId: teamId,
      endpoint: "https://fixture.invalid", userId: "user" }, new AbortController().signal)).rejects.toMatchObject({
      code: "ENOENT", path: join(memory.memoryRoot, "runtime", OPENVIKING_TEAM_INSTALLATION_NAME) });
    await expect(memory.teamQuery.prepareRuntime(new AbortController().signal)).rejects.toMatchObject({
      code: "ENOENT", path: join(memory.memoryRoot, "runtime", OPENVIKING_QUERY_INSTALLATION_NAME) });
    expect(await readFile(join(privatePath, "sentinel"), "utf8")).toBe("retained-private-version");
    expect(options.models.resolve).not.toHaveBeenCalled();
    if (isolated) expect(await readdir(options.appData)).toEqual([]);
    await memory.service.stop();
  });
  it("selects New Money storage without creating, decrypting or launching anything", async () => {
    const options = await fixture(); const memory = createApplicationLocalMemory(options)!;
    expect(memory.settings.path).toBe(join(options.appData, "New Money/openviking/settings/models.enc.json"));
    expect(await readdir(options.appData)).toEqual([]);
    expect(await memory.settings.load()).toBeUndefined();
    await expect(memory.service.connect()).rejects.toThrow(/not configured/u);
    expect(await readdir(options.appData)).toEqual([]);
    expect(options.encryption.isAvailable).not.toHaveBeenCalled();
    expect(options.models.resolve).not.toHaveBeenCalled();
    await memory.service.stop();
  });
  it("does not resolve model credentials or adopt another runtime when the fixed installation is missing", async () => {
    const options = await fixture(); const memory = createApplicationLocalMemory(options)!;
    await memory.settings.save({ extraction: { provider: "fixture", model: "fixture" }, embedding: {
      protocol: "openai-compatible", endpoint: "https://example.invalid/v1", model: "embed", dimension: 8, apiKey: "synthetic"
    } });
    await expect(memory.service.connect()).rejects.toThrow();
    expect(options.models.resolve).not.toHaveBeenCalled();
    expect(await readdir(join(options.appData, "New Money/openviking"))).toEqual(["settings", "startup-diagnostics.json"]);
    await memory.service.stop();
  });
  it.each([{ platform: "win32" as const, arch: "x64" }, { platform: "darwin" as const, arch: "x64" },
    { platform: "linux" as const, arch: "arm64" }])("keeps uncertified $platform/$arch unbound", async (target) => {
    const options = await fixture();
    expect(createApplicationLocalMemory({ ...options, ...target })).toBeUndefined();
    expect(await readdir(options.appData)).toEqual([]);
  });
  it("rejects relative application data paths before any storage access", async () => {
    const options = await fixture();
    expect(() => createApplicationLocalMemory({ ...options, appData: "relative" })).toThrow(/root/u);
  });
  it("keeps explicit test profiles independent of the canonical memory directory", async () => {
    const options = await fixture(); const isolated = await fixture();
    const memory = createApplicationLocalMemory({ ...options, isolatedUserData: isolated.appData })!;
    expect(memory.settings.path).toBe(join(isolated.appData, "openviking/settings/models.enc.json"));
    await memory.settings.save({ extraction: { provider: "fixture", model: "fixture" }, embedding: {
      protocol: "openai-compatible", endpoint: "https://example.invalid/v1", model: "embed", dimension: 8, apiKey: "synthetic"
    } });
    expect(await readdir(options.appData)).toEqual([]);
    expect((await memory.modelSettings.get()).status).toBe("configured");
    await memory.service.stop();
  });
  it.each(["relative", "", "/invalid\0profile"])("rejects unsafe isolated profile %j", async (isolatedUserData) => {
    const options = await fixture();
    expect(() => createApplicationLocalMemory({ ...options, isolatedUserData })).toThrow(/profile/u);
  });
});
