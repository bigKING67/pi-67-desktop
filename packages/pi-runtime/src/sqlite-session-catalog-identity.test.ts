import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openSqliteSessionCatalog,
  type SessionCatalogRecord,
  type SqliteSessionCatalog
} from "./sqlite-session-catalog.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";

const roots: string[] = [];
const WORKSPACE = normalizeSessionCatalogPathIdentity("/workspace");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SQLite Session Catalog physical identity", () => {
  it("updates a Session locator without duplicating the same physical JSONL", async () => {
    const catalog = await openReady();
    catalog.replaceAll("source", [record(1)], metadata(), 1);
    const moved = record(1, { path: "/aliases/renamed-session.jsonl", modifiedAt: 2_000 });

    const state = catalog.upsert(moved, 2);

    expect(state.itemCount).toBe(1);
    expect(catalog.query({ scope: "all", cwdKey: WORKSPACE, limit: 50 }).records).toEqual([moved]);
    catalog.close();
  });

  it("fails closed on conflicting physical or locator identities", async () => {
    const catalog = await openReady();
    const original = record(1);
    catalog.replaceAll("source", [original], metadata(), 1);

    expect(() => catalog.upsert(record(2, {
      fileIdentity: original.fileIdentity,
      path: "/sessions/physical-alias.jsonl"
    }), 2)).toThrow(/identity|Session/i);
    expect(() => catalog.upsert(record(2, {
      fileIdentity: "session-file-fixture-replacement",
      path: original.path
    }), 2)).toThrow(/identity|path|locator|Session/i);
    expect(catalog.getState()).toMatchObject({ sourceKey: "source", itemCount: 1 });
    expect(catalog.query({ scope: "all", cwdKey: WORKSPACE, limit: 50 }).records).toEqual([original]);
    catalog.close();
  });

  it("rolls back a rebuild with contradictory Session IDs for one physical JSONL", async () => {
    const catalog = await openReady();
    const original = record(1);
    const state = catalog.replaceAll("source", [original], metadata(), 1);

    expect(() => catalog.replaceAll("source", [
      record(2, { fileIdentity: "shared-physical-session", path: "/sessions/a.jsonl" }),
      record(3, { fileIdentity: "shared-physical-session", path: "/sessions/b.jsonl" })
    ], metadata(), 2)).toThrow(/contradictory|physical Session/i);
    expect(catalog.getState()).toEqual(state);
    expect(catalog.query({ scope: "all", cwdKey: WORKSPACE, limit: 50 }).records).toEqual([original]);
    catalog.close();
  });
});

async function openReady(): Promise<SqliteSessionCatalog> {
  const root = await mkdtemp(join(tmpdir(), "pi67-session-catalog-identity-"));
  roots.push(root);
  const result = await openSqliteSessionCatalog(root);
  if (result.kind !== "ready") throw new Error(`SQLite unavailable: ${result.reason}`);
  return result.catalog;
}

function record(index: number, overrides: Partial<SessionCatalogRecord> = {}): SessionCatalogRecord {
  return {
    fileIdentity: `session-file-fixture-${index}`,
    id: `id-${index}`,
    path: `/sessions/${String(index).padStart(3, "0")}.jsonl`,
    cwd: WORKSPACE,
    cwdKey: WORKSPACE,
    explicitName: `Session ${index}`,
    modifiedAt: 1_000 - index,
    messageCount: index,
    ...overrides
  };
}

function metadata() {
  return { reconciledAt: 1_700_000_000_000, incomplete: false, skippedCount: 0 };
}
