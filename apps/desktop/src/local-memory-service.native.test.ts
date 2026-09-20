import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expect, it } from "vitest";
import { LocalMemoryService } from "./local-memory-service.mjs";
import { LocalMemorySupervisor } from "./local-memory-supervisor.js";
import { LocalMemoryActivationController } from "./local-memory-activation-controller.js";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";

// Explicit operator-supplied runtime only. No downloads, user profile, paid model,
// persisted signing key or production trust. Never enable in the ordinary suite.
const runtimeRoot = process.env.PI67_NATIVE_MEMORY_TEST_RUNTIME;
it.skipIf(!runtimeRoot)("admits, isolates and restarts real native private profiles through the Main service", async () => {
  expect(process.platform).toBe("darwin"); expect(process.arch).toBe("arm64");
  expect(isAbsolute(runtimeRoot!)).toBe(true);
  const directory = await mkdtemp(join(tmpdir(), "new-money-service-native-"));
  const keys = generateKeyPairSync("ed25519");
  let embeddingCalls = 0;
  const model = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as { model: string; input: string | string[] };
    response.setHeader("content-type", "application/json");
    if (request.url !== "/v1/embeddings" || body.model !== "synthetic"
      || request.headers.authorization !== "Bearer synthetic-key") {
      response.writeHead(400).end("{}"); return;
    }
    embeddingCalls++;
    const rows = Array.isArray(body.input) ? body.input : [body.input];
    response.end(JSON.stringify({ object: "list", data: rows.map((_, index) => ({
      object: "embedding", index, embedding: [1, 0, 0, 0, 0, 0, 0, 0]
    })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
  });
  let broker: LocalMemorySupervisor | undefined;
  let otherService: LocalMemoryService | undefined;
  try {
    await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
    const address = model.address();
    if (!address || typeof address === "string") throw new Error("Missing synthetic model listener");
    const tree = await runtimeTreeIdentity(runtimeRoot!);
    const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1",
      platform: "darwin", arch: "arm64", pythonVersion: "3.12.10", openvikingVersion: "0.4.16",
      sdkVersion: "0.1.10", treeSha256: tree.sha256 }));
    const configuration = { runtimeRoot: runtimeRoot!, manifest, signature: sign(null, manifest, keys.privateKey),
      dataRoot: join(directory, "private"),
      embedding: { protocol: "openai-compatible" as const, endpoint: `http://127.0.0.1:${address.port}/v1`,
        model: "synthetic", apiKey: "synthetic-key", dimension: 8 },
      extraction: { protocol: "openai-compatible" as const, endpoint: `http://127.0.0.1:${address.port}/v1`,
        model: "synthetic", apiKey: "synthetic-key" } };
    const rejected = new LocalMemoryService({ trustedKey: generateKeyPairSync("ed25519").publicKey,
      loadConfiguration: async () => configuration });
    try { await expect(rejected.connect()).rejects.toThrow(/signature/); }
    finally { await rejected.stop(); }
    expect(await readdir(directory)).toEqual([]);
    // Real service behind the same consent gate as application Main. Persistence
    // is independently exercised by packaged cold readback; no user preference is read.
    const activate = async (service: LocalMemoryService) => {
      const activation = new LocalMemoryActivationController({ service,
        store: { load: async () => true, save: async () => undefined }, prerequisites: async () => "ready" });
      await activation.initialize();
      return activation;
    };
    const service = new LocalMemoryService({ trustedKey: keys.publicKey, loadConfiguration: async () => configuration });
    const activated = await activate(service);
    broker = new LocalMemorySupervisor(() => activated);
    const connect = async (requestId: string) => {
      const result = await broker!.operation({ type: "local-memory-connect", requestId });
      if (!result) throw new Error("Missing native connection response");
      if (!result.ok) throw new Error(`Native connection failed: ${result.errorCode}`);
      expect(Object.keys(result.connection).sort()).toEqual(["account", "apiKey", "endpoint", "localProfileId", "user"]);
      return result.connection;
    };
    const [first, concurrent] = await Promise.all([connect("one"), connect("two")]);
    expect(activated.get()).toMatchObject({ preference: "enabled", selectedAtLaunch: true, lifecycle: "running" });
    expect(concurrent).toEqual(first);
    const request = async (connection: typeof first, path: string, body?: object, headers?: Record<string, string>) => fetch(`${connection.endpoint}${path}`, {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "X-API-Key": connection.apiKey, "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    expect((await request(first, "/api/v1/admin/accounts")).status).toBe(403);
    const uri = "viking://resources/main-service-private.md";
    expect((await request(first, "/api/v1/content/write", { uri, content: "Main service private persistence fixture.",
      mode: "create", wait: true, timeout: 20, processing_mode: "vectors_only" })).status).toBe(200);
    expect(embeddingCalls).toBeGreaterThan(0);
    const readPath = `/api/v1/content/read?uri=${encodeURIComponent(uri)}`;
    const otherConfiguration = { ...configuration, dataRoot: join(directory, "other-private") };
    otherService = new LocalMemoryService({ trustedKey: keys.publicKey, loadConfiguration: async () => otherConfiguration });
    const other = await otherService.connect();
    expect(other.localProfileId === first.localProfileId).toBe(false);
    expect(other.account === first.account).toBe(false);
    expect(other.endpoint === first.endpoint).toBe(false);
    expect(other.apiKey === first.apiKey).toBe(false);
    expect((await request(other, readPath)).status).toBe(404);
    const query = { query: "private persistence", target_uri: "viking://resources/", limit: 10, score_threshold: 0 };
    const ownSearch = await request(first, "/api/v1/search/find", query);
    expect(ownSearch.status).toBe(200); expect(await ownSearch.text()).toContain("main-service-private.md");
    const otherSearch = await request(other, "/api/v1/search/find", query);
    expect(otherSearch.status).toBe(200); expect(await otherSearch.text()).not.toContain("main-service-private.md");
    // Reusing the same URI in the second profile must not overwrite the first.
    const otherContent = "第二个私人 Profile 的独立记忆。 Isolated second profile.";
    expect((await request(other, "/api/v1/content/write", { uri, content: otherContent,
      mode: "create", wait: true, timeout: 20, processing_mode: "vectors_only" })).status).toBe(200);
    for (const [connection, content] of [[first, "Main service private persistence fixture."], [other, otherContent]] as const) {
      const read = await request(connection, readPath);
      expect(read.status).toBe(200); expect(await read.text()).toContain(content);
    }
    // A credential from either process cannot authenticate against the other.
    for (const [target, foreign] of [[first, other], [other, first]] as const) {
      const denied = await request({ ...target, apiKey: foreign.apiKey }, readPath);
      expect([401, 403]).toContain(denied.status); await denied.body?.cancel();
    }
    // Pinned OpenViking api_key auth ignores actor headers; identity must remain
    // token-bound, including non-admin status, rather than requiring HTTP denial.
    const spoofHeaders = { "X-OpenViking-Account": other.account, "X-OpenViking-User": "scope-owner" };
    const spoof = await request(first, readPath, undefined, spoofHeaders);
    expect(spoof.status).toBe(200);
    const spoofContent = await spoof.text();
    expect(spoofContent).toContain("Main service private persistence fixture.");
    expect(spoofContent).not.toContain(otherContent);
    expect((await request(first, "/api/v1/admin/accounts", undefined, spoofHeaders)).status).toBe(403);
    await broker.stop();
    expect(activated.get()).toMatchObject({ lifecycle: "stopped" });
    const restarted = new LocalMemoryService({ trustedKey: keys.publicKey, loadConfiguration: async () => configuration });
    const reactivated = await activate(restarted);
    broker = new LocalMemorySupervisor(() => reactivated);
    const second = await connect("three");
    expect(second.localProfileId).toBe(first.localProfileId);
    expect(second.apiKey === first.apiKey).toBe(false);
    const oldCredential = await request({ ...second, apiKey: first.apiKey }, readPath);
    expect([401, 403]).toContain(oldCredential.status); await oldCredential.body?.cancel();
    const read = await request(second, readPath);
    expect(read.status).toBe(200); expect(await read.text()).toContain("Main service private persistence fixture.");
    // Restarting one profile must not disrupt the other running profile.
    const stillOther = await request(other, readPath);
    expect(stillOther.status).toBe(200); expect(await stillOther.text()).toContain(otherContent);
    await otherService.stop();
    otherService = new LocalMemoryService({ trustedKey: keys.publicKey, loadConfiguration: async () => otherConfiguration });
    const otherRestarted = await otherService.connect();
    expect(otherRestarted.localProfileId).toBe(other.localProfileId);
    expect(otherRestarted.apiKey === other.apiKey).toBe(false);
    const otherRead = await request(otherRestarted, readPath);
    expect(otherRead.status).toBe(200); expect(await otherRead.text()).toContain(otherContent);
    await otherService.stop();
    await broker.stop();
    expect((await readdir(configuration.dataRoot)).some((name) => name.startsWith(".run-"))).toBe(false);
    expect((await readdir(otherConfiguration.dataRoot)).some((name) => name.startsWith(".run-"))).toBe(false);
    expect((await runtimeTreeIdentity(runtimeRoot!)).sha256).toBe(tree.sha256);
  } finally {
    try { await Promise.all([broker?.stop(), otherService?.stop()]); }
    finally {
      await new Promise<void>((resolve, reject) => model.close((error) => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 240_000);
