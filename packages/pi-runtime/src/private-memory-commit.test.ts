import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { bindPrivateMemoryCommitBus, requestPrivateMemoryCommit, inspectPrivateMemorySession } from "./private-memory-commit.js";

function fixture() {
  const bus = createEventBus(), services = {} as Parameters<typeof bindPrivateMemoryCommitBus>[0];
  bindPrivateMemoryCommitBus(services, bus);
  const request = () => requestPrivateMemoryCommit(services, "session", () => true);
  return { bus, services, request };
}
const result = { status: "accepted", archived: true, task_id: "task" };

describe("session-private memory Commit bus", () => {
  it("resolves metadata only from one current owner and strips unprojected fields", async () => {
    const f = fixture(); let current = true;
    const request = () => inspectPrivateMemorySession(f.services, "session", () => current);
    await expect(request()).rejects.toThrow();
    const snapshot = { sessionId: "session", owner: "pi67-openviking", privacyMode: "private-learning",
      capturedTurns: 2, pendingTokens: 90, liveTailTurns: 3, takeoverActive: true };
    const handler = vi.fn(async () => ({ ...snapshot, apiKey: "must-not-project" }));
    const remove = f.bus.on("pi67:private-memory:inspect", (data: any) => data.provide(handler));
    await expect(request()).resolves.toEqual(snapshot);
    const duplicate = f.bus.on("pi67:private-memory:inspect", (data: any) => data.provide(handler));
    await expect(request()).rejects.toThrow(); expect(handler).toHaveBeenCalledTimes(1); duplicate();
    handler.mockImplementation(async () => { current = false; return { ...snapshot, apiKey: "hidden" }; });
    await expect(request()).rejects.toThrow(); remove();
  });
  it("fails closed without a handler or with duplicate owners, before invoking either", async () => {
    const f = fixture(), commit = vi.fn(async () => result);
    await expect(f.request()).rejects.toThrow("one available memory owner");
    for (let i = 0; i < 2; i++) f.bus.on("pi67:private-memory:commit", (data: any) => data.provide(commit));
    await expect(f.request()).rejects.toThrow("one available memory owner");
    expect(commit).not.toHaveBeenCalled();
  });
  it("rejects busy Sessions and concurrent submissions without a second commit", async () => {
    const f = fixture(), gate = Promise.withResolvers<typeof result>();
    const commit = vi.fn(() => gate.promise);
    f.bus.on("pi67:private-memory:commit", (data: any) => data.provide(commit));
    await expect(requestPrivateMemoryCommit(f.services, "session", () => false)).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();
    const first = f.request();
    await expect(f.request()).rejects.toThrow();
    gate.resolve(result);
    await expect(first).resolves.toEqual(result);
    expect(commit).toHaveBeenCalledOnce();
  });
  it("projects only receipt fields and keeps another Session bus isolated", async () => {
    const f = fixture(), other = fixture();
    f.bus.on("pi67:private-memory:commit", (data: any) => data.provide(async () => ({ ...result, content: "not returned" })));
    await expect(f.request()).resolves.toEqual(result);
    await expect(other.request()).rejects.toThrow();
  });
  it("rejects malformed receipts and releases the in-flight slot after failure", async () => {
    const f = fixture(), commit = vi.fn().mockResolvedValueOnce({ status: "ok" }).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(result);
    f.bus.on("pi67:private-memory:commit", (data: any) => data.provide(commit));
    await expect(f.request()).rejects.toThrow();
    await expect(f.request()).rejects.toThrow("offline");
    await expect(f.request()).resolves.toEqual(result);
  });
});
