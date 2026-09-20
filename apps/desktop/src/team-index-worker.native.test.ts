import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import type { UtilityProcess } from "electron";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { createNativeKnowledgeSession, createKnowledgeAgentLoop } from "../../../packages/pi-runtime/src/team-knowledge-native.test-support.js";
import { EnterpriseContextController } from "../../agent-host/src/context/enterprise-context-controller.js";
import { EnterpriseCredentialBrokerClient } from "../../agent-host/src/context/enterprise-credential-broker-client.js";
import { createTeamModelPortChannel } from "../../agent-host/src/context/team-model-port-channel.js";
import { startNativeTeamModelWorker } from "./native-team-model-worker.mjs";
import { relayNativeTeamModelWorker } from "./native-team-model-relay.js";
import { SharedKnowledgeReceiptBinding } from "./shared-knowledge-receipt-binding.js";
import { writeTeamIndexJob } from "./team-index-job.js";
import { captureTeamIndexArtifact } from "./team-index-artifact.js";
import { openPublishedTeamIndex } from "./team-index-reader.js";
import { loadLocalMemoryIdentity } from "./local-memory-identity.mjs";
import type { createInstalledLocalMemory } from "./installed-local-memory.js";
const nativeObservation = vi.hoisted(() => ({ latest: undefined as { pid: number; completion: Promise<unknown> } | undefined,
  onStart: undefined as (() => void) | undefined }));
vi.mock("./native-team-model-worker.mjs", async importOriginal => {
  const actual = await importOriginal<typeof import("./native-team-model-worker.mjs")>();
  return { ...actual, async startNativeTeamModelWorker(...args: Parameters<typeof actual.startNativeTeamModelWorker>) {
    const worker = await actual.startNativeTeamModelWorker(...args);
    nativeObservation.latest = worker; nativeObservation.onStart?.(); return worker;
  } };
});
vi.mock("electron", async () => ({ MessageChannelMain: (await import("node:worker_threads")).MessageChannel }));
import { AgentHostServer } from "../../agent-host/src/host-server.js";
import { TeamIndexSettingsClient } from "../../agent-host/src/context/team-index-settings-client.js";
import { EnterpriseCredentialSupervisor } from "./enterprise-credential-supervisor.js";
import { SharedKnowledgeReceiptBroker } from "./shared-knowledge-receipt-broker.js";
import { TeamWorkerSupervisor } from "./team-worker-supervisor.js";
import { installNativeTeamFixture } from "./team-runtime-native.test-support.js";

const python = process.env.PI67_TEAM_MODEL_TEST_PYTHON;
const bootstrap = fileURLToPath(new URL("../../../eng/capabilities/openviking-runtime/team_index_worker.py", import.meta.url));
afterEach(() => { vi.unstubAllGlobals(); });

it.skipIf(!python || process.platform !== "darwin" || process.arch !== "arm64").each(["success", "deny", "cancel", "revision-mismatch", "model-error"])(
  "builds a native team index and publishes only with an explicit synthetic commit guard: %s", async (mode) => {
    const lifetime = new AbortController();
    const teamId = "00000000-0000-4000-8000-000000000001", epoch = "00000000-0000-4000-8000-000000000002";
    const model = { baseUrl: "https://model.invalid/v1", id: "fixture" };
    const authorize = vi.fn<typeof fetch>(async () => mode === "deny" ? Response.json({}, { status: 403 }) : Response.json({
      userId: "user", teamId, role: "member", permissionRevision: "a".repeat(64),
      issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      modelPolicy: { teamId, revision: "1", allowedModels: [{ purpose: "embedding", endpoint: model.baseUrl, modelId: model.id }] }
    }));
    vi.stubGlobal("fetch", authorize);
    const broker = new EnterpriseCredentialBrokerClient({ postMessage() { throw new Error("Unexpected credential mutation"); } });
    broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential: {
      endpoint: "https://service.invalid", accessToken: "synthetic-token", userId: "user", accountId: teamId, expiresAt: Date.now() + 600_000
    } });
    const controller = new EnterpriseContextController({ read: async () => ({ enterpriseGatewayEndpoint: "https://service.invalid" }) } as never,
      {} as never, { sendFor() {} } as never, broker);
    const temporary = await mkdtemp(join(tmpdir(), "new-money-team-index-"));
    let physicalCleanupConfirmed = true;
    try {
      const localProfileId = await loadLocalMemoryIdentity(temporary);
      const scope = { teamId, scopeKind: "team" as const, scopeId: teamId };
      const owner = { ...scope, localProfileId, endpoint: "https://service.invalid", userId: "user" };
      const binding = new SharedKnowledgeReceiptBinding(join(temporary, "team-projections", "receipts"), owner);
      const staging = join(temporary, "team-projections", binding.scopeKey, "staging");
      await mkdir(staging, { recursive: true, mode: 0o700 });
      const installed = mode === "success" ? await installNativeTeamFixture(python!, temporary,
        AbortSignal.any([lifetime.signal, AbortSignal.timeout(180_000)])) : undefined;
      const admitted = await installed?.teamPreparation.prepareIndexWorker(owner, lifetime.signal);
      const root = admitted?.directory ?? await mkdtemp(join(staging, "run-"));
      const canonicalContent = JSON.stringify(["newmoney.knowledge.v1", "sop", "Synthetic SOP", "Shipping", "Check the order before shipping."]);
      const document = { assetId: "00000000-0000-4000-8000-000000000001", canonicalContent,
        contentRevision: createHash("sha256").update(canonicalContent).digest("hex") };
      await binding.receive(Buffer.from(JSON.stringify({ ...scope, epoch, nextCursor: "1", headCursor: "1", hasMore: false,
        permissionRevision: "a".repeat(64), issuedAt: "2026-09-13T00:00:00Z", leaseExpiresAt: "2026-09-13T00:01:00Z",
        changes: [{ ...document, cursor: "1", operation: "upsert" }] })),
      { ...scope, epoch: null, cursor: "0", permissionRevision: "a".repeat(64), limit: 100 });
      const original = await lstat(root);
      const assertStorage = async () => {
        const current = await lstat(root);
        if (current.ino !== original.ino || current.dev !== original.dev || current.isSymbolicLink()) throw new Error("Test staging changed.");
      };
      let invoked = 0, cleanupConfirmed = false;
      let worker: Awaited<ReturnType<typeof startNativeTeamModelWorker>> | undefined;
      const host = Object.assign(new EventEmitter(), { postMessage() {} }) as unknown as UtilityProcess;
      const supervisor = new TeamWorkerSupervisor(() => host, async (options, signal) => {
        worker = await startNativeTeamModelWorker({ ...options,
        attachModelChannel(channel) {
          const ports = new MessageChannel();
          const hostChannel = createTeamModelPortChannel(ports.port2);
          const relay = controller.attachTeamModelChannel(hostChannel, {
            teamId, projectId: null, models: { embedding: model, extraction: model }, signal: lifetime.signal,
            async invoke(purpose, _selected, body, signal) {
              expect(purpose).toBe("embedding"); invoked += 1;
              if (mode === "cancel") { lifetime.abort(); expect(signal.aborted).toBe(true); return new Promise<never>(() => undefined); }
              if (mode === "model-error") return { status: 401, body: Buffer.from('{"error":{"message":"synthetic private upstream detail"}}') };
              const request = JSON.parse(Buffer.from(body).toString()) as { input: string | string[] };
              const inputs = Array.isArray(request.input) ? request.input : [request.input];
              return { status: 200, body: Buffer.from(JSON.stringify({ model: model.id,
                data: inputs.map((_, index) => ({ index, embedding: [0.25, 0.75, 0, 0, 0, 0, 0, 0] })) })) };
            }
          });
          const main = relayNativeTeamModelWorker(channel, ports.port1, lifetime.signal);
          return { stop() { main.stop(); relay.stop(); } };
        }
        }, signal);
        return worker;
      });
      // Success uses actual installed-tree admission with ephemeral test trust.
      // Failure branches and Host reservation remain fixtures, not product startup.
      const prepared = admitted ?? { owner, scopeKey: binding.scopeKey, directory: root, bootstrap, assertStorage,
        runtime: { runtimeRoot: "/synthetic-admission", python: python!, tree: { sha256: "fixture", files: 1, bytes: 1 } },
        async assertCurrent() { lifetime.signal.throwIfAborted(); await assertStorage(); },
        async assertLaunchable(signal: AbortSignal) { signal.throwIfAborted(); await assertStorage(); },
        async discard() { throw new Error("Native fixture retains staging until group absence is confirmed."); } };
      const preparation = { prepare: async () => prepared, prepareIndexWorker: async () => prepared, writeIndexJob: writeTeamIndexJob } satisfies ReturnType<typeof createInstalledLocalMemory>["teamPreparation"];
      const task = await supervisor.indexJobs.prepare(preparation, { owner, binding,
        models: { embedding: { endpoint: model.baseUrl, model: model.id, dimension: 8 }, extraction: { endpoint: model.baseUrl, model: model.id } },
        limits: { maxPages: 10, maxAssets: 100 }, assertReadable: () => lifetime.signal.throwIfAborted(), signal: lifetime.signal });
      if (mode === "revision-mismatch") {
        const path = join(root, "job.json");
        await writeFile(path, (await readFile(path, "utf8")).replace(document.contentRevision, "0".repeat(64)));
      }
      physicalCleanupConfirmed = false;
      task.register(teamId); supervisor.handleMessage(host, { type: "team-worker-start", requestId: teamId });
      const timeout = setTimeout(() => lifetime.abort(), 45_000);
      try {
        const outcome = await task.completion.then(value => ({ ok: true as const, value }), () => ({ ok: false as const }));
        if (!worker) throw new Error("Native scheduler did not launch its worker.");
        const result = await worker.completion; cleanupConfirmed = true;
        clearTimeout(timeout); // Index deadline ends at physical exit; queries own separate bounds.
        const pid = worker.pid;
        expect(() => process.kill(-pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
        if (mode === "success") {
          expect(result.code).toBe(0); expect(invoked).toBeGreaterThan(0);
          expect(authorize).toHaveBeenCalledTimes(invoked);
          expect(JSON.parse(await readFile(join(root, "result.json"), "utf8"))).toEqual({
            schema: "newmoney.team-index-result.v1", scopeKey: binding.scopeKey,
            documents: [{ assetId: document.assetId, contentRevision: document.contentRevision }] });
          expect(await readdir(join(root, "index"))).not.toEqual([]);
          expect(outcome.ok).toBe(true);
          if (outcome.ok) {
            expect(outcome.value.documents).toEqual([{ assetId: document.assetId, contentRevision: document.contentRevision }]);
            expect(outcome.value.artifact.files).toBeGreaterThan(0); expect(outcome.value.artifact.bytes).toBeGreaterThan(0);
            await outcome.value.assertArtifactCurrent();
            // Explicit Main-only synthetic guard. No Host publication request,
            // production authorization/head check or retrieval is implied.
            const published = await outcome.value.publication.publish(async () => () => lifetime.signal.throwIfAborted(), lifetime.signal);
            expect(published.state).toBe("published-local");
            expect(JSON.parse(await readFile(join(temporary, "team-projections", binding.scopeKey, "current-index.json"), "utf8")))
              .toEqual(published.pointer);
            // Real restored reader -> verified copy -> FD3 query -> group exit ->
            // exact receipt version mapping. Runtime admission remains synthetic.
            const reader = await openPublishedTeamIndex({ memoryRoot: temporary, owner, binding, signal: lifetime.signal,
              models: { embedding: { endpoint: model.baseUrl, model: model.id, dimension: 8 }, extraction: { endpoint: model.baseUrl, model: model.id } },
              authorize: async () => () => lifetime.signal.throwIfAborted(), revalidate: async () => () => lifetime.signal.throwIfAborted() });
            cleanupConfirmed = false; // Preserve this entire fixture on uncertain query exit.
            try {
              const hits = await reader.queryVector({ vector: [0.25, 0.75, 0, 0, 0, 0, 0, 0], limit: 4,
                runtime: await installed!.teamQuery.prepareRuntime(lifetime.signal) });
              expect(hits).toEqual([{ assetId: document.assetId, contentRevision: document.contentRevision, score: expect.any(Number) }]);
              expect(() => process.kill(-nativeObservation.latest!.pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
              expect((await readdir(staging)).some(name => name.startsWith("query-"))).toBe(false);
              await reader.assertCurrent(hits); await outcome.value.assertArtifactCurrent();
              cleanupConfirmed = true;
            } finally { reader.dispose(); }
            cleanupConfirmed = false;
            await verifyPiKnowledgeFlow({ temporary, owner, document, snapshot: { epoch, cursor: "1" },
              prepareRuntime: signal => installed!.teamQuery.prepareRuntime(signal), signal: lifetime.signal });
            expect(() => process.kill(-nativeObservation.latest!.pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
            expect((await readdir(staging)).some(name => name.startsWith("query-"))).toBe(false);
            await outcome.value.assertArtifactCurrent(); cleanupConfirmed = true;
            const cancelledQuery = new AbortController();
            const cancelReader = await openPublishedTeamIndex({ memoryRoot: temporary, owner, binding, signal: cancelledQuery.signal,
              models: { embedding: { endpoint: model.baseUrl, model: model.id, dimension: 8 }, extraction: { endpoint: model.baseUrl, model: model.id } },
              authorize: async () => () => lifetime.signal.throwIfAborted(), revalidate: async () => () => lifetime.signal.throwIfAborted() });
            cleanupConfirmed = false;
            nativeObservation.onStart = () => cancelledQuery.abort(); // Only after real native spawn/attachment.
            try {
              await expect(cancelReader.queryVector({ vector: [0.25, 0.75, 0, 0, 0, 0, 0, 0], limit: 4,
                runtime: await installed!.teamQuery.prepareRuntime(cancelledQuery.signal) })).rejects.toThrow("unavailable");
              expect(cancelledQuery.signal.aborted).toBe(true);
              await nativeObservation.latest!.completion;
              expect(() => process.kill(-nativeObservation.latest!.pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
              expect((await readdir(staging)).some(name => name.startsWith("query-"))).toBe(false);
              await outcome.value.assertArtifactCurrent(); cleanupConfirmed = true;
            } finally { nativeObservation.onStart = undefined; cancelReader.dispose(); }
            // Diagnostic only, on this disposable synthetic generation. The SDK's
            // ordinary reopen/query/close must not be mistaken for a read-only API.
            const probe = fileURLToPath(new URL("../../../eng/capabilities/probe-team-index-readonly.py", import.meta.url));
            await expect(promisify(execFile)(python!, ["-I", "-B", probe, root], { timeout: 15_000, maxBuffer: 64 * 1024 })).rejects.toMatchObject({ code: 1 });
            await outcome.value.assertArtifactCurrent(); // Refused probes must leave the generation unchanged.
            await writeFile(join(root, "readonly-probe-fixture.json"), JSON.stringify({ schema: "newmoney.synthetic-readonly-probe.v1", dimension: 8 }), { mode: 0o600 });
            // Use the same Main copy bracket as the reader. The real SDK only
            // receives the copy; execFile settles after child exit before cleanup.
            const artifact = await captureTeamIndexArtifact({ directory: root, signal: lifetime.signal, assertCurrent: assertStorage });
            const copyStarted = performance.now(); let copyReady = 0, queryFinished = 0, copiedPath = "";
            await artifact.withWorkingCopy(async (directory, signal) => {
              copiedPath = directory; copyReady = performance.now(); signal.throwIfAborted();
              await writeFile(join(directory, "readonly-probe-fixture.json"), JSON.stringify({ schema: "newmoney.synthetic-readonly-probe.v1", dimension: 8 }), { mode: 0o600 });
              const { stdout: copiedOutput } = await promisify(execFile)(python!, ["-I", "-B", probe, directory], { timeout: 15_000, maxBuffer: 64 * 1024 });
              queryFinished = performance.now();
              const queried = JSON.parse(copiedOutput) as { hits: number; writeOpens: string[]; changedEntries: string[] };
              expect(queried.hits).toBeGreaterThan(0);
              expect(queried.writeOpens.some(path => path.endsWith("collection_meta.json.tmp"))).toBe(true);
              expect(queried.changedEntries.some(path => path.endsWith("collection_meta.json"))).toBe(true);
            }, lifetime.signal);
            await expect(lstat(copiedPath)).rejects.toMatchObject({ code: "ENOENT" });
            await outcome.value.assertArtifactCurrent(); // The published generation is still intact.
            console.info("Synthetic native working copy", { bytes: artifact.fingerprint.bytes, files: artifact.fingerprint.files,
              prepareMs: Math.round(copyReady - copyStarted), queryProcessMs: Math.round(queryFinished - copyReady),
              finalizeMs: Math.round(performance.now() - queryFinished) });
            const { stdout } = await promisify(execFile)(python!, ["-I", "-B", probe, root], { timeout: 15_000, maxBuffer: 64 * 1024 });
            const observation = JSON.parse(stdout) as { schema: string; hits: number; writeOpens: string[]; changedEntries: string[] };
            expect(observation.schema).toBe("newmoney.synthetic-readonly-probe-result.v1");
            expect(observation.hits).toBeGreaterThan(0);
            expect(observation.writeOpens.some(path => path.endsWith("collection_meta.json.tmp"))).toBe(true);
            expect(observation.changedEntries.some(path => path.endsWith("collection_meta.json"))).toBe(true);
            await expect(outcome.value.assertArtifactCurrent()).rejects.toThrow("changed");
            await installed!.assertUnchanged();
          }
        } else {
          expect(result.code).not.toBe(0);
          expect(await readdir(root)).not.toContain("result.json");
          if (mode === "model-error") {
            expect(invoked).toBeGreaterThan(0); expect(result.code).toBe(74);
            expect(authorize).toHaveBeenCalledTimes(invoked);
          } else {
            expect(invoked).toBe(mode === "cancel" ? 1 : 0);
            expect(authorize).toHaveBeenCalledTimes(mode === "revision-mismatch" ? 0 : 1);
          }
          if (mode === "revision-mismatch") expect(result.code).toBe(72);
          if (mode === "revision-mismatch") expect(await readdir(root)).toEqual(["job.json"]);
          expect(outcome.ok).toBe(false);
        }
      } finally {
        clearTimeout(timeout); await worker?.stop(); await supervisor.shutdown(); controller.shutdown();
        physicalCleanupConfirmed = cleanupConfirmed;
      }
    } finally {
      controller.shutdown();
      if (physicalCleanupConfirmed) await rm(temporary, { recursive: true, force: true });
    }
  }, 240_000
);

/** One published native generation through real Main/Host/Pi source owners.
 * Ephemeral signed native admission; synthetic HTTP/Main grants and provider stream, no Electron IPC. */
async function verifyPiKnowledgeFlow(input: {
  temporary: string; owner: ConstructorParameters<typeof SharedKnowledgeReceiptBinding>[1];
  document: { assetId: string; contentRevision: string; canonicalContent: string };
  snapshot: { epoch: string; cursor: string };
  prepareRuntime: ReturnType<typeof createInstalledLocalMemory>["teamQuery"]["prepareRuntime"]; signal: AbortSignal;
}) {
  const { temporary, owner, document, snapshot, signal } = input;
  const agentDir = join(temporary, "agent"); await mkdir(agentDir);
  const previousFetch = globalThis.fetch;
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir); vi.stubEnv("PI67_STORAGE_ROOT", temporary);
  vi.stubEnv("PI67_SESSION_CATALOG_DIR", join(temporary, "catalog"));
  const credential = { endpoint: owner.endpoint, userId: owner.userId, accountId: owner.teamId,
    accessToken: "synthetic-service", expiresAt: Date.now() + 600_000 };
  const mainCredentials = new EnterpriseCredentialSupervisor(() => ({
    load: async () => ({ storage: "available", credential }), store: async () => {}, clear: async () => {}
  }));
  const bootstrapMessage = await mainCredentials.bootstrapMessage();
  let mainAllowed = true, agentAllowed = true;
  const assertReadable = () => { signal.throwIfAborted(); if (!mainAllowed) throw new Error("Synthetic Main revocation"); };
  const mainAuthorization = vi.fn(async () => { assertReadable(); return { permissionRevision: "a".repeat(64), assertValid: assertReadable }; });
  const observation = vi.fn(async (observed: { snapshot: typeof snapshot; owner: typeof owner }) => {
    expect(observed.snapshot).toEqual(snapshot); expect(observed.owner).toEqual(owner); return assertReadable;
  });
  const main = new SharedKnowledgeReceiptBroker({
    createBinding: scope => mainCredentials.createReceiptBinding(join(temporary, "team-projections", "receipts"), owner.localProfileId, scope),
    authorize: mainAuthorization, revalidateIndex: observation,
    queryConfiguration: () => ({ memoryRoot: temporary, prepareRuntime: input.prepareRuntime })
  });
  const messages: string[] = [], pending = new Set<Promise<void>>(), transportErrors: unknown[] = [];
  const hostCredentials = new EnterpriseCredentialBrokerClient({ postMessage(message) {
    const operation = main.operation(message); if (!operation) throw new Error("Unexpected synthetic transport message");
    messages.push((message as { type: string }).type);
    const task = operation.then(result => { hostCredentials.handleReceiptResult(result); }).catch((error: unknown) => { transportErrors.push(error); });
    pending.add(task); void task.finally(() => pending.delete(task));
  } });
  hostCredentials.applyBootstrap(bootstrapMessage);
  const model = { baseUrl: "https://model.invalid/v1", id: "fixture" };
  const settings = new TeamIndexSettingsClient({ postMessage(message) {
    if (message.type !== "team-index-settings-read") throw new Error("Unexpected settings mutation");
    settings.handleMessage({ type: "team-index-settings-result", requestId: message.requestId, ok: true, settings: {
      extraction: { provider: "missing-provider", model: "not-resolved" },
      embedding: { protocol: "openai-compatible", endpoint: model.baseUrl, model: model.id, dimension: 8, apiKey: "synthetic-embedding" }
    } });
  } });
  const embedding = vi.fn(() => Response.json({ model: model.id, data: [{ index: 0, embedding: [0.25, 0.75, 0, 0, 0, 0, 0, 0] }] }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async url => {
    const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (address === `${model.baseUrl}/embeddings`) return embedding();
    if (address !== `${owner.endpoint}/v1/agent/teams/${owner.teamId}/authorization`
      && address !== `${owner.endpoint}/v1/agent/teams/${owner.teamId}/projects/${owner.teamId}/authorization`) throw new Error("Unexpected synthetic HTTP route");
    return Response.json({ userId: owner.userId, teamId: owner.teamId, role: "member",
      ...(address.includes("/projects/") ? { projectId: owner.teamId } : {}), permissionRevision: "a".repeat(64),
      issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      modelPolicy: { teamId: owner.teamId, revision: "1", allowedModels: [
        { purpose: "embedding", endpoint: model.baseUrl, modelId: model.id },
        ...(agentAllowed ? [{ purpose: "agent", endpoint: model.baseUrl, modelId: model.id }] : [])
      ] }
    });
  }));
  const authorization = new EnterpriseContextController({ read: async () => ({ enterpriseGatewayEndpoint: owner.endpoint }) } as never,
    {} as never, { sendFor() {} } as never, hostCredentials);
  const loadRuntime = vi.fn(async () => { throw new Error("The isolated Pi loop must not use the Host runtime loader"); });
  let server: AgentHostServer | undefined;
  try {
    await writeFile(join(agentDir, "openviking.json"), JSON.stringify({ enterpriseGatewayEndpoint: owner.endpoint }));
    server = new AgentHostServer(loadRuntime, { agentDir, enterpriseCredentialBroker: hostCredentials, teamIndexSettings: settings });
    const access = server.teamKnowledge.forWorkspace("synthetic-workspace");
    const session = createNativeKnowledgeSession({ directory: temporary, identity: { userId: owner.userId,
      endpoint: owner.endpoint, teamId: owner.teamId, projectId: owner.teamId }, model, access, signal,
      authorizeTeamSession: authorization.authorizeTeamSession.bind(authorization) });
    const call = session.call;
    const search = await call("viking_team_search", { query: "shipping", scope: "team", limit: 1 });
    expect(search.details).toMatchObject({ snapshot, items: [{ assetId: document.assetId, contentRevision: document.contentRevision, scope: "team" }] });
    const read = await call("viking_team_read", { assetId: document.assetId });
    expect(read.details).toMatchObject({ reference: { scope: "team", assetId: document.assetId, contentRevision: document.contentRevision },
      document: { kind: "sop", title: "Synthetic SOP", summary: "Shipping", body: "Check the order before shipping." } });
    expect(embedding).toHaveBeenCalledTimes(1); expect(observation).toHaveBeenCalled(); expect(mainAuthorization).toHaveBeenCalled();
    expect(messages.filter(type => type === "shared-knowledge-receipt-close")).toHaveLength(2);
    await session.persistAndReopen(search, read);
    const beforeUnselected = messages.length;
    await expect(call("viking_team_read", { assetId: document.assetId })).rejects.toThrow("Search team knowledge");
    expect(messages).toHaveLength(beforeUnselected);
    await session.verifyHistory();
    expect(messages.filter(type => type === "shared-knowledge-index-read-current")).toHaveLength(1);
    expect(embedding).toHaveBeenCalledTimes(1); session.assertReadOnlyHistory();
    mainAllowed = false;
    await expect(session.verifyHistory()).rejects.toThrow();
    mainAllowed = true; await session.verifyHistory();
    agentAllowed = false;
    const beforeDenied = messages.length;
    await expect(session.verifyHistory()).rejects.toThrow();
    await expect(call("viking_team_search", { query: "shipping", scope: "team" })).rejects.toThrow();
    expect(messages).toHaveLength(beforeDenied); expect(embedding).toHaveBeenCalledTimes(1);
    session.assertReadOnlyHistory();
    agentAllowed = true;
    const loop = await createKnowledgeAgentLoop({ directory: temporary, identity: { userId: owner.userId,
      endpoint: owner.endpoint, teamId: owner.teamId, projectId: owner.teamId }, model, access,
      assetId: document.assetId,
      document: { kind: "sop", title: "Synthetic SOP", summary: "Shipping", body: "Check the order before shipping." },
      authorizeTeamSession: authorization.authorizeTeamSession.bind(authorization) });
    try {
      await loop.run(); expect(embedding).toHaveBeenCalledTimes(2);
      agentAllowed = false;
      const beforeReplay = messages.length;
      await loop.assertReplayDenied(/model is not authorized/u);
      expect(messages).toHaveLength(beforeReplay); expect(embedding).toHaveBeenCalledTimes(2);
    } finally { await loop.close(); }
    expect(loadRuntime).not.toHaveBeenCalled(); expect(transportErrors).toEqual([]);
  } finally {
    await server?.shutdown(); authorization.shutdown(); settings.shutdown(); hostCredentials.shutdown(); main.invalidate();
    await Promise.all(pending); vi.stubGlobal("fetch", previousFetch); vi.unstubAllEnvs();
  }
}
