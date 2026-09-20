import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalMemorySupervisor } from "./local-memory-supervisor.js";
import { LocalMemoryService } from "./local-memory-service.mjs";
import { createLocalMemoryConfigurationLoader } from "./local-memory-configuration-loader.js";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";

const native = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("./openviking-native-process.mjs", () => ({ startNativeOpenViking: native.start }));
const directories: string[] = [];
const keys = generateKeyPairSync("ed25519");
afterEach(async () => {
  native.start.mockReset();
  vi.unstubAllGlobals();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "new-money-admission-"));
  directories.push(directory);
  const runtimeRoot = join(directory, "runtime");
  await mkdir(join(runtimeRoot, "bin"), { recursive: true });
  await writeFile(join(runtimeRoot, "bin/python3.12"), "synthetic-interpreter");
  const tree = await runtimeTreeIdentity(runtimeRoot);
  const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1",
    platform: process.platform, arch: process.arch, pythonVersion: "3.12.10",
    openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: tree.sha256 }));
  const model = { protocol: "openai-compatible" as const, endpoint: "https://example.test/v1", model: "synthetic", apiKey: "synthetic-secret" };
  const configuration = { runtimeRoot, manifest, signature: sign(null, manifest, keys.privateKey),
    dataRoot: join(directory, "private"), embedding: { ...model, dimension: 8 }, extraction: model };
  const stop = vi.fn(async () => undefined);
  native.start.mockImplementation(async (options: { localProfileId: string }) => ({
    connection: { endpoint: "http://127.0.0.1:12345", apiKey: "scoped", account: `private-${options.localProfileId}`,
      user: "desktop", localProfileId: options.localProfileId }, stop, provisionScope: vi.fn()
  }));
  const loadConfiguration = vi.fn(async () => configuration);
  const service = new LocalMemoryService({ trustedKey: keys.publicKey, loadConfiguration });
  return { directory, configuration, service, loadConfiguration, stop };
}

describe("Main local memory admission and broker composition", () => {
  it("records failed admission without secrets and never masks failure with a diagnostic write error", async () => {
    const { configuration } = await fixture();
    configuration.signature = Buffer.alloc(64);
    const recordStartup = vi.fn(async () => { throw new Error("private-path"); });
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = new LocalMemoryService({ trustedKey: keys.publicKey, loadConfiguration: async () => configuration, recordStartup });
    try {
      await expect(service.connect()).rejects.toThrow(/signature/u);
      expect(recordStartup).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", stages: [
        expect.objectContaining({ stage: "configuration", outcome: "completed" }),
        expect.objectContaining({ stage: "runtime-admission", outcome: "failed" })
      ] }));
      expect(native.start).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith("Local memory startup diagnostics could not be saved.");
      expect(JSON.stringify(recordStartup.mock.calls)).not.toMatch(/private-path|synthetic-secret/u);
    } finally { await service.stop(); warning.mockRestore(); }
  });
  it("records a single startup for competing warmup/session callers and no warm reuse timing", async () => {
    const { configuration } = await fixture();
    const recordStartup = vi.fn(async () => undefined);
    const service = new LocalMemoryService({ trustedKey: keys.publicKey, loadConfiguration: async () => configuration, recordStartup });
    try {
      await Promise.all([service.connect(), service.connect()]);
      await service.connect();
      expect(recordStartup).toHaveBeenCalledOnce();
      expect(recordStartup).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed", stages: [
        expect.objectContaining({ stage: "configuration" }), expect.objectContaining({ stage: "runtime-admission" }),
        expect.objectContaining({ stage: "storage-binding" }), expect.objectContaining({ stage: "native-start" })
      ] }));
      expect(JSON.stringify(recordStartup.mock.calls)).not.toContain("synthetic-secret");
      expect(native.start).toHaveBeenCalledOnce();
    } finally { await service.stop(); }
  });
  it("inspects only an existing live handle without loading configuration or restarting", async () => {
    const { service, loadConfiguration } = await fixture();
    const broker = new LocalMemorySupervisor(() => service);
    const request = { type: "local-memory-connect", requestId: "inspect", start: false };
    expect(await broker.operation(request)).toMatchObject({ ok: false });
    expect(loadConfiguration).not.toHaveBeenCalled();
    const connection = await service.connect();
    expect(await broker.operation(request)).toMatchObject({ ok: true, connection });
    const copy = service.inspect(); copy.apiKey = "changed-copy";
    expect(service.inspect().apiKey).toBe(connection.apiKey);
    await service.stop();
    expect(await broker.operation(request)).toMatchObject({ ok: false });
    expect(native.start).toHaveBeenCalledOnce();
  });
  it("checks only the current admitted endpoint, coalesces probes and rejects late success after stop", async () => {
    const { service, loadConfiguration } = await fixture();
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await service.checkHealth()).toBe("not-running");
    expect(loadConfiguration).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    await service.connect();
    const first = service.checkHealth(), second = service.checkHealth();
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:12345/health", {
      redirect: "error", signal: expect.any(AbortSignal)
    });
    finish(new Response("ok")); expect(await first).toBe("healthy");
    const late = service.checkHealth();
    await service.stop(); finish(new Response("ok"));
    expect(await late).toBe("not-running");
    expect(await service.checkHealth()).toBe("not-running");
    expect(native.start).toHaveBeenCalledTimes(1);
  });

  it("reports health errors without exposing endpoints, credentials or raw errors", async () => {
    const { service } = await fixture(); await service.connect();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("private-error", { status: 503 }))
      .mockRejectedValueOnce(new Error("secret-path"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await service.checkHealth()).toBe("unavailable");
    expect(await service.checkHealth()).toBe("unavailable");
    await service.stop();
  });
  it.each(["crash", "shutdown"])("does not hand out a previously ready connection after %s wins a reconnect await", async (cause) => {
    const { service, loadConfiguration, stop } = await fixture();
    let exit!: () => void;
    const launch = native.start.getMockImplementation()!;
    native.start.mockImplementation(async (...args: unknown[]) => {
      exit = args[2] as () => void;
      return launch(...args);
    });
    expect(service.status).toBe("idle");
    expect(loadConfiguration).not.toHaveBeenCalled();
    await service.connect();
    expect(service.status).toBe("running");
    const connecting = service.connect();
    const rejected = expect(connecting).rejects.toThrow("Local memory connection is no longer available.");
    if (cause === "crash") exit(); else void service.stop();
    await rejected;
    expect(service.status).toBe(cause === "crash" ? "failed" : "stopped");
    await service.stop();
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("launches with configured embedding and privately resolved extraction through the composed loader", async () => {
    const { configuration } = await fixture();
    const models = { resolve: vi.fn(async () => ({ ...configuration.extraction, apiKey: "fresh-pi-key" })) };
    const selection = { provider: "pi-fixture", model: configuration.extraction.model };
    const loadConfiguration = createLocalMemoryConfigurationLoader({
      settings: { load: async () => ({ extraction: selection, embedding: configuration.embedding }) }, models,
      loadRuntime: async () => ({ runtimeRoot: configuration.runtimeRoot, dataRoot: configuration.dataRoot,
        manifest: configuration.manifest, signature: configuration.signature })
    });
    const service = new LocalMemoryService({ trustedKey: keys.publicKey, loadConfiguration });
    try {
      const connection = await service.connect();
      expect(connection.apiKey).toBe("scoped");
      expect(native.start).toHaveBeenCalledWith(expect.objectContaining({
        embedding: configuration.embedding, extraction: { ...configuration.extraction, apiKey: "fresh-pi-key" }
      }), expect.any(AbortSignal), expect.any(Function));
      expect(models.resolve).toHaveBeenCalledWith(selection, expect.any(AbortSignal));
    } finally { await service.stop(); }
  });

  it("coalesces verified startup and exposes only the private connection through the broker", async () => {
    const { service, loadConfiguration, stop } = await fixture();
    const broker = new LocalMemorySupervisor(() => service);
    const [first, second] = await Promise.all([broker.operation({ type: "local-memory-connect", requestId: "one" }),
      broker.operation({ type: "local-memory-connect", requestId: "two" })]);
    expect(first).toMatchObject({ ok: true, connection: { apiKey: "scoped" } });
    expect(second).toMatchObject({ ok: true });
    expect(JSON.stringify(first)).not.toContain("synthetic-secret");
    expect(JSON.stringify(first)).not.toContain("provisionScope");
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(loadConfiguration).toHaveBeenCalledTimes(1);
    await broker.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(service.connect()).rejects.toThrow(/stopped/u);
  });

  it.each(["content", "signature", "target"])("rejects %s tampering before identity creation or spawn", async (kind) => {
    const { configuration, service, directory } = await fixture();
    if (kind === "content") await writeFile(join(configuration.runtimeRoot, "bin/python3.12"), "tampered");
    if (kind === "signature") configuration.signature = Buffer.alloc(64);
    if (kind === "target") {
      configuration.manifest = Buffer.from(configuration.manifest.toString().replace('"3.12.10"', '"3.13.0"'));
      configuration.signature = sign(null, configuration.manifest, keys.privateKey);
    }
    const broker = new LocalMemorySupervisor(() => service);
    expect(await broker.operation({ type: "local-memory-connect", requestId: "invalid" }))
      .toEqual({ type: "local-memory-connect-result", requestId: "invalid", ok: false, errorCode: "RUNTIME_UNAVAILABLE" });
    expect(native.start).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(["runtime"]);
    await broker.stop();
  });

  it("revalidates the runtime after a crash rather than reusing an admission cache", async () => {
    const { service, configuration } = await fixture();
    let exited: () => void = () => undefined;
    native.start.mockImplementationOnce(async (_options: unknown, _signal: AbortSignal, onExit: () => void) => {
      exited = onExit;
      return { connection: { endpoint: "http://127.0.0.1:12345", apiKey: "scoped" }, stop: async () => undefined };
    });
    await service.connect();
    exited();
    await writeFile(join(configuration.runtimeRoot, "bin/python3.12"), "tampered-after-crash");
    await expect(service.connect()).rejects.toThrow(/identity/u);
    expect(native.start).toHaveBeenCalledTimes(1);
    await service.stop();
  });

  it("blocks a changed embedding on reopen before launching against the old index", async () => {
    const { service, configuration } = await fixture();
    await service.connect();
    await service.stop();
    configuration.embedding.dimension = 16;
    const reopened = new LocalMemoryService({ trustedKey: keys.publicKey, loadConfiguration: async () => configuration });
    await expect(reopened.connect()).rejects.toThrow(/rebuild/u);
    expect(native.start).toHaveBeenCalledTimes(1);
    await reopened.stop();
  });

  it("cancels configuration loading without creating identity or launching", async () => {
    const { configuration, directory } = await fixture();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const service = new LocalMemoryService({ trustedKey: keys.publicKey, loadConfiguration: async (signal) => {
      entered();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return configuration;
    } });
    const connecting = service.connect();
    const rejected = expect(connecting).rejects.toThrow();
    await started;
    await service.stop();
    await rejected;
    expect(native.start).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(["runtime"]);
  });
});
