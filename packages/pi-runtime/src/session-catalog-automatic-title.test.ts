import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionCatalog, type SessionCatalogContext } from "./session-catalog.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Session Catalog automatic title projection", () => {
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
      nameSource: "latest-user"
    });
    await catalog.dispose();
  });
});
