import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionCatalog, type SessionCatalogContext } from "./session-catalog.js";
import {
  normalizeSessionCatalogPathIdentity,
  resolveExistingSessionFileIdentity
} from "./session-path-identity.js";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Session Catalog automatic title projection", () => {
  it("discards a failed read from a replaced physical Session version", async () => {
    type Outcome = { kind: "title"; title: string } | { kind: "none" } | { kind: "failed" };
    const completions: Array<{ path: string; complete: (outcome: Outcome) => void }> = [];
    const onChanged = vi.fn();
    const catalog = createSessionCatalog({
      onChanged,
      automaticTitleReader: {
        readOutcome: (path) => new Promise((resolve) => completions.push({ path, complete: resolve })),
        clear: vi.fn()
      },
      openSqlite: async () => ({ kind: "fallback", reason: "unavailable" })
    });
    let currentRecord = unnamedRecord(1);
    const context: SessionCatalogContext = {
      sourceKey: "source",
      workspaceCwd: "/workspace",
      discover: async () => ({ records: [currentRecord], incomplete: false, skippedCount: 0 })
    };

    await catalog.reconcile(context);
    await vi.waitFor(() => expect(completions).toHaveLength(1));
    currentRecord = { ...currentRecord, path: "/sessions/replaced.jsonl", modifiedAt: currentRecord.modifiedAt + 1 };
    await catalog.reconcile(context);
    await vi.waitFor(() => expect(completions).toHaveLength(2));
    onChanged.mockClear();

    completions.find((completion) => completion.path === "/sessions/1.jsonl")!.complete({ kind: "failed" });
    await Promise.resolve();
    expect(catalog.status()).toMatchObject({ incomplete: false, skippedCount: 0 });
    expect(onChanged).not.toHaveBeenCalledWith(expect.objectContaining({ reason: "automatic-title" }));

    completions.find((completion) => completion.path === currentRecord.path)!
      .complete({ kind: "title", title: "current title" });
    expect((await catalog.query({ scope: "all", search: "current title" }, context)).total).toBe(1);
    await catalog.dispose();
  });

  it("keeps replacement flights globally bounded and discards stale title callbacks", async () => {
    let active = 0;
    let maximumActive = 0;
    const completions: Array<{ path: string; complete: (result: { kind: "title"; title: string }) => void }> = [];
    const onChanged = vi.fn();
    const catalog = createSessionCatalog({
      onChanged,
      automaticTitleReader: {
        readOutcome: (path) => new Promise((complete) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          completions.push({ path, complete: (result) => { active -= 1; complete(result); } });
        }),
        clear: vi.fn()
      },
      openSqlite: async () => ({ kind: "fallback", reason: "unavailable" })
    });
    let refreshed = false;
    const context: SessionCatalogContext = {
      sourceKey: "source",
      workspaceCwd: "/workspace",
      discover: async () => ({
        records: Array.from({ length: 4 }, (_, index) => unnamedRecord(refreshed ? index + 10 : index)),
        incomplete: false,
        skippedCount: 0
      })
    };
    await catalog.reconcile(context);
    await vi.waitFor(() => expect(completions).toHaveLength(4));
    refreshed = true;
    await catalog.reconcile(context);
    onChanged.mockClear();
    for (const completion of completions.splice(0, 4)) completion.complete({ kind: "title", title: "stale title" });
    await vi.waitFor(() => expect(completions).toHaveLength(4));
    expect(maximumActive).toBe(4);
    expect(onChanged).not.toHaveBeenCalledWith(expect.objectContaining({ reason: "automatic-title" }));
    for (const completion of completions.splice(0, 4)) completion.complete({ kind: "title", title: "current title" });
    const page = await catalog.query({ scope: "all", search: "current title" }, context);
    expect(page.total).toBe(4);
    expect((await catalog.query({ scope: "all", search: "stale title" }, context)).total).toBe(0);
    await catalog.dispose();
  });

  it("keeps a failed title read incomplete without inventing a display title", async () => {
    const catalog = createSessionCatalog({
      automaticTitleReader: { readOutcome: async () => ({ kind: "failed" }), clear: vi.fn() },
      openSqlite: async () => ({ kind: "fallback", reason: "unavailable" })
    });
    const context = fixtureContext([unnamedRecord(1)]);
    await catalog.reconcile(context);
    const page = await catalog.query({ scope: "all", search: "小红书" }, context);
    expect(page.items).toEqual([]);
    expect(catalog.status()).toMatchObject({ incomplete: true, skippedCount: 1 });
    await catalog.dispose();
  });

  it("indexes an unnamed upsert without requiring a full reconcile", async () => {
    const catalog = createSessionCatalog({
      automaticTitleReader: {
        readOutcome: async (path) => ({ kind: "title", title: path.includes("updated") ? "新的自动标题" : "旧标题" }),
        clear: vi.fn()
      },
      openSqlite: async () => ({ kind: "fallback", reason: "unavailable" })
    });
    const initial = { ...unnamedRecord(1), explicitName: "固定标题" };
    const context = fixtureContext([initial]);
    await catalog.reconcile(context);
    const { explicitName: _explicitName, ...updated } = {
      ...initial,
      path: "/sessions/updated.jsonl",
      modifiedAt: initial.modifiedAt + 1
    };
    await catalog.upsert(updated, context, "session-updated");
    const page = await catalog.query({ scope: "all", search: "新的自动" }, context);
    expect(page.items).toMatchObject([{ id: updated.id, name: "新的自动标题", nameSource: "seed" }]);
    await catalog.dispose();
  });

  it("rejects a cursor created before automatic titles change the searchable revision", async () => {
    const completions: Array<(result: { kind: "title"; title: string }) => void> = [];
    const catalog = createSessionCatalog({
      automaticTitleReader: {
        readOutcome: () => new Promise((resolve) => completions.push(resolve)),
        clear: vi.fn()
      },
      openSqlite: async () => ({ kind: "fallback", reason: "unavailable" })
    });
    const context: SessionCatalogContext = {
      sourceKey: "source",
      workspaceCwd: "/workspace",
      discover: async () => ({
        records: [unnamedRecord(1), unnamedRecord(2)],
        incomplete: false,
        skippedCount: 0
      })
    };

    await catalog.reconcile(context);
    await vi.waitFor(() => expect(completions).toHaveLength(2));
    const before = await catalog.query({ scope: "all", limit: 1 }, context);
    expect(before.nextCursor).toBeDefined();
    for (const complete of completions) complete({ kind: "title", title: "小红书自动标题" });
    await catalog.query({ scope: "all", search: "小红书" }, context);
    await expect(catalog.query({ scope: "all", cursor: before.nextCursor! }, context))
      .rejects.toMatchObject({ code: "STALE_SESSION_CATALOG" });
    await catalog.dispose();
  });

  it("shares one pull-based four-reader index flight across concurrent searches", async () => {
    let active = 0;
    let maximumActive = 0;
    const automaticTitleReader = {
      readOutcome: vi.fn(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return { kind: "title" as const, title: "小红书自动标题" };
      }),
      clear: vi.fn()
    };
    const records = Array.from({ length: 61 }, (_, index) => unnamedRecord(index));
    const catalog = createSessionCatalog({
      automaticTitleReader,
      openSqlite: async () => ({ kind: "fallback", reason: "unavailable" })
    });
    const context: SessionCatalogContext = {
      sourceKey: "source",
      workspaceCwd: "/workspace",
      discover: async () => ({ records, incomplete: false, skippedCount: 0 })
    };

    await catalog.reconcile(context);
    const [first, second] = await Promise.all([
      catalog.query({ scope: "all", search: "小红书" }, context),
      catalog.query({ scope: "all", search: "小红书" }, context)
    ]);

    expect(automaticTitleReader.readOutcome).toHaveBeenCalledTimes(records.length);
    expect(maximumActive).toBe(4);
    expect(first.total).toBe(records.length);
    expect(second.total).toBe(records.length);
    await catalog.dispose();
  });

  it("keeps ordinary list queries responsive while a nonempty search waits for indexing", async () => {
    let complete!: (outcome: { kind: "title"; title: string }) => void;
    const catalog = createSessionCatalog({
      automaticTitleReader: {
        readOutcome: () => new Promise((resolve) => { complete = resolve; }),
        clear: vi.fn()
      },
      openSqlite: async () => ({ kind: "fallback", reason: "unavailable" })
    });
    const context = fixtureContext([unnamedRecord(1)]);
    await catalog.reconcile(context);
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));

    const search = catalog.query({ scope: "all", search: "小红书" }, context);
    const list = await catalog.query({ scope: "all" }, context);

    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ nameSource: "fallback" });
    complete({ kind: "title", title: "小红书自动标题" });
    expect((await search).total).toBe(1);
    await catalog.dispose();
  });

  it.each(["sqlite", "sdk-fallback"] as const)(
    "searches a real Chinese seed title through the %s projection",
    async (projection) => {
      const root = await mkdtemp(join(tmpdir(), "pi67-catalog-title-search-"));
      roots.push(root);
      const path = join(root, "session.jsonl");
      await writeFile(path, [
        {
          type: "message",
          id: "message-1",
          parentId: null,
          message: { role: "user", content: "小红书笔记需要怎么写呀" }
        },
        {
          type: "message",
          id: "message-2",
          parentId: "message-1",
          message: { role: "assistant", content: "可以从内容定位开始。" }
        },
        {
          type: "message",
          id: "message-3",
          parentId: "message-2",
          message: { role: "user", content: "继续吧" }
        }
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
      const catalog = createSessionCatalog(projection === "sqlite"
        ? { directory: join(root, "catalog") }
        : {
          openSqlite: async () => ({ kind: "fallback" as const, reason: "unavailable" as const })
        });
      const context: SessionCatalogContext = {
        sourceKey: "source",
        workspaceCwd: root,
        discover: async () => ({
          records: [{
            fileIdentity: await resolveExistingSessionFileIdentity(path),
            id: "session-1",
            path,
            cwd: root,
            cwdKey: normalizeSessionCatalogPathIdentity(root),
            modifiedAt: 1,
            messageCount: 3
          }],
          incomplete: false,
          skippedCount: 0
        })
      };

      await catalog.reconcile(context);
      const page = await catalog.query({ scope: "all", search: "小红书" }, context);
      expect(page.items).toMatchObject([{
        id: "session-1",
        name: "小红书笔记需要怎么写呀",
        nameSource: "seed"
      }]);
      await catalog.dispose();
    }
  );

  it("projects generated Pi JSONL title metadata above the deterministic seed", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-catalog-generated-title-"));
    roots.push(root);
    const path = join(root, "session.jsonl");
    await writeFile(path, [
      {
        type: "message",
        id: "message-1",
        parentId: null,
        message: { role: "user", content: "把工作区对话标题和正文搜索合并一下" }
      },
      {
        type: "message",
        id: "message-2",
        parentId: "message-1",
        message: { role: "assistant", content: "建议使用可重建索引。" }
      },
      {
        type: "custom",
        customType: "pi67.session-title.v1",
        id: "title-1",
        parentId: "message-2",
        data: {
          version: 1,
          status: "generated",
          title: "统一会话内容搜索",
          basedOnEntryId: "message-2",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          generatedAt: 100
        }
      }
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
    const catalog = createSessionCatalog({
      openSqlite: async () => ({ kind: "fallback" as const, reason: "unavailable" as const })
    });
    const context: SessionCatalogContext = {
      sourceKey: "generated-source",
      workspaceCwd: root,
      discover: async () => ({
        records: [{
          fileIdentity: await resolveExistingSessionFileIdentity(path),
          id: "session-generated",
          path,
          cwd: root,
          cwdKey: normalizeSessionCatalogPathIdentity(root),
          modifiedAt: 100,
          messageCount: 2
        }],
        incomplete: false,
        skippedCount: 0
      })
    };

    await catalog.reconcile(context);
    expect((await catalog.query({ scope: "all", search: "统一会话" }, context)).items)
      .toMatchObject([{ name: "统一会话内容搜索", nameSource: "generated" }]);
    await catalog.dispose();
  });

  it("returns metadata before JSONL enrichment and refreshes from the memory cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-catalog-title-"));
    roots.push(root);
    const path = join(root, "session.jsonl");
    await writeFile(path, `${JSON.stringify({
      type: "message",
      id: "message-1",
      parentId: null,
      message: { role: "user", content: "修复 Windows 冷启动" }
    })}\n`, "utf8");
    const onChanged = vi.fn();
    const catalog = createSessionCatalog({ onChanged });
    const context: SessionCatalogContext = {
      sourceKey: "source",
      workspaceCwd: root,
      discover: async () => ({
        records: [{
          fileIdentity: await resolveExistingSessionFileIdentity(path),
          id: "session-1",
          path,
          cwd: root,
          cwdKey: normalizeSessionCatalogPathIdentity(root),
          modifiedAt: 1,
          messageCount: 1
        }],
        incomplete: false,
        skippedCount: 0
      })
    };
    await catalog.reconcile(context);
    onChanged.mockClear();

    const first = await catalog.query({ scope: "all" }, context);
    expect(first.items[0]).toMatchObject({ name: "未命名对话", nameSource: "fallback" });
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({
      reason: "automatic-title"
    })));

    const enriched = await catalog.query({ scope: "all" }, context);
    expect(enriched.items[0]).toMatchObject({
      name: "修复 Windows 冷启动",
      nameSource: "seed"
    });
    await catalog.dispose();
  });
});

function unnamedRecord(index: number): SessionCatalogRecord {
  return {
    fileIdentity: `session-file-${index}`,
    id: `session-${index}`,
    path: `/sessions/${index}.jsonl`,
    cwd: "/workspace",
    cwdKey: "/workspace",
    modifiedAt: 10_000 - index,
    messageCount: 1
  };
}

function fixtureContext(records: SessionCatalogRecord[]): SessionCatalogContext {
  return {
    sourceKey: "source",
    workspaceCwd: "/workspace",
    discover: async () => ({ records, incomplete: false, skippedCount: 0 })
  };
}
