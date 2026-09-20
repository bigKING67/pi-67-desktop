import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstalledLocalMemory } from "./installed-local-memory.js";
import { loadOpenVikingRuntimeInstallation } from "./openviking-runtime-installation.js";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";
import { openVikingRuntimeTrustedKey } from "./openviking-runtime-trust.js";

const native = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("./openviking-native-process.mjs", () => ({ startNativeOpenViking: native.start }));
const roots: string[] = [];
const keys = generateKeyPairSync("ed25519");
const settings = { extraction: { provider: "fixture", model: "extract" }, embedding: {
  protocol: "openai-compatible" as const, endpoint: "https://example.invalid/v1", model: "embed", dimension: 8, apiKey: "synthetic-embedding"
} };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-installed-")); roots.push(root);
  const memoryRoot = join(root, "memory"); const installationRoot = join(memoryRoot, "runtime/version-1");
  const runtimeRoot = join(installationRoot, "runtime");
  await mkdir(join(runtimeRoot, "bin"), { recursive: true, mode: 0o700 });
  await writeFile(join(runtimeRoot, "bin/python3.12"), "synthetic-interpreter");
  const tree = await runtimeTreeIdentity(runtimeRoot);
  const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", platform: process.platform,
    arch: process.arch, pythonVersion: "3.12.10", openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: tree.sha256 }));
  await writeFile(join(installationRoot, "manifest.json"), manifest);
  await writeFile(join(installationRoot, "manifest.sig"), sign(null, manifest, keys.privateKey));
  const options = { memoryRoot, installationRoot, trustedKey: keys.publicKey,
    encryption: { isAvailable: () => true, encrypt: (text: string) => Buffer.from(text), decrypt: (bytes: Buffer) => bytes.toString() },
    models: { resolve: vi.fn(async () => ({ protocol: "openai-compatible" as const, endpoint: "https://example.invalid/v1", model: "extract", apiKey: "synthetic-pi" })) } };
  const stop = vi.fn(async () => undefined);
  native.start.mockImplementation(async (config: { localProfileId: string }) => ({
    connection: { endpoint: "http://127.0.0.1:12345", apiKey: "scoped", account: `private-${config.localProfileId}`,
      user: "desktop", localProfileId: config.localProfileId }, stop
  }));
  return { options, runtimeRoot, stop, installed: createInstalledLocalMemory(options) };
}
afterEach(async () => { native.start.mockReset(); for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });

describe("installed memory assembly", () => {
  it("keeps private memory on its original runtime even when the explicit team revision is absent", async () => {
    const { options, runtimeRoot } = await fixture();
    const installed = createInstalledLocalMemory({ ...options, teamInstallationRoot: join(options.memoryRoot, "runtime/team-index-v1") });
    await installed.settings.save(settings);
    try {
      await installed.service.connect();
      expect(native.start.mock.calls[0]?.[0]).toMatchObject({ python: await realpath(join(runtimeRoot, "bin/python3.12")) });
    } finally { await installed.service.stop(); }
  });
  it("pins the authorized public key and rejects ephemeral bundles by default", async () => {
    const key = openVikingRuntimeTrustedKey();
    expect(key.type).toBe("public");
    expect(key.asymmetricKeyType).toBe("ed25519");
    expect(createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex"))
      .toBe("637e17fea62eaca283d4179548edeae0ce144472fea6fbc08adce28bd9cdbb31");
    const { options } = await fixture();
    const { memoryRoot, installationRoot, encryption, models } = options;
    const installed = createInstalledLocalMemory({ memoryRoot, installationRoot, encryption, models });
    await installed.settings.save(settings);
    try {
      await expect(installed.service.connect()).rejects.toThrow(/signature/u);
      expect(native.start).not.toHaveBeenCalled();
      expect(await readdir(memoryRoot)).not.toContain("profile.json");
    } finally { await installed.service.stop(); }
  });
  it("loads fixed signed files and settings before launching, preserving identity on reopen", async () => {
    const { installed, options, stop } = await fixture();
    await expect(installed.service.connect()).rejects.toThrow(/not configured/u);
    expect(native.start).not.toHaveBeenCalled();
    await installed.settings.save(settings);
    const connection = await installed.service.connect();
    expect(connection.apiKey).toBe("scoped");
    expect(options.models.resolve).toHaveBeenCalledWith(settings.extraction, expect.any(AbortSignal));
    await installed.service.stop(); expect(stop).toHaveBeenCalledTimes(1);
    const reopened = createInstalledLocalMemory(options);
    try { expect((await reopened.service.connect()).localProfileId).toBe(connection.localProfileId); }
    finally { await reopened.service.stop(); }
  });
  it.each(["signature", "runtime", "key"])("rejects %s tampering without spawning or creating private identity", async (kind) => {
    const { options, runtimeRoot } = await fixture();
    if (kind === "signature") await writeFile(join(options.installationRoot, "manifest.sig"), Buffer.alloc(64));
    if (kind === "runtime") await writeFile(join(runtimeRoot, "bin/python3.12"), "tampered");
    if (kind === "key") options.trustedKey = generateKeyPairSync("ed25519").publicKey;
    const installed = createInstalledLocalMemory(options); await installed.settings.save(settings);
    await expect(installed.service.connect()).rejects.toThrow(/signature|identity/u);
    expect(native.start).not.toHaveBeenCalled();
    expect(await readdir(options.memoryRoot)).not.toContain("profile.json");
    await installed.service.stop();
  });
  it("bounds metadata reads and honors cancellation without rewriting installed files", async () => {
    const { options } = await fixture();
    await writeFile(join(options.installationRoot, "manifest.json"), "x".repeat(8_193));
    await expect(loadOpenVikingRuntimeInstallation(options.installationRoot, new AbortController().signal)).rejects.toThrow(/Invalid/u);
    const controller = new AbortController(); controller.abort();
    await expect(loadOpenVikingRuntimeInstallation(options.installationRoot, controller.signal)).rejects.toThrow();
    expect((await readFile(join(options.installationRoot, "manifest.json"))).length).toBe(8_193);
  });
  it.skipIf(process.platform === "win32")("rejects symlinked metadata and writable shared installation directories", async () => {
    const { options } = await fixture();
    const signature = join(options.installationRoot, "manifest.sig");
    await rm(signature); await symlink("manifest.json", signature);
    await expect(loadOpenVikingRuntimeInstallation(options.installationRoot, new AbortController().signal)).rejects.toThrow(/Invalid/u);
    await chmod(options.installationRoot, 0o777);
    await expect(loadOpenVikingRuntimeInstallation(options.installationRoot, new AbortController().signal)).rejects.toThrow(/Unsafe/u);
  });
  it("rejects overlapping paths and a non-public trust key before any storage mutation", async () => {
    const { options } = await fixture();
    for (const installationRoot of [options.memoryRoot, join(options.memoryRoot, "data/version"), join(options.memoryRoot, "settings/version")]) {
      expect(() => createInstalledLocalMemory({ ...options, installationRoot })).toThrow(/separate/u);
    }
    for (const teamInstallationRoot of [options.installationRoot, join(options.installationRoot, "nested"),
      join(options.memoryRoot, "runtime"), join(options.memoryRoot, "data/team"), join(options.memoryRoot, "settings/team")]) {
      expect(() => createInstalledLocalMemory({ ...options, teamInstallationRoot })).toThrow(/separate/u);
    }
    expect(() => createInstalledLocalMemory({ ...options, teamInstallationRoot: "relative" })).toThrow(/absolute/u);
    expect(() => createInstalledLocalMemory({ ...options, trustedKey: keys.privateKey })).toThrow(/public key/u);
  });
});
