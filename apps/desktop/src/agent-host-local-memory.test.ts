import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMemoryConnection } from "@pi67/protocol";

const electronMocks = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("electron", () => ({ utilityProcess: { fork: electronMocks.fork } }));
import { AgentHostSupervisor } from "./agent-host-supervisor.js";
import type { LocalMemoryServicePort } from "./local-memory-supervisor.js";
import type { LocalMemoryModelSettingsStore } from "./local-memory-model-settings.js";

const connection: LocalMemoryConnection = { endpoint: "http://127.0.0.1:43210", apiKey: "scoped-synthetic",
  localProfileId: "profile-1", account: "private-profile-1", user: "local-user" };

function host() {
  return Object.assign(new EventEmitter(), {
    postMessage: vi.fn(), kill: vi.fn(), stdout: new EventEmitter(), stderr: new EventEmitter()
  });
}

function supervisor(service?: LocalMemoryServicePort, settings?: Pick<LocalMemoryModelSettingsStore, "load" | "signal">) {
  return new AgentHostSupervisor({
    agentHostEntry: "/app/agent-host.mjs", appInstanceId: "app-1", expectedRendererOrigin: "app://pi67",
    getStoragePaths: () => ({ storageRoot: "/private/user-data", capabilityProbeDirectory: "/private/user-data",
      sessionCatalogDirectory: "/private/user-data/projections/session-catalog" }),
    getMainWindow: () => undefined, rendererUrl: "app://pi67/index.html", getLocalMemoryService: () => service,
    getTeamIndexSettings: () => settings
  });
}

describe("Main utility-process local memory routing", () => {
  afterEach(() => { vi.useRealTimers(); electronMocks.fork.mockReset(); });

  it("routes team settings only to a ready current Host and retires Main team resources on change", async () => {
    const current = host(); electronMocks.fork.mockReturnValue(current);
    let generation = new AbortController();
    const settings = { extraction: { provider: "fixture", model: "extract" }, embedding: {
      protocol: "openai-compatible" as const, endpoint: "https://model.invalid/v1", model: "embed", dimension: 4, apiKey: "synthetic-key"
    } };
    const store = { get signal() { return generation.signal; }, load: vi.fn(async () => settings) };
    const main = supervisor(undefined, store); main.connect();
    const request = { type: "team-index-settings-read", requestId: "00000000-0000-4000-8000-000000000001" };
    current.emit("message", request); expect(store.load).not.toHaveBeenCalled();
    current.emit("spawn"); current.emit("message", { type: "agent-host-ready", startup: { profileMode: "fresh", status: "ready", issues: [] } });
    current.emit("message", request);
    await vi.waitFor(() => expect(current.postMessage).toHaveBeenCalledWith({ ...request, type: "team-index-settings-result", ok: true, settings }));
    const invalidate = vi.spyOn(main.teamWorkers, "invalidate");
    const previous = generation; generation = new AbortController(); previous.abort();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(current.postMessage).toHaveBeenCalledWith({ type: "team-index-settings-invalidated" });
    const stop = main.stop(100); current.emit("exit", 0); await stop;
  });

  it("does not return a pending team settings read after restart", async () => {
    vi.useFakeTimers(); const old = host(), next = host(); electronMocks.fork.mockReturnValueOnce(old).mockReturnValueOnce(next);
    let release!: (value: undefined) => void;
    const store = { signal: new AbortController().signal, load: vi.fn(() => new Promise<undefined>(resolve => { release = resolve; })) };
    const main = supervisor(undefined, store); main.connect(); old.emit("spawn");
    old.emit("message", { type: "agent-host-ready", startup: { profileMode: "fresh", status: "ready", issues: [] } });
    const request = { type: "team-index-settings-read", requestId: "00000000-0000-4000-8000-000000000001" };
    old.emit("message", request); main.restart(); old.emit("exit", 1); await vi.advanceTimersByTimeAsync(1_000);
    release(undefined); await vi.advanceTimersByTimeAsync(0);
    expect(old.postMessage.mock.calls.some(([message]) => message.type === "team-index-settings-result")).toBe(false);
    old.emit("message", request); expect(store.load).toHaveBeenCalledOnce();
    const stop = main.stop(100); next.emit("exit", 0); await vi.advanceTimersByTimeAsync(100); await stop;
  });

  it("replies on the current parent port without requiring a Renderer", async () => {
    const current = host();
    electronMocks.fork.mockReturnValue(current);
    const service = { connect: vi.fn(async () => connection), stop: vi.fn(async () => undefined) };
    const main = supervisor(service);
    main.connect();
    current.emit("message", { type: "local-memory-connect", requestId: "request-1" });
    await vi.waitFor(() => expect(current.postMessage).toHaveBeenCalledWith({
      type: "local-memory-connect-result", requestId: "request-1", ok: true, connection
    }));
    await main.stopLocalMemory();
    expect(service.stop).toHaveBeenCalledTimes(1);
    current.emit("message", { type: "local-memory-connect", requestId: "request-2" });
    await vi.waitFor(() => expect(current.postMessage).toHaveBeenCalledWith({
      type: "local-memory-connect-result", requestId: "request-2", ok: false, errorCode: "STOPPING"
    }));
  });

  it("never sends a late credential to a replaced Host and ignores its new requests", async () => {
    vi.useFakeTimers();
    const oldHost = host();
    const newHost = host();
    electronMocks.fork.mockReturnValueOnce(oldHost).mockReturnValueOnce(newHost);
    let complete!: (value: LocalMemoryConnection) => void;
    const service = { connect: vi.fn(() => new Promise<LocalMemoryConnection>((resolve) => { complete = resolve; })),
      stop: vi.fn(async () => undefined) };
    const main = supervisor(service);
    main.connect();
    oldHost.emit("message", { type: "local-memory-connect", requestId: "old" });
    oldHost.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(electronMocks.fork).toHaveBeenCalledTimes(2);
    complete(connection);
    await vi.advanceTimersByTimeAsync(0);
    expect(oldHost.postMessage).not.toHaveBeenCalled();
    expect(newHost.postMessage).not.toHaveBeenCalled();
    oldHost.emit("message", { type: "local-memory-connect", requestId: "stale" });
    expect(service.connect).toHaveBeenCalledTimes(1);
    await main.stopLocalMemory();
  });

  it("reports missing setup instead of assuming a development service", async () => {
    const current = host();
    electronMocks.fork.mockReturnValue(current);
    const main = supervisor();
    main.connect();
    current.emit("message", { type: "local-memory-connect", requestId: "request-1" });
    await vi.waitFor(() => expect(current.postMessage).toHaveBeenCalledWith({
      type: "local-memory-connect-result", requestId: "request-1", ok: false, errorCode: "NOT_CONFIGURED"
    }));
    await main.stopLocalMemory();
  });

  it("resolves extraction configuration only through a ready current Host", async () => {
    const current = host(); electronMocks.fork.mockReturnValue(current);
    const main = supervisor(); main.connect();
    const selection = { provider: "fixture", model: "extract" };
    await expect(main.localMemoryModels.resolve(selection, new AbortController().signal)).rejects.toThrow(/unavailable/u);
    current.emit("spawn");
    current.emit("message", { type: "agent-host-ready", startup: { profileMode: "fresh", status: "ready", issues: [] } });
    const pending = main.localMemoryModels.resolve(selection, new AbortController().signal);
    const request = current.postMessage.mock.calls.find(([value]) => value.type === "local-memory-extraction-resolve")![0] as { requestId: string };
    const model = { protocol: "openai-compatible", endpoint: "https://example.invalid/v1", model: "extract", apiKey: "synthetic-model-secret" };
    current.emit("message", { type: "local-memory-extraction-result", requestId: request.requestId, ok: true, model });
    await expect(pending).resolves.toEqual(model);
    await main.stopLocalMemory();
  });
});
