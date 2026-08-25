import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
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

    await indexSessionContentRecords({ records: [record], sqlite: fixture.sqlite, isCurrent: () => true });
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
    await indexSessionContentRecords({ records: [first], sqlite: fixture.sqlite, isCurrent: () => true });
    expect((await searchIndexedSessionContent(searchOptions(fixture, first, "new marker"))).items).toEqual([]);

    fixture.manager.appendMessage({ role: "user", content: "continue", timestamp: 3 });
    fixture.manager.appendMessage(assistantMessage("new marker appears after the next Turn", 4));
    const second = { ...first, modifiedAt: 4, messageCount: 4 };
    fixture.sqlite.upsert(second, 1);
    await indexSessionContentRecords({ records: [second], sqlite: fixture.sqlite, isCurrent: () => true });

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
    await indexSessionContentRecords({ records: [record], sqlite: fixture.sqlite, isCurrent: () => true });
    const controller = new AbortController();
    controller.abort();

    await expect(searchIndexedSessionContent({
      ...searchOptions(fixture, record, "cancel marker"),
      signal: controller.signal
    })).rejects.toMatchObject({ name: "AbortError" });
    fixture.sqlite.close();
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
