import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedMemoryInspection } from "./managed-memory-inspection.js";
import { cleanupRouterFixtures, createRouter, workspaceContext } from "./context-memory-command-router.test-support.js";

const connection = { endpoint: "http://127.0.0.1:43210", apiKey: "synthetic-only", account: "private-profile",
  user: "desktop", localProfileId: "profile" };
const snapshot = { sessionId: "pi-session", owner: "pi67-openviking" as const, privacyMode: "private-learning" as const,
  capturedTurns: 2, pendingTokens: 100, liveTailTurns: 3, takeoverActive: true };
afterEach(cleanupRouterFixtures);

describe("managed workbench memory inspection", () => {
  it("uses scoped managed credentials for health and search, never the saved endpoint or CLI credentials", async () => {
    const inspect = vi.fn(async () => ({ ...connection }));
    const session = vi.fn(async () => snapshot);
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({ status: "ok", result:
      url.includes("search/find") ? { memories: [{ uri: "viking://user/desktop/memories/preferences/demo.md", abstract: "synthetic", score: 1 }] }
        : url.includes("/fs/ls") ? [] : {} })));
    vi.stubGlobal("fetch", fetchMock);
    const { router } = await createRouter({ endpoint: "https://legacy.invalid" }, { managedMemory: new ManagedMemoryInspection(inspect, session) });
    const status = await router.dispatchApp({ type: "context.status.get", payload: {} });
    expect(status).toMatchObject({ health: "healthy", owner: "pi67-openviking", endpoint: "managed:private" });
    const search = await router.dispatchWorkspace(workspaceContext, { type: "memory.search", payload: { query: "synthetic" } });
    expect(search).toMatchObject({ total: 1 });
    for (const [url, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(url.startsWith(connection.endpoint)).toBe(true); expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer synthetic-only");
      expect(new Headers(init.headers).get("X-OpenViking-User")).toBe("desktop");
    }
    expect(JSON.stringify(status)).not.toContain(connection.apiKey);
    expect(await router.dispatchWorkspace(workspaceContext, { type: "context.session.get", payload: { sessionId: "pi-session" } })).toEqual(snapshot);
    expect(session).toHaveBeenCalledWith("workspace-1", "pi-session");
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/sessions/"))).toBe(false);
  });

  it("never starts or falls back when inspection fails, but keeps offline receipt metrics usable", async () => {
    const inspect = vi.fn(async () => { throw new Error("private-secret-error"); });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { router } = await createRouter({}, { managedMemory: new ManagedMemoryInspection(inspect, vi.fn()) });
    const status = await router.dispatchApp({ type: "context.status.get", payload: {} });
    expect(status).toMatchObject({ health: "unavailable" }); expect(JSON.stringify(status)).not.toContain("private-secret");
    await expect(router.dispatchWorkspace(workspaceContext, { type: "memory.search", payload: { query: "x" } })).rejects.toThrow();
    await router.dispatchWorkspace(workspaceContext, { type: "context.recall.list", payload: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("withholds late metadata and HTTP content after the admitted connection changes", async () => {
    let current = { ...connection };
    const inspect = async () => ({ ...current });
    const managed = new ManagedMemoryInspection(inspect, async () => { current = { ...current, apiKey: "rotated" }; return snapshot; });
    await expect(managed.sessionStatus("workspace", "pi-session")).rejects.toThrow(/unavailable/);
    const { router } = await createRouter({}, { managedMemory: managed });
    vi.stubGlobal("fetch", vi.fn(async () => {
      current = { ...current, apiKey: "changed-again" };
      return new Response(JSON.stringify({ status: "ok", result: { memories: [] } }));
    }));
    await expect(router.dispatchWorkspace(workspaceContext, { type: "memory.search", payload: { query: "x" } })).rejects.toThrow(/^Managed private memory is unavailable\.$/);
  });
});
