import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMemoryConnectRequest } from "@pi67/protocol";
import { LocalMemoryBrokerClient, managedLocalMemoryOptions, managedLocalMemoryFromEnvironment } from "./local-memory-broker-client.js";

const connection = { endpoint: "http://127.0.0.1:43210", apiKey: "synthetic-scoped-key",
  localProfileId: "profile-1", account: "private-profile-1", user: "local-user" };

describe("Host local memory parent channel", () => {
  it("keeps read-only inspection separate from startup and retires both on shutdown", async () => {
    const requests: LocalMemoryConnectRequest[] = [];
    const client = new LocalMemoryBrokerClient({ postMessage: message => { requests.push(message); } });
    const startup = client.connect(), inspection = client.inspect();
    expect(client.inspect()).toBe(inspection);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.start).toBeUndefined(); expect(requests[1]?.start).toBe(false);
    client.handleResult({ type: "local-memory-connect-result", requestId: requests[1]!.requestId, ok: true, connection });
    await expect(inspection).resolves.toEqual(connection);
    const pending = expect(startup).rejects.toThrow(/shutting down/);
    client.shutdown(); await pending;
    await expect(client.inspect()).rejects.toThrow(/stopped/);
  });
  it("accepts only exact Main-selected modes and rejects malformed values", () => {
    expect(managedLocalMemoryFromEnvironment({})).toBe(false);
    expect(managedLocalMemoryFromEnvironment({ PI67_MANAGED_LOCAL_MEMORY: "0" })).toBe(false);
    expect(managedLocalMemoryFromEnvironment({ PI67_MANAGED_LOCAL_MEMORY: "1" })).toBe(true);
    for (const value of ["", "true", "false", "managed", " 1", "secret-invalid-value"]) {
      expect(() => managedLocalMemoryFromEnvironment({ PI67_MANAGED_LOCAL_MEMORY: value }))
        .toThrow(/^Invalid Main-selected local memory mode\.$/);
    }
  });
  it("requires explicit managed selection and never falls back when its broker is missing", async () => {
    const broker = new LocalMemoryBrokerClient({ postMessage() {} });
    expect(managedLocalMemoryOptions(undefined, broker)).toEqual({});
    expect(managedLocalMemoryOptions(false, broker)).toEqual({});
    await expect(managedLocalMemoryOptions(true, undefined).localMemory!.connect()).rejects.toThrow(/broker is unavailable/);
    const selected = managedLocalMemoryOptions(true, broker);
    const pending = expect(selected.localMemory!.connect()).rejects.toThrow(/shutting down/);
    broker.shutdown(); await pending;
  });
  afterEach(() => vi.useRealTimers());

  it("coalesces requests, correlates replies and ignores duplicates", async () => {
    let request!: LocalMemoryConnectRequest;
    const postMessage = vi.fn((message: LocalMemoryConnectRequest) => { request = message; });
    const client = new LocalMemoryBrokerClient({ postMessage });
    const pending = client.connect();
    expect(client.connect()).toBe(pending);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(client.handleResult({ type: "local-memory-connect-result", requestId: "stale", ok: true, connection })).toBe(false);
    const response = { type: "local-memory-connect-result", requestId: request.requestId, ok: true, connection };
    expect(client.handleResult(response)).toBe(true);
    await expect(pending).resolves.toEqual(connection);
    expect(client.handleResult(response)).toBe(false);
    client.shutdown();
    await expect(client.connect()).rejects.toThrow(/stopped/u);
  });

  it("rejects timeout, shutdown and broken parent channels without fallback", async () => {
    vi.useFakeTimers();
    const client = new LocalMemoryBrokerClient({ postMessage: () => undefined }, 10);
    const first = expect(client.connect()).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(11);
    await first;
    const second = expect(client.connect()).rejects.toThrow(/shutting down/u);
    client.shutdown();
    await second;
    const broken = new LocalMemoryBrokerClient({ postMessage: () => { throw new Error("secret"); } });
    await expect(broken.connect()).rejects.toThrow("Local memory parent channel is unavailable.");
  });

  it("allows the bounded native admission budget before timing out", async () => {
    vi.useFakeTimers();
    let request!: LocalMemoryConnectRequest;
    const client = new LocalMemoryBrokerClient({ postMessage: (message) => { request = message; } });
    const pending = client.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.handleResult({ type: "local-memory-connect-result", requestId: request.requestId, ok: true, connection })).toBe(true);
    await expect(pending).resolves.toEqual(connection);
    const timeout = expect(client.connect()).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(70_000);
    await timeout;
    client.shutdown();
  });

  it("projects typed unavailable replies and ignores malformed credential payloads", async () => {
    let request!: LocalMemoryConnectRequest;
    const client = new LocalMemoryBrokerClient({ postMessage: (message) => { request = message; } });
    const pending = client.connect();
    const response = { type: "local-memory-connect-result", requestId: request.requestId };
    expect(client.handleResult({ ...response, ok: true, connection: { ...connection, endpoint: "https://remote.test" } })).toBe(false);
    expect(client.handleResult({ ...response, ok: false, errorCode: "NOT_CONFIGURED" })).toBe(true);
    await expect(pending).rejects.toThrow(/NOT_CONFIGURED/u);
    client.shutdown();
  });
});
