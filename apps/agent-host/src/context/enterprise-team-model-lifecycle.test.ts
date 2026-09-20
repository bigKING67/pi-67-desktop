import { Duplex } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseContextController } from "./enterprise-context-controller.js";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { enterprisePowerEpoch } from "./enterprise-power-epoch.js";
import { TeamModelPortAdmission } from "./team-model-port-admission.js";
import { MessageChannel } from "node:worker_threads";
import { TeamModelRelay } from "@pi67/protocol";
import { createTeamIndexModelSource, type TeamIndexModels } from "./team-index-model-source.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); enterprisePowerEpoch.transition("resume"); });
it.each(["bootstrap", "config", "shutdown", "suspend", "rebind"].flatMap(action => (["port", "worker"] as const).map(phase => ({ action, phase }))))("retires pending $phase reservations before $action completes", async ({ action, phase }) => {
  const f = fixture(), admission = new TeamModelPortAdmission(), ports = new MessageChannel();
  const invoke = vi.fn(async () => ({ status: 200, body: Buffer.from("{}") }));
  const reservation = f.controller.reserveTeamModelPort(admission, { teamId: "team", projectId: "project", workspaceId: "workspace",
    models: { embedding: model, extraction: model }, invoke, signal: new AbortController().signal }, phase);
  const rejected = expect(reservation.connected).rejects.toThrow("unavailable");
  try {
    if (action === "bootstrap") f.bootstrap();
    if (action === "config") f.controller.retireTeamModelChannels();
    if (action === "shutdown") f.controller.shutdown();
    if (action === "suspend") enterprisePowerEpoch.transition("suspend");
    if (action === "rebind") await f.controller.bindWorkspace("workspace", "team", "next", "fixture").catch(() => undefined);
    await rejected;
    const close = vi.spyOn(ports.port1, "close");
    admission.handleMessage({ data: { type: "team-model-port-attach", requestId: reservation.requestId }, ports: [ports.port1] });
    expect(close).toHaveBeenCalledOnce(); expect(invoke).not.toHaveBeenCalled();
  } finally { admission.shutdown(); f.controller.shutdown(); ports.port2.close(); }
});
const model = { baseUrl: "https://model.invalid/v1", id: "fixture" };
it.each(["port", "worker"] as const)("binds the %s selection before transfer and still authorizes each actual model frame", async phase => {
  const f = fixture(), admission = new TeamModelPortAdmission(), ports = new MessageChannel(), responses: Buffer[] = [];
  const invoke = vi.fn(async () => ({ status: 200, body: Buffer.from("{}") }));
  const selected = { embedding: { ...model }, extraction: { ...model } };
  const reservation = f.controller.reserveTeamModelPort(admission, { teamId: "team", projectId: null,
    models: selected, invoke, signal: new AbortController().signal }, phase);
  selected.embedding.id = "mutated-after-reservation";
  const peer = new TeamModelRelay(ports.port2, { async accept(bytes) { responses.push(Buffer.from(bytes)); }, close() {} }); peer.start();
  try {
    if (phase === "worker") reservation.activate();
    admission.handleMessage({ data: { type: "team-model-port-attach", requestId: reservation.requestId }, ports: [ports.port1] });
    await reservation.connected; await peer.write(frame());
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(invoke).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]).toEqual(["embedding", model, expect.any(Uint8Array), expect.any(AbortSignal)]);
    f.bootstrap(); await vi.waitFor(() => expect(ports.port2.listenerCount("message")).toBe(0));
  } finally { peer.stop(); admission.shutdown(); f.controller.shutdown(); }
});
function frame() {
  const body = Buffer.from(JSON.stringify({ type: "team-model-request", requestId: "a".repeat(32), purpose: "embedding",
    endpoint: model.baseUrl, model: model.id, body: Buffer.from('{"model":"fixture"}').toString("base64") }));
  const header = Buffer.alloc(4); header.writeUInt32BE(body.length); return Buffer.concat([header, body]);
}
function fixture(indexScope = false) {
  const credential = { endpoint: "https://service.invalid", accessToken: "synthetic-token", userId: "user", accountId: indexScope ? "00000000-0000-4000-8000-000000000001" : "team", expiresAt: Date.now() + 600_000 };
  const postMessage = vi.fn();
  const broker = new EnterpriseCredentialBrokerClient({ postMessage });
  const bootstrap = () => broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential });
  bootstrap();
  const configuration = { read: vi.fn(async () => ({ enterpriseGatewayEndpoint: credential.endpoint })) };
  const controller = new EnterpriseContextController(configuration as never, { require() { throw new Error("Synthetic rebind stopped"); } } as never,
    { sendFor() {} } as never, broker);
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const path = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const projectId = path.includes("/projects/") ? path.split("/projects/")[1]!.split("/")[0]! : null;
    if (path.includes("/shared-assets/sync?")) return Response.json({ teamId: credential.accountId, scopeKind: projectId ? "project" : "team", scopeId: projectId ?? credential.accountId,
      epoch: credential.accountId, nextCursor: "1", headCursor: "1", hasMore: false, changes: new URL(path).searchParams.get("cursor") === "1" ? [] : [{ cursor: "1", assetId: credential.accountId,
        operation: "revoke", contentRevision: "b".repeat(64) }], permissionRevision: "a".repeat(64),
      issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    if (!path.endsWith("/authorization")) return Response.json({});
    return Response.json({ userId: credential.userId, teamId: credential.accountId, ...(projectId ? { projectId } : {}),
      role: "member", permissionRevision: "a".repeat(64), issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      modelPolicy: { teamId: credential.accountId, revision: "1", allowedModels: (indexScope ? ["embedding", "extraction"] : ["embedding"]).map(purpose => ({ purpose, endpoint: model.baseUrl, modelId: model.id })) } });
  });
  vi.stubGlobal("fetch", fetcher);
  const open = (workspaceId = "workspace", projectId: string | null = "project") => {
    const writes: Buffer[] = [];
    const channel = new Duplex({ read() {}, write(chunk: Buffer, _encoding, done) { writes.push(chunk); done(); } });
    const caller = new AbortController();
    const invoke = vi.fn(async (_purpose: unknown, _model: unknown, _body: unknown, _signal: AbortSignal) => new Promise<{ status: number; body: Uint8Array }>(() => undefined));
    const handle = controller.attachTeamModelChannel(channel, { teamId: "team", projectId, workspaceId,
      models: { embedding: model, extraction: model }, invoke, signal: caller.signal });
    return { channel, writes, caller, invoke, handle, send: () => channel.emit("data", frame()) };
  };
  return { credential, broker, bootstrap, postMessage, configuration, controller, fetcher, open };
}

it.each([null, "00000000-0000-4000-8000-000000000002"])("catches up exact scope and confirms sync close before index preparation: %s", async projectId => {
  const f = fixture(true), admission = new TeamModelPortAdmission(), start = vi.fn(), invoke = vi.fn();
  const reserve = vi.spyOn(admission, "reserve");
  const appendGate = Promise.withResolvers<void>(), closeGate = Promise.withResolvers<void>();
  f.postMessage.mockImplementation(async message => {
    if (message.type === "shared-knowledge-receipt-append") await appendGate.promise;
    if (message.type === "shared-knowledge-receipt-close") await closeGate.promise;
    const result = message.type === "shared-knowledge-receipt-open"
      ? { handleId: f.credential.accountId, userId: f.credential.userId, endpoint: f.credential.endpoint, progress: { epoch: null, cursor: "0" } }
      : message.type === "shared-knowledge-receipt-append" ? { progress: { epoch: f.credential.accountId, cursor: "1" } } : {};
    f.broker.handleReceiptResult({ type: `${message.type}-result`, requestId: message.requestId,
      ok: message.type !== "shared-knowledge-index-prepare", ...result,
      ...(message.type === "shared-knowledge-index-prepare" ? { errorCode: "INDEX_FAILED" } : {}) });
  });
  const run = f.controller.indexKnowledge(admission, { start }, { teamId: f.credential.accountId, projectId,
    models: { embedding: model, extraction: model }, embeddingDimension: 4, signal: new AbortController().signal, invoke });
  const rejected = expect(run).rejects.toThrow();
  try {
    await vi.waitFor(() => expect(f.postMessage.mock.calls.some(([message]) => message.type === "shared-knowledge-receipt-append")).toBe(true));
    expect(f.postMessage.mock.calls.map(([message]) => message.type)).toEqual(["shared-knowledge-receipt-open", "shared-knowledge-receipt-append"]);
    expect(reserve).not.toHaveBeenCalled(); appendGate.resolve();
    await vi.waitFor(() => expect(f.postMessage.mock.calls.at(-1)?.[0].type).toBe("shared-knowledge-receipt-close"));
    expect(reserve).not.toHaveBeenCalled(); expect(f.postMessage).toHaveBeenCalledTimes(3); closeGate.resolve();
    await rejected;
    expect(f.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "shared-knowledge-receipt-open", "shared-knowledge-receipt-append", "shared-knowledge-receipt-close",
      "shared-knowledge-receipt-open", "shared-knowledge-index-prepare", "shared-knowledge-receipt-close"
    ]);
    const scope = { teamId: f.credential.accountId, scopeKind: projectId ? "project" : "team", scopeId: projectId ?? f.credential.accountId };
    expect(f.postMessage.mock.calls[0]?.[0].scope).toEqual(scope); expect(f.postMessage.mock.calls[3]?.[0].scope).toEqual(scope);
    expect(invoke).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  } finally { appendGate.resolve(); closeGate.resolve(); f.controller.shutdown(); admission.shutdown(); }
});

it.each(["page", "append", "close", "budget", "caller", "bootstrap", "config", "shutdown", "suspend", "rebind"])(
  "never prepares or invokes models after index catch-up fails: %s", async mode => {
    const f = fixture(true), admission = new TeamModelPortAdmission(), caller = new AbortController();
    const reserve = vi.spyOn(admission, "reserve"), start = vi.fn(), invoke = vi.fn(), original = f.fetcher.getMockImplementation()!;
    const pending = !["page", "append", "close", "budget"].includes(mode);
    let pageCount = 0, pageSignal: AbortSignal | undefined;
    f.fetcher.mockImplementation(async (url, init) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (!path.includes("/shared-assets/sync?")) return original(url, init);
      pageCount += 1; pageSignal = init?.signal ?? undefined;
      if (pending) return new Promise((_resolve, reject) => pageSignal!.addEventListener("abort", () => reject(new Error("Synthetic cancelled sync")), { once: true }));
      if (mode === "page") return Response.json({}, { status: 503 });
      if (mode !== "budget") return original(url, init);
      return Response.json({ teamId: f.credential.accountId, scopeKind: "team", scopeId: f.credential.accountId, epoch: f.credential.accountId,
        nextCursor: String(pageCount), headCursor: "11", hasMore: true, changes: [{ cursor: String(pageCount), assetId: f.credential.accountId,
          operation: "revoke", contentRevision: "b".repeat(64) }], permissionRevision: "a".repeat(64),
        issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    });
    f.postMessage.mockImplementation(message => {
      const failed = message.type === `shared-knowledge-receipt-${mode}`;
      const result = message.type === "shared-knowledge-receipt-open"
        ? { handleId: f.credential.accountId, userId: f.credential.userId, endpoint: f.credential.endpoint, progress: { epoch: null, cursor: "0" } }
        : message.type === "shared-knowledge-receipt-append" ? { progress: { epoch: f.credential.accountId, cursor: String(pageCount) } } : {};
      queueMicrotask(() => f.broker.handleReceiptResult({ type: `${message.type}-result`, requestId: message.requestId,
        ok: !failed, ...(failed ? { errorCode: "PERSISTENCE_FAILED" } : result) }));
    });
    const run = f.controller.indexKnowledge(admission, { start }, { teamId: f.credential.accountId, projectId: null, workspaceId: "workspace",
      models: { embedding: model, extraction: model }, embeddingDimension: 4, signal: caller.signal, invoke });
    const rejected = expect(run).rejects.toThrow();
    try {
      if (pending) {
        await vi.waitFor(() => expect(pageCount).toBe(1));
        if (mode === "caller") caller.abort();
        if (mode === "bootstrap") f.bootstrap();
        if (mode === "config") f.controller.retireTeamModelChannels();
        if (mode === "shutdown") f.controller.shutdown();
        if (mode === "suspend") enterprisePowerEpoch.transition("suspend");
        if (mode === "rebind") await f.controller.bindWorkspace("workspace", f.credential.accountId, "next", "fixture").catch(() => undefined);
        expect(pageSignal?.aborted).toBe(true);
      }
      await rejected;
      expect(pageCount).toBe(mode === "budget" ? 10 : 1);
      expect(f.postMessage.mock.calls.some(([message]) => message.type.startsWith("shared-knowledge-index-"))).toBe(false);
      expect(reserve).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
    } finally { caller.abort(); f.controller.shutdown(); admission.shutdown(); }
  }
);

it.each(["caller", "bootstrap", "config", "shutdown", "suspend", "rebind"])("retires index preparation before reservation on %s", async action => {
  const f = fixture(true), caller = new AbortController(), admission = new TeamModelPortAdmission();
  const start = vi.fn(), reserve = vi.spyOn(admission, "reserve"), invoke = vi.fn();
  f.postMessage.mockImplementation(message => {
    if (message.type === "shared-knowledge-receipt-append") queueMicrotask(() => f.broker.handleReceiptResult({
      type: "shared-knowledge-receipt-append-result", requestId: message.requestId, ok: true, progress: { epoch: f.credential.accountId, cursor: "1" }
    }));
    if (message.type === "shared-knowledge-receipt-open") queueMicrotask(() => f.broker.handleReceiptResult({
      type: "shared-knowledge-receipt-open-result", requestId: message.requestId, ok: true, handleId: f.credential.accountId,
      userId: f.credential.userId, endpoint: f.credential.endpoint, progress: { epoch: null, cursor: "0" }
    }));
    if (message.type === "shared-knowledge-receipt-close") queueMicrotask(() => f.broker.handleReceiptResult({ type: "shared-knowledge-receipt-close-result", requestId: message.requestId, ok: true }));
  });
  const run = f.controller.indexKnowledge(admission, { start }, { teamId: f.credential.accountId, projectId: null, workspaceId: "workspace",
    models: { embedding: model, extraction: model }, embeddingDimension: 4, signal: caller.signal, invoke });
  const rejected = expect(run).rejects.toThrow();
  try {
    await vi.waitFor(() => expect(f.postMessage.mock.calls.some(([value]) => value.type === "shared-knowledge-index-prepare")).toBe(true));
    if (action === "caller") caller.abort();
    if (action === "bootstrap") f.bootstrap();
    if (action === "config") f.controller.retireTeamModelChannels();
    if (action === "shutdown") f.controller.shutdown();
    if (action === "suspend") enterprisePowerEpoch.transition("suspend");
    if (action === "rebind") await f.controller.bindWorkspace("workspace", f.credential.accountId, "next", "fixture").catch(() => undefined);
    await rejected;
    expect(reserve).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
  } finally { caller.abort(); admission.shutdown(); f.controller.shutdown(); }
});

it("denies initial model policy before opening receipts or reserving a worker", async () => {
  const f = fixture(true), admission = new TeamModelPortAdmission(), start = vi.fn(), invoke = vi.fn();
  try {
    await expect(f.controller.indexKnowledge(admission, { start }, { teamId: f.credential.accountId, projectId: null,
      models: { embedding: model, extraction: { ...model, id: "not-allowed" } }, embeddingDimension: 4, signal: new AbortController().signal, invoke })).rejects.toThrow();
    expect(f.postMessage).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
  } finally { admission.shutdown(); f.controller.shutdown(); }
});

it("captures index scope/models once and reserves only after Main preparation", async () => {
  const f = fixture(true), admission = new TeamModelPortAdmission(), reserve = vi.spyOn(admission, "reserve"), start = vi.fn();
  f.postMessage.mockImplementation(message => {
    const reply = message.type === "shared-knowledge-receipt-open"
      ? { type: "shared-knowledge-receipt-open-result", requestId: message.requestId, ok: true, handleId: f.credential.accountId,
        userId: f.credential.userId, endpoint: f.credential.endpoint, progress: { epoch: null, cursor: "0" } }
      : message.type === "shared-knowledge-index-prepare"
        ? { type: "shared-knowledge-index-prepare-result", requestId: message.requestId, ok: true, indexId: f.credential.accountId }
        : message.type === "shared-knowledge-receipt-append"
          ? { type: "shared-knowledge-receipt-append-result", requestId: message.requestId, ok: true, progress: { epoch: f.credential.accountId, cursor: "1" } }
        : { type: `${message.type}-result`, requestId: message.requestId, ok: message.type !== "shared-knowledge-index-register",
          ...(message.type === "shared-knowledge-index-register" ? { errorCode: "PERSISTENCE_FAILED" } : {}) };
    if (message.type === "shared-knowledge-index-prepare") expect(reserve).not.toHaveBeenCalled();
    queueMicrotask(() => f.broker.handleReceiptResult(reply));
  });
  const input = { teamId: f.credential.accountId, projectId: null, models: { embedding: { ...model }, extraction: { ...model } }, embeddingDimension: 4, signal: new AbortController().signal, invoke: vi.fn() };
  const run = f.controller.indexKnowledge(admission, { start }, input);
  input.teamId = "mutated"; input.models.embedding.id = "mutated";
  try {
    await expect(run).rejects.toThrow();
    expect(f.postMessage.mock.calls.find(([value]) => value.type === "shared-knowledge-receipt-open")?.[0]).toMatchObject({ scope: { teamId: f.credential.accountId, scopeKind: "team", scopeId: f.credential.accountId } });
    expect(f.postMessage.mock.calls.find(([value]) => value.type === "shared-knowledge-index-prepare")?.[0]).toMatchObject({ models: { embedding: { endpoint: model.baseUrl, model: model.id, dimension: 4 } } });
    expect(reserve).toHaveBeenCalledOnce(); expect(reserve.mock.calls[0]?.[2]).toBe("worker");
    expect(start).not.toHaveBeenCalled(); expect(input.invoke).not.toHaveBeenCalled();
  } finally { admission.shutdown(); f.controller.shutdown(); }
});

it("holds bounded Host index runs until cancelled configuration reads settle", async () => {
  const f = fixture(true), admission = new TeamModelPortAdmission(), caller = new AbortController();
  let resolve!: (value: { enterpriseGatewayEndpoint: string }) => void;
  const pendingConfiguration = new Promise<{ enterpriseGatewayEndpoint: string }>(yes => { resolve = yes; });
  f.configuration.read.mockImplementation(() => pendingConfiguration);
  const input = { teamId: f.credential.accountId, projectId: null, models: { embedding: { ...model }, extraction: { ...model } }, embeddingDimension: 4, signal: caller.signal, invoke: vi.fn() };
  const runs = Array.from({ length: 4 }, () => f.controller.indexKnowledge(admission, { start: vi.fn() }, input));
  for (const run of runs) void run.catch(() => undefined);
  await expect(f.controller.indexKnowledge(admission, { start: vi.fn() }, input)).rejects.toThrow();
  caller.abort(); resolve({ enterpriseGatewayEndpoint: f.credential.endpoint });
  expect((await Promise.allSettled(runs)).every(result => result.status === "rejected")).toBe(true);
  expect(f.postMessage).not.toHaveBeenCalled();
  f.controller.shutdown(); admission.shutdown();
  expect(f.configuration.read).toHaveBeenCalledTimes(4);
});

it.each([false, true])("checks the exact Main-verified head after index completion (changed=%s)", async changed => {
  const f = fixture(true), admission = new TeamModelPortAdmission(), id = f.credential.accountId;
  const invoke = vi.fn(), start = vi.fn(async () => ({ completion: Promise.resolve("completed" as const), stop: async () => "completed" as const }));
  const original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation(async (url, init) => {
    const path = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (!path.includes("/shared-assets/sync?") || !path.includes("limit=1&")) return original(url, init);
    return Response.json({ teamId: id, scopeKind: "team", scopeId: id, epoch: id,
      nextCursor: changed ? "8" : "7", headCursor: changed ? "8" : "7", hasMore: false,
      issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), permissionRevision: "a".repeat(64),
      changes: changed ? [{ cursor: "8", assetId: id, operation: "revoke", contentRevision: "b".repeat(64) }] : [] });
  });
  f.postMessage.mockImplementation(message => {
    const result = message.type === "shared-knowledge-receipt-open" ? { handleId: id, userId: "user", endpoint: "https://service.invalid", progress: { epoch: id, cursor: "1" } }
      : message.type === "shared-knowledge-receipt-append" ? { progress: { epoch: id, cursor: "1" } }
      : message.type === "shared-knowledge-index-prepare" ? { indexId: id }
      : message.type === "shared-knowledge-index-wait" ? { state: "verified-unpublished", snapshot: { epoch: id, cursor: "7" } } : {};
    if (message.type === "shared-knowledge-index-publish") Object.assign(result, { state: "published-local", snapshot: { epoch: id, cursor: "7" } });
    queueMicrotask(() => f.broker.handleReceiptResult({ type: `${message.type}-result`, requestId: message.requestId, ok: true, ...result }));
  });
  try {
    const run = f.controller.indexKnowledge(admission, { start }, { teamId: id, projectId: null, models: { embedding: model, extraction: model },
      embeddingDimension: 4, invoke, signal: new AbortController().signal });
    if (changed) await expect(run).rejects.toThrow("not current or authorized");
    else await expect(run).resolves.toEqual({ state: "published-local", snapshot: { epoch: id, cursor: "7" } });
    expect(f.fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://service.invalid/v1/agent/teams/${id}/authorization`, `https://service.invalid/v1/agent/teams/${id}/authorization`,
      `https://service.invalid/v1/agent/teams/${id}/shared-assets/sync?cursor=1&limit=50&epoch=${id}`,
      `https://service.invalid/v1/agent/teams/${id}/authorization`,
      `https://service.invalid/v1/agent/teams/${id}/shared-assets/sync?cursor=7&limit=1&epoch=${id}`
    ]);
    expect(start).toHaveBeenCalledOnce(); expect(invoke).not.toHaveBeenCalled();
    expect(f.postMessage.mock.calls.at(-1)?.[0].type).toBe("shared-knowledge-receipt-close");
  } finally { admission.shutdown(); f.controller.shutdown(); }
});

it.each(["caller", "bootstrap", "config", "shutdown", "suspend", "rebind"])("owns pending index model resolution through %s retirement", async action => {
  const f = fixture(true), admission = new TeamModelPortAdmission(), caller = new AbortController();
  let release!: (value: TeamIndexModels) => void;
  const loadModels = vi.fn((_signal: AbortSignal) => new Promise<TeamIndexModels>(resolve => { release = resolve; }));
  const run = f.controller.indexKnowledge(admission, { start: vi.fn() }, { teamId: f.credential.accountId, projectId: null,
    workspaceId: "workspace", signal: caller.signal, loadModels });
  const rejected = expect(run).rejects.toThrow();
  try {
    await vi.waitFor(() => expect(loadModels).toHaveBeenCalledOnce());
    if (action === "caller") caller.abort();
    if (action === "bootstrap") f.bootstrap();
    if (action === "config") f.controller.retireTeamModelChannels();
    if (action === "shutdown") f.controller.shutdown();
    if (action === "suspend") enterprisePowerEpoch.transition("suspend");
    if (action === "rebind") await f.controller.bindWorkspace("workspace", f.credential.accountId, "next", "fixture").catch(() => undefined);
    expect(loadModels.mock.calls[0]?.[0].aborted).toBe(true);
    release({ models: { embedding: model, extraction: model }, embeddingDimension: 4, invoke: vi.fn() });
    await rejected;
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.postMessage).not.toHaveBeenCalled();
  } finally { f.controller.shutdown(); admission.shutdown(); }
});

it("authorizes resolved models before any receipt/index work and sanitizes no permission into a grant", async () => {
  const f = fixture(true), admission = new TeamModelPortAdmission(), invoke = vi.fn();
  const loadModels = vi.fn(async () => ({ models: { embedding: model, extraction: { ...model, id: "unapproved" } }, embeddingDimension: 4, invoke }));
  try {
    await expect(f.controller.indexKnowledge(admission, { start: vi.fn() }, { teamId: f.credential.accountId, projectId: null,
      signal: new AbortController().signal, loadModels })).rejects.toThrow();
    expect(loadModels).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.postMessage).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
  } finally { f.controller.shutdown(); admission.shutdown(); }
});

it("guards the resolved credential transport on each frame before sending any provider request", async () => {
  const f = fixture(true), owner = new AbortController(), writes: Buffer[] = [];
  const source = createTeamIndexModelSource({ createModelRuntime: async () => ({
    getError: () => undefined, getModel: () => ({ provider: "fixture", api: "openai-completions", baseUrl: model.baseUrl, id: model.id }),
    getRegisteredProviderConfig: () => undefined, isUsingOAuth: () => false, isUsingSubscription: () => false,
    getAuth: async () => ({ auth: { apiKey: "synthetic-extraction" } })
  }) as never }, { extraction: { provider: "fixture", model: model.id },
    embedding: { protocol: "openai-compatible", endpoint: model.baseUrl, model: model.id, dimension: 4, apiKey: "synthetic-embedding" } });
  const resolved = await source(owner.signal);
  const channel = new Duplex({ read() {}, write(chunk: Buffer, _encoding, done) { writes.push(chunk); done(); } });
  const handle = f.controller.attachTeamModelChannel(channel, { teamId: f.credential.accountId, projectId: null, ...resolved, signal: owner.signal });
  try {
    channel.emit("data", frame()); await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(f.fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://service.invalid/v1/agent/teams/${f.credential.accountId}/authorization`, "https://model.invalid/v1/embeddings"
    ]);
    expect(f.fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: "Bearer synthetic-embedding" });
    expect(writes.toString()).not.toContain("synthetic-embedding");
    f.fetcher.mockResolvedValueOnce(Response.json({}, { status: 403 })); channel.emit("data", frame());
    await vi.waitFor(() => expect(channel.destroyed).toBe(true));
    expect(f.fetcher).toHaveBeenCalledTimes(3);
    expect(f.fetcher.mock.calls[2]?.[0]).toBe(`https://service.invalid/v1/agent/teams/${f.credential.accountId}/authorization`);
  } finally { handle.stop(); f.controller.shutdown(); }
});

it("holds the four-run budget through pending model resolution and releases failed sources", async () => {
  const f = fixture(true), admission = new TeamModelPortAdmission(), caller = new AbortController();
  let reject!: (error: Error) => void;
  const pending = new Promise<TeamIndexModels>((_resolve, no) => { reject = no; });
  const loadModels = vi.fn(() => pending);
  const input = { teamId: f.credential.accountId, projectId: null, signal: caller.signal, loadModels };
  const runs = Array.from({ length: 4 }, () => f.controller.indexKnowledge(admission, { start: vi.fn() }, input));
  for (const run of runs) void run.catch(() => undefined);
  try {
    await vi.waitFor(() => expect(loadModels).toHaveBeenCalledTimes(4)); caller.abort();
    await expect(f.controller.indexKnowledge(admission, { start: vi.fn() }, { ...input, signal: new AbortController().signal })).rejects.toThrow();
    expect(loadModels).toHaveBeenCalledTimes(4); reject(new Error("Synthetic model source unavailable"));
    expect((await Promise.allSettled(runs)).every(result => result.status === "rejected")).toBe(true);
    await expect(f.controller.indexKnowledge(admission, { start: vi.fn() }, { ...input, signal: new AbortController().signal })).rejects.toThrow();
    expect(loadModels).toHaveBeenCalledTimes(5); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.postMessage).not.toHaveBeenCalled();
  } finally { f.controller.shutdown(); admission.shutdown(); }
});

it.each(["logout", "login", "shutdown", "bootstrap", "clear", "store", "suspend", "resume", "caller", "rebind", "config"] as const)(
  "actively aborts an in-flight model request on %s", async (action) => {
    const f = fixture(), run = f.open();
    try {
      run.send(); await vi.waitFor(() => expect(run.invoke).toHaveBeenCalledOnce());
      const signal = run.invoke.mock.calls[0]![3];
      if (action === "logout") void f.controller.disconnect().catch(() => undefined);
      if (action === "login") void f.controller.beginAuthorization().catch(() => undefined);
      if (action === "shutdown") f.controller.shutdown();
      if (action === "bootstrap") f.bootstrap();
      if (action === "clear") void f.broker.clear().catch(() => undefined);
      if (action === "store") void f.broker.store({ ...f.credential, userId: "replacement" }).catch(() => undefined);
      if (action === "suspend" || action === "resume") enterprisePowerEpoch.transition(action);
      if (action === "caller") run.caller.abort();
      if (action === "rebind") void f.controller.bindWorkspace("workspace", "team", "replacement", "synthetic").catch(() => undefined);
      if (action === "config") f.controller.retireTeamModelChannels();
      expect(signal.aborted).toBe(true); expect(run.channel.destroyed).toBe(true);
      expect(run.writes).toHaveLength(0); expect(run.invoke).toHaveBeenCalledOnce();
      expect(run.caller.signal.aborted).toBe(action === "caller");
    } finally { f.controller.shutdown(); }
  }
);
it("cancels only the re-bound Workspace and rejects new work during suspend", async () => {
  const f = fixture(), a = f.open("a"), b = f.open("b");
  try {
    await f.controller.bindWorkspace("a", "team", "next", "fixture").catch(() => undefined);
    expect(a.channel.destroyed).toBe(true); expect(b.channel.destroyed).toBe(false);
    enterprisePowerEpoch.transition("suspend");
    expect(b.channel.destroyed).toBe(true); expect(() => f.open()).toThrow();
    enterprisePowerEpoch.transition("resume");
    const next = f.open(); expect(next.channel.destroyed).toBe(false); next.handle.stop();
  } finally { f.controller.shutdown(); }
});
it("cannot authorize or invoke after identity changes during a pending configuration read", async () => {
  const f = fixture(), run = f.open();
  let release!: (value: { enterpriseGatewayEndpoint: string }) => void;
  f.configuration.read.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  try {
    run.send(); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    f.bootstrap(); release({ enterpriseGatewayEndpoint: f.credential.endpoint });
    await Promise.resolve(); await Promise.resolve();
    expect(run.channel.destroyed).toBe(true); expect(f.fetcher).not.toHaveBeenCalled(); expect(run.invoke).not.toHaveBeenCalled();
  } finally { f.controller.shutdown(); }
});
it("retires on credential expiry without waiting for a new request", async () => {
  const f = fixture();
  f.credential.expiresAt = Date.now() + 60; f.bootstrap(); const run = f.open();
  try {
    await vi.waitFor(() => expect(run.channel.destroyed).toBe(true));
    expect(() => f.open("other")).toThrow();
  } finally { run.handle.stop(); f.controller.shutdown(); }
});
it("bounds active channels and frees slots after scope retirement", async () => {
  const f = fixture();
  try {
    const runs = [f.open("a"), f.open("b"), f.open("c"), f.open("d")];
    expect(() => f.open("e")).toThrow("busy");
    runs[0]!.handle.stop(); await vi.waitFor(() => expect(runs[0]!.channel.closed).toBe(true));
    expect(f.open("e").channel.destroyed).toBe(false);
  } finally { f.controller.shutdown(); }
});
it("uses a fresh exact grant on each request and does not fall back after policy denial", async () => {
  const f = fixture(), run = f.open("workspace", null);
  run.invoke.mockImplementation(async () => ({ status: 200, body: Buffer.from("{}") }));
  try {
    run.send(); await vi.waitFor(() => expect(run.writes).toHaveLength(1));
    expect(f.fetcher.mock.calls[0]![0]).toBe("https://service.invalid/v1/agent/teams/team/authorization");
    f.fetcher.mockResolvedValueOnce(Response.json({}, { status: 403 })); run.send();
    await vi.waitFor(() => expect(run.channel.destroyed).toBe(true));
    expect(run.invoke).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledTimes(2);
  } finally { f.controller.shutdown(); }
});
