import type {
  AgentConnectionIdentity,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createRendererReadQueryRequest,
  RendererReadQueryClient,
  type RendererReadCommand,
  type RendererReadQueryExecute
} from "./renderer-read-query-client.js";

describe("RendererReadQueryClient", () => {
  it("single-flights equal keys and retains the last success while refreshing or failed", async () => {
    const fixture = executorFixture();
    const client = new RendererReadQueryClient(fixture.execute);
    const request = contentSearchRequest("workspace-a", "release");
    client.connect(connection(1));

    const releaseFirst = client.observe(request);
    const releaseSecond = client.observe(request);

    expect(fixture.calls).toHaveLength(1);
    expect(client.snapshot(request)).toEqual({ status: "loading" });

    fixture.calls[0]!.result.resolve(contentResult("workspace-a", "message-1"));
    await settlePromises();
    expect(client.snapshot(request)).toMatchObject({
      status: "ready",
      data: { workspaceId: "workspace-a", items: [{ messageId: "message-1" }] }
    });

    client.refresh(request.key);
    expect(fixture.calls).toHaveLength(2);
    expect(client.snapshot(request)).toMatchObject({
      status: "refreshing",
      data: { workspaceId: "workspace-a", items: [{ messageId: "message-1" }] }
    });

    fixture.calls[1]!.result.reject(new Error("index unavailable"));
    await settlePromises();
    expect(client.snapshot(request)).toMatchObject({
      status: "error",
      error: "对话正文搜索失败。",
      data: { workspaceId: "workspace-a", items: [{ messageId: "message-1" }] }
    });

    releaseSecond();
    releaseFirst();
  });

  it("cancels an unobserved flight and ignores a late result", async () => {
    const fixture = executorFixture();
    const client = new RendererReadQueryClient(fixture.execute);
    const request = contentSearchRequest("workspace-a", "release");
    client.connect(connection(1));

    const release = client.observe(request);
    release();

    expect(fixture.calls[0]!.signal.aborted).toBe(true);
    fixture.calls[0]!.result.resolve(contentResult("workspace-a", "stale"));
    await settlePromises();
    expect(client.snapshot(request)).toEqual({ status: "unavailable" });
  });

  it("fences an old Host result and refreshes each active read exactly once after reconnect", async () => {
    const fixture = executorFixture();
    const client = new RendererReadQueryClient(fixture.execute);
    const contentRequest = contentSearchRequest("workspace-a", "release");
    const catalogRequest = catalogSearchRequest("workspace-a", "release");
    client.connect(connection(1));
    const releaseContent = client.observe(contentRequest);
    const releaseCatalog = client.observe(catalogRequest);

    client.connect(connection(2));

    expect(fixture.calls).toHaveLength(4);
    expect(fixture.calls.slice(0, 2).every((call) => call.signal.aborted)).toBe(true);
    fixture.calls[0]!.result.resolve(contentResult("workspace-a", "old-host"));
    fixture.calls[2]!.result.resolve(contentResult("workspace-a", "new-host"));
    fixture.calls[3]!.result.resolve(catalogResult());
    await settlePromises();

    expect(client.snapshot(contentRequest)).toMatchObject({
      status: "ready",
      data: { items: [{ messageId: "new-host" }] }
    });
    expect(fixture.calls.map((call) => call.command)).toEqual([
      "session.catalog.contentSearch",
      "session.catalog.query",
      "session.catalog.contentSearch",
      "session.catalog.query"
    ]);

    client.connect(connection(2));
    expect(fixture.calls).toHaveLength(4);
    releaseCatalog();
    releaseContent();
  });

  it("isolates equal text by Workspace key and preserves cached data while unavailable", async () => {
    const fixture = executorFixture();
    const client = new RendererReadQueryClient(fixture.execute);
    const requestA = contentSearchRequest("workspace-a", "release");
    const requestB = contentSearchRequest("workspace-b", "release");
    expect(requestA.key).not.toBe(requestB.key);
    client.connect(connection(1));
    const releaseA = client.observe(requestA);
    const releaseB = client.observe(requestB);
    fixture.calls[0]!.result.resolve(contentResult("workspace-a", "a"));
    fixture.calls[1]!.result.resolve(contentResult("workspace-b", "b"));
    await settlePromises();

    client.disconnect();

    expect(client.snapshot(requestA)).toMatchObject({
      status: "unavailable",
      data: { workspaceId: "workspace-a", items: [{ messageId: "a" }] }
    });
    expect(client.snapshot(requestB)).toMatchObject({
      status: "unavailable",
      data: { workspaceId: "workspace-b", items: [{ messageId: "b" }] }
    });
    releaseB();
    releaseA();
  });

  it("admits a new active key after the retained idle cache reaches its bound", async () => {
    const fixture = executorFixture();
    const client = new RendererReadQueryClient(fixture.execute, 1);
    const retainedRequest = contentSearchRequest("workspace-a", "retained");
    const activeRequest = contentSearchRequest("workspace-a", "active");
    client.connect(connection(1));

    const releaseRetained = client.observe(retainedRequest);
    fixture.calls[0]!.result.resolve(contentResult("workspace-a", "retained-result"));
    await settlePromises();
    releaseRetained();

    const releaseActive = client.observe(activeRequest);
    expect(client.snapshot(activeRequest)).toEqual({ status: "loading" });
    fixture.calls[1]!.result.resolve(contentResult("workspace-a", "active-result"));
    await settlePromises();

    expect(client.snapshot(activeRequest)).toMatchObject({
      status: "ready",
      data: { items: [{ messageId: "active-result" }] }
    });
    releaseActive();
  });

  it("exposes no mutation command through its typed request factory", () => {
    expectTypeOf<"workspace.register" extends RendererReadCommand ? true : false>()
      .toEqualTypeOf<false>();
  });
});

interface ExecutorCall {
  command: RendererReadCommand;
  signal: AbortSignal;
  result: ReturnType<typeof deferred<unknown>>;
}

function executorFixture(): { execute: RendererReadQueryExecute; calls: ExecutorCall[] } {
  const calls: ExecutorCall[] = [];
  const execute = vi.fn((command: RendererReadCommand, _payload: unknown, _context: unknown, signal: AbortSignal) => {
    const result = deferred<unknown>();
    calls.push({ command, signal, result });
    return result.promise;
  }) as unknown as RendererReadQueryExecute;
  return { execute, calls };
}

function contentSearchRequest(workspaceId: string, query: string) {
  return createRendererReadQueryRequest(
    "session.catalog.contentSearch",
    { query },
    workspaceContext(workspaceId)
  );
}

function catalogSearchRequest(workspaceId: string, search: string) {
  return createRendererReadQueryRequest(
    "session.catalog.query",
    { scope: "workspace", search, limit: 50 },
    workspaceContext(workspaceId)
  );
}

function workspaceContext(workspaceId: string): WorkspaceProtocolContext {
  return { scope: "workspace", workspaceId };
}

function connection(hostEpoch: number): AgentConnectionIdentity {
  return {
    appInstanceId: "app-1",
    hostInstanceId: `host-${hostEpoch}`,
    hostEpoch,
    sdkVersion: "0.84.2",
    eventSequence: 0
  };
}

function contentResult(workspaceId: string, messageId: string): CommandResults["session.catalog.contentSearch"] {
  return {
    workspaceId,
    query: "release",
    items: [{
      sessionFileIdentity: "session-file-1",
      sessionPath: "/sessions/one.jsonl",
      sessionName: "Session",
      messageId,
      role: "user",
      snippet: "release",
      createdAt: 1
    }],
    sessionsVisited: 1,
    entriesVisited: 1,
    truncated: false,
    incomplete: false,
    skippedCount: 0
  };
}

function catalogResult(): CommandResults["session.catalog.query"] {
  return {
    items: [],
    total: 0,
    hasMore: false,
    state: "ready",
    rebuilding: false,
    incomplete: false,
    skippedCount: 0,
    revision: 1,
    itemCount: 0,
    source: "sqlite"
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, deny) => {
    resolve = accept;
    reject = deny;
  });
  return { promise, resolve, reject };
}

async function settlePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
