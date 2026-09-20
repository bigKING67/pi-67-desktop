import { describe, expect, it, vi } from "vitest";
import { createLocalMemoryEventBus } from "./local-memory-extension-bridge.js";
import { resolveManagedMemoryConnection } from "../../openviking-pi-extension/managed-connection.js";

const profile = "e728ad55-4d62-4c2d-8587-f7bd2332309a";
const connection = { endpoint: "http://127.0.0.1:32101", apiKey: "synthetic-key", localProfileId: profile,
  account: `private-${profile}`, user: "desktop" };

describe("Pi session-local memory connection bus", () => {
  it("resolves only when requested and keeps independent session buses isolated", async () => {
    const connect = vi.fn(async () => connection);
    const first = createLocalMemoryEventBus({ connect });
    const second = createLocalMemoryEventBus({ connect: async () => ({ ...connection, apiKey: "second-key" }) });
    expect(connect).not.toHaveBeenCalled();
    first.emit("pi67:managed-private-memory:connect", { invalid: true });
    expect(connect).not.toHaveBeenCalled();
    await expect(resolveManagedMemoryConnection(first)).resolves.toEqual(connection);
    await expect(resolveManagedMemoryConnection(second)).resolves.toMatchObject({ apiKey: "second-key" });
    first.clear(); second.clear();
  });

  it("distinguishes external mode from managed failure, without leaking the provider error", async () => {
    await expect(resolveManagedMemoryConnection({ emit() {} })).resolves.toBeUndefined();
    const failed = createLocalMemoryEventBus({ connect: async () => { throw new Error("secret provider payload"); } });
    await expect(resolveManagedMemoryConnection(failed)).rejects.toThrow(/^Managed local memory is unavailable\.$/);
    const malformed = createLocalMemoryEventBus({ connect: async () => ({ ...connection, account: "team-scope" }) });
    await expect(resolveManagedMemoryConnection(malformed)).rejects.toThrow(/^Managed local memory is unavailable\.$/);
    failed.clear(); malformed.clear();
  });
});
