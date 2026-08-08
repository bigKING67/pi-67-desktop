import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSessionCatalog } from "./session-catalog.js";
import {
  sessionCatalogContext as makeContext,
  sessionCatalogDiscovery as discovery,
  sessionCatalogRecord as record
} from "./session-catalog-test-fixtures.js";

describe("Session Catalog organization", () => {
  it("snoozes, wakes, and resolves pin/archive conflicts without touching Session JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-session-catalog-snooze-"));
    const path = join(root, "session.jsonl");
    await writeFile(path, '{"type":"session"}\n', "utf8");
    const catalog = createSessionCatalog({ now: () => 1_000 });
    const context = makeContext("source", async () => discovery([record(1, { path })]));
    try {
      await catalog.reconcile(context);
      await catalog.organize(path, { kind: "snooze", value: 5_000 }, context);
      expect((await catalog.query({ scope: "workspace" }, context)).items[0]).toMatchObject({
        snoozedUntil: 5_000
      });

      await catalog.organize(path, { kind: "pin", value: true }, context);
      const pinned = (await catalog.query({ scope: "workspace" }, context)).items[0];
      expect(pinned?.pinnedAt).toBeDefined();
      expect(pinned?.snoozedUntil).toBeUndefined();

      await catalog.organize(path, { kind: "snooze", value: 6_000 }, context);
      const snoozed = (await catalog.query({ scope: "workspace" }, context)).items[0];
      expect(snoozed?.pinnedAt).toBeUndefined();
      expect(snoozed?.snoozedUntil).toBe(6_000);

      await catalog.organize(path, { kind: "snooze", value: undefined }, context);
      expect((await catalog.query({ scope: "workspace" }, context)).items[0]?.snoozedUntil).toBeUndefined();

      await catalog.organize(path, { kind: "archive", value: true }, context);
      await expect(catalog.organize(path, { kind: "snooze", value: 7_000 }, context))
        .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
      expect(await readFile(path, "utf8")).toBe('{"type":"session"}\n');
    } finally {
      await catalog.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reorders the exact pinned Workspace permutation and rejects stale orders", async () => {
    const changed = vi.fn();
    const catalog = createSessionCatalog({ now: () => 50_000, onChanged: changed });
    const context = makeContext("source", async () => discovery([
      record(1, { pinnedAt: 30_000 }),
      record(2, { pinnedAt: 20_000 }),
      record(3, { pinnedAt: 10_000 }),
      record(4)
    ]));
    await catalog.reconcile(context);
    changed.mockClear();

    const revision = await catalog.reorderPinned([
      "/session-3.jsonl",
      "/session-1.jsonl",
      "/session-2.jsonl"
    ], context);

    const page = await catalog.query({ scope: "workspace", limit: 10 }, context);
    expect(page.revision).toBe(revision);
    expect(page.items.slice(0, 3).map((item) => item.path)).toEqual([
      "/session-3.jsonl",
      "/session-1.jsonl",
      "/session-2.jsonl"
    ]);
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith({ revision, reason: "conversation-organized" });

    await expect(catalog.reorderPinned([
      "/session-3.jsonl",
      "/session-1.jsonl"
    ], context)).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await catalog.dispose();
  });
});
