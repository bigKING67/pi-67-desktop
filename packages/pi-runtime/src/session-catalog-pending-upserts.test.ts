import { describe, expect, it } from "vitest";
import { mergePendingSessionCatalogUpserts } from "./session-catalog-pending-upserts.js";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

describe("Session Catalog pending upsert merge", () => {
  it("replaces a stale locator by physical identity", () => {
    const discovered = record({ path: "/sessions/old.jsonl", modifiedAt: 10 });
    const pending = record({ path: "/sessions/new.jsonl", modifiedAt: 11 });

    expect(mergePendingSessionCatalogUpserts(
      [discovered],
      new Map([[pending.fileIdentity, { generation: 1, record: pending }]]),
      1
    )).toEqual([pending]);
  });

  it("fails closed when one physical JSONL carries contradictory Session IDs", () => {
    const discovered = record({ id: "session-a" });
    const pending = record({ id: "session-b", modifiedAt: 11 });

    expect(() => mergePendingSessionCatalogUpserts(
      [discovered],
      new Map([[pending.fileIdentity, { generation: 1, record: pending }]]),
      1
    )).toThrow(/contradictory|physical Session/i);
  });
});

function record(overrides: Partial<SessionCatalogRecord> = {}): SessionCatalogRecord {
  return {
    fileIdentity: "session-file-fixture-1",
    id: "session-1",
    path: "/sessions/current.jsonl",
    cwd: "/workspace",
    cwdKey: "/workspace",
    modifiedAt: 10,
    messageCount: 1,
    ...overrides
  };
}
