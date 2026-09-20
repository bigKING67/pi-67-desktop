import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalMemoryModelSettingsStore } from "./local-memory-model-settings.js";
import { createLocalMemoryConfigurationLoader } from "./local-memory-configuration-loader.js";
import { TeamIndexSettingsBroker } from "./team-index-settings-broker.js";
import { TeamIndexSettingsClient } from "../../agent-host/src/context/team-index-settings-client.js";

const roots: string[] = [];
const settings = { extraction: { provider: "pi-fixture", model: "extract" }, embedding: {
  protocol: "openai-compatible" as const, endpoint: "https://example.invalid/v1", model: "embed", dimension: 8, apiKey: "synthetic-embedding-secret"
} };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-model-settings-")); roots.push(root);
  // Real authenticated test encryption, not evidence of macOS Keychain integration.
  const key = randomBytes(32);
  const encryption = {
    isAvailable: vi.fn(() => true),
    encrypt(value: string) {
      const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decrypt(value: Buffer) {
      const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString("utf8");
    }
  };
  return { root, encryption, store: new LocalMemoryModelSettingsStore(join(root, "settings"), encryption) };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("Main encrypted memory model settings", () => {
  it("connects the encrypted store to the private client and retires resolved settings on save without a second credential file", async () => {
    const { store, root } = await fixture(); await store.save(settings);
    const retire = vi.fn();
    const host = { postMessage(message: unknown) { client.handleMessage(message); } };
    const broker = new TeamIndexSettingsBroker(() => host, () => store, retire);
    const client = new TeamIndexSettingsClient({ postMessage(message) { broker.handleMessage(host, message); } });
    try {
      const old = client.signal;
      expect(await client.load(new AbortController().signal)).toEqual(settings);
      const next = { ...settings, embedding: { ...settings.embedding, apiKey: "synthetic-new-key" } };
      await store.save(next);
      expect(old.aborted).toBe(true); expect(retire).toHaveBeenCalledOnce();
      expect(await client.load(new AbortController().signal)).toEqual(next);
      expect(await readdir(join(root, "settings"))).toEqual(["models.enc.json"]);
      expect(await readFile(store.path, "utf8")).not.toContain("synthetic");
    } finally { client.shutdown(); broker.stop(); }
  });
  it("retires accepted-save generations synchronously and queues listener reads behind the write", async () => {
    const { store, encryption } = await fixture(); await store.save(settings);
    const old = store.signal; let read!: ReturnType<typeof store.load>;
    old.addEventListener("abort", () => { read = store.load(); }, { once: true });
    const next = { ...settings, embedding: { ...settings.embedding, apiKey: "synthetic-new-key" } };
    const write = store.save(next); expect(old.aborted).toBe(true); expect(store.signal.aborted).toBe(false);
    await write; expect(await read).toEqual(next);
    const unchanged = store.signal;
    await expect(store.save({ ...settings, embedding: { ...settings.embedding, dimension: 0 } })).rejects.toThrow("Invalid");
    expect(store.signal).toBe(unchanged);
    vi.spyOn(encryption, "encrypt").mockImplementation(() => { throw new Error("synthetic"); });
    const failure = store.save(settings); expect(unchanged.aborted).toBe(true);
    await expect(failure).rejects.toThrow("encrypted"); expect(await store.load()).toEqual(next);
  });
  it("persists only ciphertext and reopens the selection without copying Pi extraction credentials", async () => {
    const { store, root, encryption } = await fixture();
    expect(await store.load()).toBeUndefined();
    await store.save(settings);
    const raw = await readFile(store.path, "utf8");
    expect(raw).not.toContain(settings.embedding.apiKey);
    expect(raw).not.toContain(settings.extraction.provider);
    const decoded = Buffer.from((JSON.parse(raw) as { ciphertext: string }).ciphertext, "base64").toString("utf8");
    expect(decoded).not.toContain(settings.embedding.apiKey);
    expect(await new LocalMemoryModelSettingsStore(join(root, "settings"), encryption).load()).toEqual(settings);
    expect(await readdir(join(root, "settings"))).toEqual(["models.enc.json"]);
  });
  it("snapshots queued writes and preserves the previous file on encryption failure", async () => {
    const { store, encryption } = await fixture();
    const input = structuredClone(settings);
    const pending = store.save(input); input.embedding.apiKey = "mutated-after-call";
    await pending; expect(await store.load()).toEqual(settings);
    const before = await readFile(store.path, "utf8");
    vi.spyOn(encryption, "encrypt").mockImplementation(() => { throw new Error("synthetic-secret-error"); });
    await expect(store.save(settings)).rejects.toThrow("Memory settings could not be encrypted.");
    expect(await readFile(store.path, "utf8")).toBe(before);
  });
  it("fails closed for locked storage, damaged ciphertext and invalid model input", async () => {
    const { store, encryption } = await fixture();
    await store.save(settings);
    encryption.isAvailable.mockReturnValue(false);
    await expect(store.load()).rejects.toThrow(/unavailable/u);
    await expect(store.save(settings)).rejects.toThrow(/unavailable/u);
    encryption.isAvailable.mockReturnValue(true);
    await writeFile(store.path, JSON.stringify({ version: 1, ciphertext: "AAAA" }));
    await expect(store.load()).rejects.toThrow(/decrypted or validated/u);
    for (const changed of [{ dimension: 0 }, { endpoint: "http://remote.invalid" }, { apiKey: "" }]) {
      await expect(store.save({ ...settings, embedding: { ...settings.embedding, ...changed } })).rejects.toThrow(/Invalid/u);
    }
    expect(await readFile(store.path, "utf8")).toBe(JSON.stringify({ version: 1, ciphertext: "AAAA" }));
  });
  it.skipIf(process.platform === "win32")("rejects symlinked files and directories without overwriting targets", async () => {
    const { root, store, encryption } = await fixture();
    const target = join(root, "target"); await writeFile(target, "preserved");
    await mkdir(join(root, "settings")); await symlink(target, store.path);
    await expect(store.load()).rejects.toThrow(/Invalid/u);
    await expect(store.save(settings)).rejects.toThrow(/Unsafe/u);
    const alias = join(root, "alias"); await symlink(join(root, "settings"), alias);
    await expect(new LocalMemoryModelSettingsStore(alias, encryption).save(settings)).rejects.toThrow(/Unsafe/u);
    expect(await readFile(target, "utf8")).toBe("preserved");
  });
  it("composes decrypted settings and freshly resolved Pi credentials without a fallback", async () => {
    const { store } = await fixture();
    const extraction = { protocol: "openai-compatible" as const, endpoint: "https://pi.invalid/v1", model: "extract", apiKey: "pi-secret" };
    const models = { resolve: vi.fn(async () => extraction) };
    const runtime = { runtimeRoot: "/approved/runtime", dataRoot: "/private/data", manifest: Buffer.from("manifest"), signature: Buffer.alloc(64) };
    const loadRuntime = vi.fn(async () => runtime);
    const load = createLocalMemoryConfigurationLoader({ settings: store, models, loadRuntime });
    const signal = new AbortController().signal;
    await expect(load(signal)).rejects.toThrow(/not configured/u);
    expect(loadRuntime).not.toHaveBeenCalled(); expect(models.resolve).not.toHaveBeenCalled();
    await store.save(settings);
    expect(await load(signal)).toEqual({ ...runtime, extraction, embedding: settings.embedding });
    expect(models.resolve).toHaveBeenCalledWith(settings.extraction, signal);
    const raw = await readFile(store.path, "utf8"); expect(raw).not.toContain(extraction.apiKey);
    models.resolve.mockRejectedValue(new Error("broker unavailable"));
    await expect(load(signal)).rejects.toThrow(/broker unavailable/u);
  });
  it("stops configuration composition after cancellation without resolving a model", async () => {
    const { store } = await fixture(); await store.save(settings);
    const controller = new AbortController();
    const models = { resolve: vi.fn() };
    const load = createLocalMemoryConfigurationLoader({ settings: store, models, loadRuntime: async () => {
      controller.abort(); return { runtimeRoot: "/approved", dataRoot: "/private", manifest: Buffer.alloc(0), signature: Buffer.alloc(0) };
    } });
    await expect(load(controller.signal)).rejects.toThrow(); expect(models.resolve).not.toHaveBeenCalled();
  });
});
