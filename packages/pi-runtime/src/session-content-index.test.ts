import { createHash } from "node:crypto";
import { appendFile, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  indexSessionContentRecords,
  searchIndexedSessionContent,
  sessionContentProjectionVersion,
  tokenHashesForText
} from "./session-content-index.js";
import {
  SESSION_CATALOG_DATABASE_FILENAME,
  openSqliteSessionCatalog,
  type SessionCatalogRecord
} from "./sqlite-session-catalog.js";
import { normalizeSessionCatalogWorkspaceIdentity } from "./session-path-identity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("indexed Workspace Session content search", () => {
  it("finds Chinese and Latin substrings once per Session without persisting raw text", async () => {
    const fixture = await createFixture();
    fixture.manager.appendMessage({ role: "user", content: "小红书投放复盘与 release marker", timestamp: 1 });
    fixture.manager.appendMessage(assistantMessage("小红书内容命中，release marker 已验证", 2));
    const record = await fixture.record(2, 2);
    fixture.sqlite.replaceAll("source-a", [record], metadata(), 0);

    await indexSessionContentRecords(indexOptions(fixture, [record]));
    const chinese = await searchIndexedSessionContent(searchOptions(fixture, record, "小红书"));
    const latin = await searchIndexedSessionContent(searchOptions(fixture, record, "release marker"));

    expect(chinese.items).toHaveLength(1);
    expect(chinese.items[0]).toMatchObject({
      sessionFileIdentity: record.fileIdentity,
      messageId: expect.any(String),
      role: "user"
    });
    expect(latin.items).toHaveLength(1);
    expect(chinese).toMatchObject({ sessionsVisited: 1, entriesVisited: 2, incomplete: false });
    const salt = fixture.sqlite.contentIndexSalt();
    expect(tokenHashesForText("小红书", salt)).toHaveLength(2);

    fixture.sqlite.close();
    const database = new DatabaseSync(join(fixture.root, SESSION_CATALOG_DATABASE_FILENAME));
    const contentColumns = database.prepare(`
      SELECT name FROM pragma_table_info('session_content_messages')
      UNION ALL SELECT name FROM pragma_table_info('session_content_tokens')
    `).all().map((row) => row.name);
    const storedValues = JSON.stringify({
      messages: database.prepare("SELECT * FROM session_content_messages").all(),
      tokens: database.prepare("SELECT * FROM session_content_tokens").all()
    });
    database.close();
    expect(contentColumns).not.toContain("body");
    expect(contentColumns).not.toContain("snippet");
    expect(storedValues).not.toContain("小红书");
    expect(storedValues).not.toContain("release marker");
  });

  it("replaces only a changed physical projection version and exposes the new message", async () => {
    const fixture = await createFixture();
    fixture.manager.appendMessage({ role: "user", content: "initial topic", timestamp: 1 });
    fixture.manager.appendMessage(assistantMessage("initial response", 2));
    const first = await fixture.record(2, 2);
    fixture.sqlite.replaceAll("source-a", [first], metadata(), 0);
    await indexSessionContentRecords(indexOptions(fixture, [first]));
    expect((await searchIndexedSessionContent(searchOptions(fixture, first, "new marker"))).items).toEqual([]);

    fixture.manager.appendMessage({ role: "user", content: "continue", timestamp: 3 });
    fixture.manager.appendMessage(assistantMessage("new marker appears after the next Turn", 4));
    const second = { ...first, modifiedAt: 4, messageCount: 4 };
    fixture.sqlite.upsert(second, 1);
    await indexSessionContentRecords(indexOptions(fixture, [second]));

    expect(sessionContentProjectionVersion(second)).not.toBe(sessionContentProjectionVersion(first));
    expect((await searchIndexedSessionContent(searchOptions(fixture, second, "new marker"))).items)
      .toEqual([expect.objectContaining({ role: "assistant" })]);
    fixture.sqlite.close();
  });

  it("honors request cancellation before candidate verification", async () => {
    const fixture = await createFixture();
    fixture.manager.appendMessage({ role: "user", content: "cancel marker", timestamp: 1 });
    fixture.manager.appendMessage(assistantMessage("cancel response", 2));
    const record = await fixture.record(2, 2);
    fixture.sqlite.replaceAll("source-a", [record], metadata(), 0);
    await indexSessionContentRecords(indexOptions(fixture, [record]));
    const controller = new AbortController();
    controller.abort();

    await expect(searchIndexedSessionContent({
      ...searchOptions(fixture, record, "cancel marker"),
      signal: controller.signal
    })).rejects.toMatchObject({ name: "AbortError" });
    fixture.sqlite.close();
  });

  it("retries a same-version source after a transient read failure", async () => {
    const fixture = await createFixture();
    fixture.manager.appendMessage({ role: "user", content: "transient recovery marker", timestamp: 1 });
    fixture.manager.appendMessage(assistantMessage("transient response", 2));
    const record = await fixture.record(2, 2);
    fixture.sqlite.replaceAll("source-a", [record], metadata(), 0);
    const heldPath = `${record.path}.held`;

    await rename(record.path, heldPath);
    await indexSessionContentRecords(indexOptions(fixture, [record]));
    expect(fixture.sqlite.contentIndexVersions().has(record.fileIdentity)).toBe(false);

    await rename(heldPath, record.path);
    await indexSessionContentRecords(indexOptions(fixture, [record]));

    expect((await searchIndexedSessionContent(searchOptions(fixture, record, "transient recovery marker"))).items)
      .toHaveLength(1);
    expect(fixture.sqlite.contentIndexCoverage(record.cwdKey)).toMatchObject({
      sessionCount: 1,
      incompleteCount: 0
    });
    fixture.sqlite.close();
  });

  it("removes an obsolete projection when its current source read fails", async () => {
    const fixture = await createFixture();
    fixture.manager.appendMessage({ role: "user", content: "old projection marker", timestamp: 1 });
    fixture.manager.appendMessage(assistantMessage("old projection response", 2));
    const first = await fixture.record(2, 2);
    fixture.sqlite.replaceAll("source-a", [first], metadata(), 0);
    await indexSessionContentRecords(indexOptions(fixture, [first]));
    const current = { ...first, modifiedAt: 3, messageCount: 3 };
    fixture.sqlite.upsert(current, 1);
    const heldPath = `${current.path}.held`;

    await rename(current.path, heldPath);
    await indexSessionContentRecords(indexOptions(fixture, [current]));

    expect(fixture.sqlite.contentIndexVersions().has(current.fileIdentity)).toBe(false);
    const search = await searchIndexedSessionContent(searchOptions(fixture, current, "old projection marker"));
    expect(search).toMatchObject({ items: [], incomplete: true, sessionsVisited: 0 });
    await rename(heldPath, current.path);
    fixture.sqlite.close();
  });

  it("rebuilds an old failed projection version after the source is readable", async () => {
    const fixture = await createFixture();
    fixture.manager.appendMessage({ role: "user", content: "legacy failure recovery marker", timestamp: 1 });
    fixture.manager.appendMessage(assistantMessage("legacy response", 2));
    const record = await fixture.record(2, 2);
    fixture.sqlite.replaceAll("source-a", [record], metadata(), 0);
    fixture.sqlite.replaceContentIndex({
      fileIdentity: record.fileIdentity,
      projectionVersion: legacySessionContentProjectionVersion(record),
      indexedEntries: 0,
      incomplete: true,
      messages: []
    });

    await indexSessionContentRecords(indexOptions(fixture, [record]));

    expect(fixture.sqlite.contentIndexVersions().get(record.fileIdentity))
      .toBe(sessionContentProjectionVersion(record));
    expect((await searchIndexedSessionContent(searchOptions(fixture, record, "legacy failure recovery marker"))).items)
      .toHaveLength(1);
    fixture.sqlite.close();
  });

  it("keeps a successfully bounded incomplete projection cached for its version", async () => {
    const fixture = await createFixture();
    fixture.manager.appendMessage({ role: "user", content: "bounded projection", timestamp: 1 });
    fixture.manager.appendMessage(assistantMessage("bounded response", 2));
    // Keep 20,003 real messages, but one bigram per tail message isolates the
    // branch-entry bound from the independent token-budget and hashing workload.
    const tail = SessionManager.inMemory(fixture.workspace);
    for (let index = 0; index <= 20_000; index += 1) {
      tail.appendMessage({ role: "user", content: "ok", timestamp: index + 3 });
    }
    const entries = tail.getEntries();
    entries[0]!.parentId = fixture.manager.getLeafId();
    await appendFile(fixture.manager.getSessionFile()!, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    const record = await fixture.record(20_003, 20_003);
    expect(SessionManager.open(record.path).getEntries()).toHaveLength(20_003);
    fixture.sqlite.replaceAll("source-a", [record], metadata(), 0);
    await indexSessionContentRecords(indexOptions(fixture, [record]));
    expect(fixture.sqlite.contentIndexCoverage(record.cwdKey)).toMatchObject({
      sessionCount: 1,
      incompleteCount: 1
    });

    const database = new DatabaseSync(join(fixture.root, SESSION_CATALOG_DATABASE_FILENAME), { readOnly: true });
    try {
      expect(database.prepare("SELECT indexed_entries, incomplete FROM session_content_versions WHERE file_identity = ?")
        .get(record.fileIdentity)).toMatchObject({ indexed_entries: 20_000, incomplete: 1 });
    } finally {
      database.close();
    }

    const originalOpen = SessionManager.open.bind(SessionManager);
    const open = vi.spyOn(SessionManager, "open").mockImplementation((...args) => originalOpen(...args));
    try {
      await indexSessionContentRecords(indexOptions(fixture, [record]));
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      fixture.sqlite.close();
    }
  });

  it("stops obsolete indexing flights before opening later Session sources", async () => {
    const fixture = await createFixture();
    fixture.manager.appendMessage({ role: "user", content: "obsolete flight marker", timestamp: 1 });
    fixture.manager.appendMessage(assistantMessage("obsolete response", 2));
    const record = await fixture.record(2, 2);
    const records = Array.from({ length: 20 }, (_, index) => ({
      ...record,
      fileIdentity: `obsolete-flight-${index}`
    }));
    let flightCurrent = true;
    const originalOpen = SessionManager.open.bind(SessionManager);
    const open = vi.spyOn(SessionManager, "open").mockImplementation((...args) => {
      flightCurrent = false;
      return originalOpen(...args);
    });
    try {
      await indexSessionContentRecords({
        ...indexOptions(fixture, records),
        isCurrentFlight: () => flightCurrent
      });
      expect(open).toHaveBeenCalledTimes(1);
      expect(fixture.sqlite.contentIndexVersions()).toEqual(new Map());
    } finally {
      open.mockRestore();
      fixture.sqlite.close();
    }
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-session-content-index-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  const manager = SessionManager.create(workspace, join(root, "sessions"), { id: "indexed-session" });
  const opened = await openSqliteSessionCatalog(root);
  if (opened.kind !== "ready" || !opened.catalog.contentIndexSalt) {
    throw new Error("Expected the real SQLite content index.");
  }
  return {
    root,
    workspace,
    manager,
    sqlite: opened.catalog as typeof opened.catalog & Required<Pick<typeof opened.catalog,
      "contentIndexSalt" | "contentIndexVersions" | "replaceContentIndex" | "removeContentIndex"
      | "replaceContentIndexes" | "pruneContentIndex" | "queryContentIndex" | "contentIndexCoverage">>,
    async record(modifiedAt: number, messageCount: number): Promise<SessionCatalogRecord> {
      return {
        fileIdentity: "opaque-session-file-a",
        id: manager.getSessionId(),
        path: await realpath(manager.getSessionFile()!),
        cwd: workspace,
        cwdKey: normalizeSessionCatalogWorkspaceIdentity(workspace),
        explicitName: "小红书复盘",
        modifiedAt,
        messageCount
      };
    }
  };
}

function searchOptions(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  record: SessionCatalogRecord,
  query: string
) {
  return {
    workspaceId: "workspace-a",
    workspaceKey: record.cwdKey,
    query,
    records: [record],
    catalogIncomplete: false,
    catalogSkippedCount: 0,
    sqlite: fixture.sqlite
  };
}

function indexOptions(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  records: readonly SessionCatalogRecord[]
) {
  return {
    records,
    sqlite: fixture.sqlite,
    isCurrentFlight: () => true,
    isCurrent: () => true
  };
}

function legacySessionContentProjectionVersion(record: SessionCatalogRecord): string {
  return createHash("sha256")
    .update(record.fileIdentity)
    .update("\0")
    .update(record.path)
    .update("\0")
    .update(String(record.modifiedAt))
    .update("\0")
    .update(String(record.messageCount))
    .digest("hex");
}

function metadata() {
  return { reconciledAt: 1, incomplete: false, skippedCount: 0 };
}

function assistantMessage(text: string, timestamp: number) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
    provider: "pi67-test",
    model: "fixture",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop" as const,
    timestamp
  };
}
