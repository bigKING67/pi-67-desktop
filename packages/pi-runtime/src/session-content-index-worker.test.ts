import { mkdtemp, realpath, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionCatalog } from "./session-catalog.js";
import { ContentIndexWorkerClient } from "./session-content-index-worker-client.js";
import { ContentIndexWorkerEngine } from "./session-content-index-worker-engine.js";
import { isContentIndexReply, validateContentIndexRequest } from "./session-content-index-worker-contract.js";
import { openSqliteSessionCatalog, SESSION_CATALOG_DATABASE_FILENAME, type SessionCatalogRecord } from "./sqlite-session-catalog.js";
import { normalizeSessionCatalogWorkspaceIdentity } from "./session-path-identity.js";

const roots: string[] = [];
const clients: ContentIndexWorkerClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi67-worker-index-"))); roots.push(root);
  const cwd = join(root, "workspace");
  const manager = SessionManager.create(cwd, join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "private needlephrase", timestamp: 1 });
  manager.appendMessage({
    role: "assistant", content: [{ type: "text", text: "synthetic response" }],
    api: "openai-responses", provider: "test", model: "test", stopReason: "stop", timestamp: 2,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  });
  const record: SessionCatalogRecord = {
    fileIdentity: "fixture-file", id: manager.getSessionId(), path: await realpath(manager.getSessionFile()!),
    cwd, cwdKey: normalizeSessionCatalogWorkspaceIdentity(cwd), modifiedAt: 2, messageCount: 2
  };
  const client = new ContentIndexWorkerClient(root, root); clients.push(client);
  const input = { sourceKey: "fixture-source", records: [record] };
  const search = { workspaceId: "workspace", workspaceKey: record.cwdKey, query: "needlephrase", catalogIncomplete: false, catalogSkippedCount: 0 };
  return { root, client, record, input, search };
}

describe("isolated content index worker", () => {
  it("indexes in a separate private file, searches and restarts without touching the foreground index", async () => {
    const f = await fixture();
    const foreground = await openSqliteSessionCatalog(f.root);
    if (foreground.kind !== "ready") throw new Error("Expected SQLite.");
    try {
      foreground.catalog.replaceAll(f.input.sourceKey, [f.record], { reconciledAt: 1, incomplete: false, skippedCount: 0 }, 0);
      const first = await f.client.request({ ...f.input, search: f.search });
      expect(first.ok && first.result).toMatchObject({ incomplete: false, sessionsVisited: 1, items: [{ messageId: expect.any(String) }] });
      expect(foreground.catalog.contentIndexVersions?.().size).toBe(0);
      f.client.reset();
      const second = await f.client.request({ ...f.input, search: f.search });
      expect(second.ok && second.result).toEqual(first.ok && first.result);
      await f.client.dispose();
      const bytes = await readFile(join(f.root, "content-index-worker", SESSION_CATALOG_DATABASE_FILENAME));
      expect(bytes.includes(Buffer.from("private needlephrase"))).toBe(false);
      const db = new DatabaseSync(join(f.root, "content-index-worker", SESSION_CATALOG_DATABASE_FILENAME));
      try { expect(db.prepare("PRAGMA quick_check").get()?.quick_check).toBe("ok"); }
      finally { db.close(); }
    } finally { foreground.catalog.close(); }
  });

  it("refreshes archive and deletion filters from the authoritative snapshot", async () => {
    const f = await fixture();
    await f.client.request(f.input);
    const archived = await f.client.request({ ...f.input, records: [{ ...f.record, archivedAt: 3 }], search: f.search });
    expect(archived.ok && archived.result?.items).toEqual([]);
    const removed = await f.client.request({ ...f.input, records: [], search: f.search });
    expect(removed.ok && removed.result).toMatchObject({ items: [], sessionsVisited: 0, incomplete: false });
  });

  it("cancels pending work promptly, rejects disposed use and can start a new generation", async () => {
    const f = await fixture();
    const abort = new AbortController();
    const active = f.client.request(f.input);
    const cancelled = f.client.request(f.input, abort.signal);
    abort.abort();
    await expect(cancelled).rejects.toThrow("cancelled");
    await active;
    const pending = f.client.request(f.input);
    f.client.reset();
    await expect(pending).rejects.toThrow("cancelled");
    await expect(f.client.request(f.input)).resolves.toMatchObject({ ok: true });
    await f.client.dispose();
    await expect(f.client.request(f.input)).rejects.toThrow("unavailable");
  });

  it("integrates catalog search and rejects a retired source result", async () => {
    const f = await fixture();
    const catalog = createSessionCatalog({ directory: f.root, storageRoot: f.root });
    const context = { sourceKey: "a", workspaceCwd: f.record.cwd,
      discover: async () => ({ records: [f.record], incomplete: false, skippedCount: 0 }) };
    try {
      const found = await catalog.searchContent("workspace", "needlephrase", context);
      expect(found).toMatchObject({ incomplete: false, items: [{ sessionFileIdentity: f.record.fileIdentity }] });
      const old = catalog.searchContent("workspace", "needlephrase", context);
      const outcome = old.then(() => "completed", () => "retired");
      await catalog.reconcile({ ...context, sourceKey: "b", discover: async () => ({ records: [], incomplete: false, skippedCount: 0 }) });
      expect(await outcome).toBe("retired");
      const empty = await catalog.searchContent("workspace", "needlephrase", { ...context, sourceKey: "b", discover: async () => ({ records: [], incomplete: false, skippedCount: 0 }) });
      expect(empty.items).toEqual([]);
    } finally { await catalog.dispose(); }
  });

  it("rejects malformed request paths and malformed search replies", async () => {
    const f = await fixture();
    const request = { ...f.input, id: 1, search: f.search };
    expect(() => validateContentIndexRequest({ ...request, records: [{ ...f.record, path: "relative" }] })).toThrow();
    expect(isContentIndexReply({ id: 2, ok: true }, request)).toBe(false);
    expect(isContentIndexReply({ id: 1, ok: true, result: {} }, request)).toBe(false);
    const engine = new ContentIndexWorkerEngine(f.root, f.root);
    try { await expect(engine.execute({ ...request, records: [null] })).rejects.toThrow(); }
    finally { engine.close(); }
  });
});
