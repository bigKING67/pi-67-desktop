import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import * as childProcess from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expect, it, vi } from "vitest";
import { createPrivateMemoryNativeSession } from "../../../packages/pi-runtime/src/private-memory-native.test-support.js";
import { LocalMemoryService } from "./local-memory-service.mjs";
import { LocalMemorySupervisor } from "./local-memory-supervisor.js";
import { LocalMemoryActivationController } from "./local-memory-activation-controller.js";
import { LocalMemoryActivationStore } from "./local-memory-activation-store.js";
import { openVikingRuntimeTrustedKey } from "./openviking-runtime-trust.js";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";
import * as admission from "./openviking-runtime-admission.js";
import * as nativeProcess from "./openviking-native-process.mjs";
import { installOpenVikingRuntime } from "./openviking-runtime-installer.js";
import { verifyOpenVikingManifest } from "./openviking-runtime-manifest.mjs";
import { applyLazyImportExperiment, lazyOtelImportContract, lazyLitellmImportContract } from "../../../eng/capabilities/private-memory-lazy-import.test-support.mjs";

// A configurable export surface for instrumentation; every function starts as
// the real Node implementation, including execFile's promisify contract.
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>()
}));

// Operator-supplied full installation, verified with the unchanged source trust
// anchor. No download/signing/user profile/provider or production data access.
const installation = process.env.PI67_PRIVATE_SESSION_TEST_INSTALLATION;
const freshInstallation = process.env.PI67_PRIVATE_SESSION_FRESH_INSTALL === "1";
const precheckInterpreter = process.env.PI67_PRIVATE_SESSION_PRECHECK === "1";
const profileImports = process.env.PI67_PRIVATE_SESSION_PROFILE_IMPORTS === "1";
const lazyOtelExperiment = process.env.PI67_PRIVATE_SESSION_LAZY_OTEL_EXPERIMENT === "1";
const lazyLitellmExperiment = process.env.PI67_PRIVATE_SESSION_LAZY_LITELLM_EXPERIMENT === "1";
const lazyExperiment = lazyLitellmExperiment ? "litellm" : lazyOtelExperiment ? "otel" : undefined;
it.skipIf(!installation)("captures, extracts and recalls private memory through a signed native service", async () => {
  expect(process.platform).toBe("darwin"); expect(process.arch).toBe("arm64");
  expect(isAbsolute(installation!)).toBe(true);
  expect(lazyOtelExperiment && lazyLitellmExperiment, "Compare one experiment at a time.").toBe(false);
  if (lazyExperiment) {
    expect(freshInstallation, "Experiment requires an isolated verified copy.").toBe(true);
    expect(precheckInterpreter, "Do not prewarm the experiment.").toBe(false);
  }
  const admissionMs: number[] = [];
  const nativeMs: number[] = [];
  const healthReadyMs: number[] = [];
  const importProfiles: { module: string; selfUs: number; cumulativeUs: number }[][] = [];
  let nativeBegan: number | undefined;
  const realFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (...args) => {
    const response = await realFetch(...args);
    // Only readiness inside the awaited startup; never inspect headers or bodies.
    if (nativeBegan !== undefined && typeof args[0] === "string"
      && /^http:\/\/127\.0\.0\.1:\d+\/health$/u.test(args[0]) && response.ok) {
      healthReadyMs.push(Math.round(performance.now() - nativeBegan));
      nativeBegan = undefined;
    }
    return response;
  });
  const realSpawn = childProcess.spawn;
  const spawnSpy = profileImports ? vi.spyOn(childProcess, "spawn").mockImplementation(((
    command: string, args: readonly string[], options: childProcess.SpawnOptions
  ) => {
    // Test-only observation of the exact real launch. Keep executable, args,
    // credentials, isolation and containment unchanged; only pipe stderr and
    // enable CPython's import timer. Raw stderr is neither output nor retained.
    expect(args).toEqual(["-I", "-B", "-c",
      "from openviking_cli.server_bootstrap import main; main()", "--config", expect.any(String)]);
    const child = realSpawn(command, ["-X", "importtime", ...args], {
      ...options, stdio: ["ignore", "ignore", "pipe"]
    });
    const profile: { module: string; selfUs: number; cumulativeUs: number }[] = [];
    importProfiles.push(profile);
    let pending = "";
    let droppingLine = false;
    child.stderr?.on("data", (chunk: Buffer) => {
      if (nativeBegan === undefined) { pending = ""; droppingLine = false; return; }
      for (const character of chunk.toString("utf8")) {
        if (character === "\n") {
          const match = droppingLine ? null : /^import time:\s+(\d+)\s+\|\s+(\d+)\s+\|\s+([a-zA-Z_][\w.]*)$/u.exec(pending);
          if (match) {
            const entry = { module: match[3]!, selfUs: Number(match[1]), cumulativeUs: Number(match[2]) };
            if (Number.isSafeInteger(entry.selfUs) && Number.isSafeInteger(entry.cumulativeUs)) {
              profile.push(entry);
              profile.sort((a, b) => b.selfUs - a.selfUs);
              if (profile.length > 12) profile.pop();
            }
          }
          pending = ""; droppingLine = false;
        } else if (!droppingLine) {
          if (pending.length < 512) pending += character;
          else { pending = ""; droppingLine = true; }
        }
      }
    });
    return child;
  }) as typeof childProcess.spawn) : undefined;
  let interpreterPrecheckMs: number | undefined;
  const admit = admission.admitOpenVikingRuntime;
  const start = nativeProcess.startNativeOpenViking;
  const admissionSpy = vi.spyOn(admission, "admitOpenVikingRuntime").mockImplementation(async (...args) => {
    const began = performance.now();
    try { return await admit(...args); } finally { admissionMs.push(Math.round(performance.now() - began)); }
  });
  const nativeSpy = vi.spyOn(nativeProcess, "startNativeOpenViking").mockImplementation(async (...args) => {
    const began = performance.now();
    nativeBegan = began;
    try { return await start(...args); } finally {
      nativeMs.push(Math.round(performance.now() - began)); nativeBegan = undefined;
    }
  });
  const root = await mkdtemp(join(tmpdir(), "new-money-private-session-"));
  const agentDir = join(root, "agent"); const workspace = join(root, "workspace");
  let broker: LocalMemorySupervisor | undefined;
  let loop: Awaited<ReturnType<typeof createPrivateMemoryNativeSession>> | undefined;
  let unexpectedModelRequests = 0;
  let extractionRequests = 0;
  let summaryRequests = 0;
  const model = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 2 * 1024 * 1024) { unexpectedModelRequests++; response.writeHead(413).end(); return; }
    }
    const body = JSON.parse(raw) as { model: string; input: string | string[]; messages?: { content: string }[] };
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/chat/completions" && body.model === "extract"
      && request.headers.authorization === "Bearer synthetic-key") {
      const messages = body.messages?.map(message => message.content).join("\n") ?? "";
      let content: string;
      if (messages.includes("## Page ID Rules") && messages.includes("NM-PRIVATE-ONE")) {
        extractionRequests++;
        content = JSON.stringify({ preferences: [{ page_id: 100, user: "desktop", topic: "communication_style",
          content: "- NM-PRIVATE-ONE: I prefer concise Chinese responses." }], delete_ids: [] });
      } else if (messages.includes("You are a session note-taker") && messages.includes("NM-PRIVATE-ONE")) {
        summaryRequests++;
        content = "# Working Memory\n\n## Current State\nPrivate fixture completed.\n\n## Key Facts & Decisions\nPrefers concise Chinese responses.";
      } else {
        unexpectedModelRequests++; response.writeHead(400).end("{}"); return;
      }
      response.end(JSON.stringify({ id: "synthetic-extraction", object: "chat.completion", created: 1, model: "extract",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); return;
    }
    if (request.url !== "/v1/embeddings" || body.model !== "synthetic"
      || request.headers.authorization !== "Bearer synthetic-key") {
      unexpectedModelRequests++; response.writeHead(400).end("{}"); return;
    }
    const rows = Array.isArray(body.input) ? body.input : [body.input];
    response.end(JSON.stringify({ object: "list", data: rows.map((_, index) => ({
      object: "embedding", index, embedding: [1, 0, 0, 0, 0, 0, 0, 0]
    })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
  });
  try {
    await Promise.all([mkdir(agentDir), mkdir(workspace)]);
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("OPENVIKING_") || key.startsWith("OV_")) vi.stubEnv(key, undefined);
    }
    for (const [key, value] of Object.entries({ PI_CODING_AGENT_DIR: agentDir, PI_AGENT_DIR: agentDir,
      PI67_DESKTOP: "0", OPENVIKING_CREDENTIAL_SOURCE: "env", OPENVIKING_PENDING_DIR: join(root, "pending"),
      OPENVIKING_CLI_CONFIG_FILE: join(root, "absent-cli.json"), OPENVIKING_CONFIG_FILE: join(root, "absent-ov.json") })) vi.stubEnv(key, value);
    await writeFile(join(agentDir, "openviking.json"), JSON.stringify({ enabled: true, privacyMode: "private-learning",
      syncTurns: true, captureAssistantTurns: true, captureToolResults: false, recallQueryExpansion: "off",
      commitKeepRecentCount: 0, takeover: { enabled: false }, logLevel: "silent" }), { mode: 0o600 });
    await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
    const address = model.address();
    if (!address || typeof address === "string") throw new Error("Synthetic listener unavailable.");
    let selectedInstallation = installation!;
    if (freshInstallation) {
      const parent = join(root, "installation");
      await mkdir(parent, { mode: 0o700 });
      selectedInstallation = (await installOpenVikingRuntime({ source: installation!, parent,
        signal: AbortSignal.timeout(120_000), purpose: "private" })).installationRoot;
    }
    const runtimeRoot = join(selectedInstallation, "runtime");
    let originalTree = await runtimeTreeIdentity(runtimeRoot);
    let trustedKey = openVikingRuntimeTrustedKey();
    let manifest = await readFile(join(selectedInstallation, "manifest.json"));
    let signature = await readFile(join(selectedInstallation, "manifest.sig"));
    if (lazyExperiment) {
      await applyLazyImportExperiment(lazyExperiment, runtimeRoot, root);
      const patchedTree = await runtimeTreeIdentity(runtimeRoot);
      expect(patchedTree.sha256).not.toBe(originalTree.sha256);
      const identity = { platform: "darwin", arch: "arm64", pythonVersion: "3.12.10",
        openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: patchedTree.sha256 };
      const testKey = generateKeyPairSync("ed25519");
      manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", ...identity }));
      signature = sign(null, manifest, testKey.privateKey);
      expect(() => verifyOpenVikingManifest(manifest, signature, trustedKey, identity)).toThrow("signature is invalid");
      trustedKey = testKey.publicKey;
      originalTree = patchedTree;
      // Keys and patched manifest stay in test memory, never in an installation.
    }
    if (precheckInterpreter) {
      expect(freshInstallation, "Interpreter precheck requires an isolated signed installation.").toBe(true);
      const began = performance.now();
      await promisify(execFile)(join(runtimeRoot, "bin/python3.12"), ["-I", "-B", "-c", "pass"], {
        cwd: root, env: { PATH: "/usr/bin:/bin" }, timeout: 30_000, maxBuffer: 1_024
      });
      interpreterPrecheckMs = Math.round(performance.now() - began);
    }
    const endpoint = `http://127.0.0.1:${address.port}/v1`;
    const configuration = { runtimeRoot, manifest,
      signature, dataRoot: join(root, "private"),
      embedding: { protocol: "openai-compatible" as const, endpoint, model: "synthetic", apiKey: "synthetic-key", dimension: 8 },
      extraction: { protocol: "openai-compatible" as const, endpoint, model: "extract", apiKey: "synthetic-key" } };
    const createActivation = async () => {
      const service = new LocalMemoryService({ trustedKey, loadConfiguration: async () => configuration });
      const activation = new LocalMemoryActivationController({ service, store: new LocalMemoryActivationStore(root),
        prerequisites: async () => "ready" });
      await activation.initialize(); return activation;
    };
    let activation = await createActivation();
    broker = new LocalMemorySupervisor(() => activation);
    const connect = async () => {
      const result = await broker!.operation({ type: "local-memory-connect", requestId: "private-session" });
      if (!result?.ok) throw new Error("Native private session connection denied.");
      return result.connection;
    };
    await expect(connect()).rejects.toThrow("denied");
    expect(await readdir(root)).not.toContain("private");
    await activation.setEnabled(true);
    expect(activation.get()).toMatchObject({ selectedAtLaunch: false, restartRequired: true, lifecycle: "idle" });
    await expect(connect()).rejects.toThrow("denied");
    await broker.stop();
    activation = await createActivation(); broker = new LocalMemorySupervisor(() => activation);
    loop = await createPrivateMemoryNativeSession({ directory: workspace, agentDir, memory: { connect }, modelEndpoint: endpoint });
    const firstText = "私人验收标记 NM-PRIVATE-ONE: I prefer concise Chinese responses.";
    const first = await loop.run(firstText);
    const connection = await connect();
    expect(activation.get()).toMatchObject({ selectedAtLaunch: true, lifecycle: "running" });
    const readContext = async (id: string) => {
      const current = await connect();
      const result = await fetch(`${current.endpoint}/api/v1/sessions/${encodeURIComponent(id)}/context?token_budget=128000`, {
        headers: { "X-API-Key": current.apiKey }, redirect: "error", signal: AbortSignal.timeout(15_000) });
      expect(result.status).toBe(200); return result.text();
    };
    expect((await readContext(first.ovSessionId)).split(firstText)).toHaveLength(2);
    await loop.close(); loop = undefined; await broker.stop();
    activation = await createActivation(); broker = new LocalMemorySupervisor(() => activation);
    loop = await createPrivateMemoryNativeSession({ directory: workspace, agentDir, memory: { connect }, modelEndpoint: endpoint,
      sessionFile: first.sessionFile });
    const resumedConnection = await connect();
    expect(resumedConnection.localProfileId).toBe(connection.localProfileId);
    expect(resumedConnection.apiKey === connection.apiKey).toBe(false);
    expect((await readContext(first.ovSessionId)).split(firstText)).toHaveLength(2);
    const nextText = "私人验收标记 NM-PRIVATE-TWO: Restart must preserve my local memory.";
    const resumed = await loop.run(nextText);
    expect(resumed.piSessionId).toBe(first.piSessionId); expect(resumed.ovSessionId).toBe(first.ovSessionId);
    expect(resumed.syncedCaptureCount).toBe(first.syncedCaptureCount + 2);
    const context = await readContext(first.ovSessionId);
    expect(context.split(firstText)).toHaveLength(2); expect(context.split(nextText)).toHaveLength(2);
    expect(unexpectedModelRequests).toBe(0);
    expect(extractionRequests).toBe(0); expect(summaryRequests).toBe(0);
    expect(await loop.commit()).toMatchObject({ archived: true });
    const dataRoot = join(configuration.dataRoot, "data");
    let preferencePath = "";
    await expect.poll(async () => {
      const files = await readdir(dataRoot, { recursive: true });
      const preferences = files.filter(file => file.endsWith("/memories/preferences/desktop/communication_style.md"));
      if (preferences.length !== 1) return false;
      const completed = files.filter(file => file.endsWith(`/sessions/${resumed.ovSessionId}/history/archive_001/.done`));
      if (completed.length !== 1) return false;
      const done = JSON.parse(await readFile(join(dataRoot, completed[0]!), "utf8")) as {
        completed_memory_steps?: { long_term?: string[] }; starting_message_id: string; ending_message_id: string;
      };
      expect(done.completed_memory_steps?.long_term).toHaveLength(4);
      expect(done.starting_message_id).not.toBe(done.ending_message_id);
      preferencePath = join(dataRoot, preferences[0]!);
      return (await readFile(preferencePath, "utf8")).includes("NM-PRIVATE-ONE");
    }, { timeout: 60_000 }).toBe(true);
    expect(extractionRequests).toBeGreaterThan(0); expect(summaryRequests).toBeGreaterThan(0);
    const preference = await readFile(preferencePath, "utf8");
    await loop.close(); loop = undefined; await broker.stop();
    activation = await createActivation(); broker = new LocalMemorySupervisor(() => activation);
    loop = await createPrivateMemoryNativeSession({ directory: workspace, agentDir, memory: { connect }, modelEndpoint: endpoint });
    const recalled = await loop.run("What communication style do I prefer? Please recall my saved preference.");
    expect(recalled.piSessionId).not.toBe(first.piSessionId);
    expect(recalled.modelContext).toContain("NM-PRIVATE-ONE");
    expect(recalled.modelContext).toContain("concise Chinese responses");
    expect(recalled.modelContext).toContain("/memories/preferences/desktop/communication_style.md");
    expect(await readFile(recalled.sessionFile, "utf8")).not.toContain("NM-PRIVATE-ONE");
    expect(await readFile(preferencePath, "utf8")).toBe(preference);
    expect(unexpectedModelRequests).toBe(0);
    if (lazyExperiment) {
      const runs = (await readdir(configuration.dataRoot)).filter(name => name.startsWith(".run-"));
      expect(runs).toHaveLength(1);
      const importContract = lazyExperiment === "otel" ? lazyOtelImportContract : lazyLitellmImportContract;
      const probeOptions = {
        cwd: root, env: { PATH: "/usr/bin:/bin", LITELLM_LOCAL_MODEL_COST_MAP: "True",
          OPENVIKING_CONFIG_FILE: join(configuration.dataRoot, runs[0]!, "ov.conf"),
          NEWMONEY_OV_ROOT_KEY: "synthetic-root", NEWMONEY_OV_EMBEDDING_KEY: "synthetic-key", NEWMONEY_OV_EXTRACTION_KEY: "synthetic-key" },
        timeout: 30_000, maxBuffer: 1_048_576
      };
      const result = await promisify(execFile)(join(runtimeRoot, "bin/python3.12"), ["-I", "-B", "-c", importContract], probeOptions);
      expect(result.stdout.trim()).toBe(`LAZY_${lazyExperiment.toUpperCase()}_IMPORT_CONTRACT_PASS`);
      if (lazyLitellmExperiment) {
        const probe = fileURLToPath(new URL("../../../eng/capabilities/openviking-runtime/private_litellm_probe.py", import.meta.url));
        for (const mode of ["requests", "missing"] as const) {
          const checked = await promisify(execFile)(join(runtimeRoot, "bin/python3.12"), ["-I", "-B", probe, mode], probeOptions);
          expect(JSON.parse(checked.stdout)).toEqual({ status: "PASS", mode, deniedConnections: 0,
            ...(mode === "requests" ? { chat: 2, embedding: 2, rejected: 4, unexpected: 0 } : { checks: 4 }) });
        }
      }
      expect(unexpectedModelRequests).toBe(0);
    }
    await loop.close(); loop = undefined;
    await activation.setEnabled(false);
    await expect(connect()).rejects.toThrow("denied");
    expect(activation.get()).toMatchObject({ lifecycle: "stopped" });
    expect((await readdir(configuration.dataRoot)).some(name => name.startsWith(".run-"))).toBe(false);
    expect((await runtimeTreeIdentity(runtimeRoot)).sha256).toBe(originalTree.sha256);
    expect(admissionMs).toHaveLength(3); expect(nativeMs).toHaveLength(3);
    expect(healthReadyMs).toHaveLength(3);
    if (profileImports) {
      expect(importProfiles).toHaveLength(3);
      for (const profile of importProfiles) expect(profile).toHaveLength(12);
    }
    console.info(JSON.stringify({ result: "PRIVATE_MEMORY_STARTUP_PHASES", freshInstallation, interpreterPrecheckMs, profileImports,
      ...(lazyLitellmExperiment ? { litellmRequestsAndMissingDependency: "PASS" } : {}),
      lazyOtelExperiment, lazyLitellmExperiment, ...(lazyExperiment ? { productionAdmission: "REJECTED_TEST_KEY" } : {}),
      admissionMs, nativeAndProvisionMs: nativeMs, healthReadyMs,
      provisionMs: nativeMs.map((duration, index) => duration - healthReadyMs[index]!),
      ...(profileImports ? { importProfiles } : {}),
      treeFiles: originalTree.files, treeBytes: originalTree.bytes }));
  } finally {
    try {
      const stopped = await Promise.allSettled([loop?.close(), broker?.stop()]);
      if (model.listening) await new Promise<void>((resolve, reject) => model.close(error => error ? reject(error) : resolve()));
      // Preserve the isolated fixture if physical cleanup could not be confirmed.
      expect(stopped.every(result => result.status === "fulfilled"), "Private session fixture cleanup incomplete.").toBe(true);
      await rm(root, { recursive: true, force: true });
    } finally {
      admissionSpy.mockRestore(); nativeSpy.mockRestore(); fetchSpy.mockRestore();
      spawnSpy?.mockRestore(); vi.unstubAllEnvs();
    }
  }
}, 240_000);
