import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RecallObservationStore } from "./recall-observation-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RecallObservationStore", () => {
  it("stores only bounded opaque telemetry and applies local feedback", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-recall-store-"));
    roots.push(root);
    const store = new RecallObservationStore(root);
    await store.recordEnterprise({
      workspaceId: "workspace-secret-name",
      query: "customer private query",
      route: "enterprise-experience",
      durationMs: 320,
      candidateCount: 8,
      items: [
        { id: "asset-a", score: 0.9 },
        { id: "asset-b", score: 0.8 }
      ]
    });

    const raw = await readFile(store.observationPath, "utf8");
    expect(raw).not.toContain("workspace-secret-name");
    expect(raw).not.toContain("customer private query");
    expect(raw).not.toContain("asset-a");
    expect((await stat(store.observationPath)).mode & 0o777).toBe(0o600);

    const listed = await store.list({
      workspaceId: "workspace-secret-name",
      actorPeerId: "peer",
      limit: 20
    });
    expect(listed.items).toHaveLength(2);
    expect(listed.items[0]).toMatchObject({
      source: "shared-experience",
      route: "enterprise-experience",
      durationMs: 320,
      candidateCount: 8,
      selectedCount: 2
    });

    await store.recordFeedback({
      id: listed.items[0]!.id,
      feedback: "incorrect",
      workspaceId: "workspace-secret-name",
      actorPeerId: "peer"
    });
    const filtered = await store.applyEnterpriseFeedback(
      "workspace-secret-name",
      "enterprise-experience",
      [{ id: "asset-a", score: 0.9 }, { id: "asset-b", score: 0.8 }]
    );
    expect(filtered).toEqual([{ id: "asset-b", score: 0.8 }]);
    expect((await store.list({
      workspaceId: "workspace-secret-name",
      actorPeerId: "peer",
      limit: 20
    })).items[0]?.feedback).toBe("incorrect");

    await Promise.all([
      store.recordFeedback({
        id: listed.items[0]!.id,
        feedback: "helpful",
        workspaceId: "workspace-secret-name",
        actorPeerId: "peer"
      }),
      store.recordFeedback({
        id: listed.items[1]!.id,
        feedback: "irrelevant",
        workspaceId: "workspace-secret-name",
        actorPeerId: "peer"
      })
    ]);
    const concurrentFeedback = await store.list({
      workspaceId: "workspace-secret-name",
      actorPeerId: "peer",
      limit: 20
    });
    expect(concurrentFeedback.items.map((item) => item.feedback)).toEqual(["helpful", "irrelevant"]);
    expect(await store.applyEnterpriseFeedback(
      "workspace-secret-name",
      "enterprise-experience",
      [{ id: "asset-a", score: 0.9 }, { id: "asset-b", score: 0.8 }]
    )).toEqual([
      { id: "asset-a", score: 0.98 },
      { id: "asset-b", score: 0.55 }
    ]);

    await expect(store.recordFeedback({
      id: "not-an-opaque-item-id",
      feedback: "helpful",
      workspaceId: "workspace-secret-name",
      actorPeerId: "peer"
    })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(store.recordFeedback({
      id: listed.items[0]!.id,
      feedback: "helpful",
      workspaceId: "other-workspace",
      actorPeerId: "other-peer"
    })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(store.recordFeedback({
      id: `${listed.items[0]!.id.slice(0, 65)}${"c".repeat(64)}`,
      feedback: "helpful",
      workspaceId: "workspace-secret-name",
      actorPeerId: "peer"
    })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("reports deterministic p50 and p95 from bounded metadata samples", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-recall-metrics-"));
    roots.push(root);
    const store = new RecallObservationStore(root);
    for (const durationMs of [100, 200, 300, 1_600]) {
      await store.recordEnterprise({
        workspaceId: "workspace",
        query: `query-${durationMs}`,
        route: "enterprise-sop",
        durationMs,
        candidateCount: 1,
        items: [{ id: `asset-${durationMs}`, score: 0.8 }]
      });
    }
    expect(await store.metrics({ workspaceId: "workspace", actorPeerId: "peer" })).toMatchObject({
      sampleCount: 4,
      p50Ms: 200,
      p95Ms: 1_600,
      withinTarget: false
    });
  });

  it("drops unscoped or malformed persisted recall items instead of projecting them", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-recall-invalid-"));
    roots.push(root);
    const store = new RecallObservationStore(root);
    await mkdir(dirname(store.observationPath), { recursive: true });
    await writeFile(store.observationPath, `${JSON.stringify({
      kind: "context.recallCompleted",
      at: "2026-09-03T00:00:00Z",
      state: "tool-completed",
      durationMs: 10,
      route: "find-fast",
      items: [{ id: "a".repeat(64), source: "private-memory", score: 0.9 }]
    })}\n`, { mode: 0o600 });

    await expect(store.list({
      workspaceId: "workspace",
      actorPeerId: "peer",
      limit: 20
    })).resolves.toEqual({ items: [], total: 0 });
  });

  it("keeps session-scoped observations isolated and tolerates missing or corrupt stores", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-recall-sessions-"));
    roots.push(root);
    const store = new RecallObservationStore(root);

    await expect(store.metrics({
      workspaceId: "workspace",
      actorPeerId: "peer"
    })).resolves.toMatchObject({ sampleCount: 0, withinTarget: true });

    await mkdir(dirname(store.feedbackPath), { recursive: true });
    await writeFile(store.feedbackPath, "not-json\n", { mode: 0o600 });
    await store.recordEnterprise({
      workspaceId: "workspace",
      sessionId: "session-a",
      query: "query-a",
      route: "enterprise-sop",
      durationMs: -20,
      candidateCount: -4,
      items: []
    });
    await store.recordEnterprise({
      workspaceId: "workspace",
      sessionId: "session-b",
      query: "query-b",
      route: "enterprise-experience",
      durationMs: 40,
      candidateCount: 2,
      items: [{ id: "asset-b", score: -1 }]
    });

    await expect(store.list({
      workspaceId: "workspace",
      actorPeerId: "peer",
      sessionId: "session-a",
      limit: 0
    })).resolves.toEqual({ items: [], total: 0 });
    const sessionB = await store.list({
      workspaceId: "workspace",
      actorPeerId: "peer",
      sessionId: "session-b",
      limit: 1
    });
    expect(sessionB.items).toHaveLength(1);
    expect(sessionB.items[0]).toMatchObject({
      source: "shared-experience",
      score: 0,
      durationMs: 40,
      candidateCount: 2,
      selectedCount: 1
    });
    expect(await store.metrics({
      workspaceId: "workspace",
      actorPeerId: "peer",
      sessionId: "session-a"
    })).toMatchObject({ sampleCount: 1, p50Ms: 0, p95Ms: 0, withinTarget: true });
  });

  it("normalizes safe legacy diagnostics without exposing malformed metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-recall-legacy-"));
    roots.push(root);
    const store = new RecallObservationStore(root);
    const scopeHash = await createObservedScopeHash(store, "workspace");
    await mkdir(dirname(store.observationPath), { recursive: true });
    await writeFile(store.observationPath, [
      "",
      "not-json",
      JSON.stringify({ kind: "wrong", at: "now", state: "x", durationMs: 1 }),
      JSON.stringify({
        kind: "context.recallCompleted",
        at: "not-a-date",
        state: "x".repeat(140),
        durationMs: 900_000,
        count: 20_000,
        candidateCount: -2,
        selectedCount: 200,
        queryHash: "not-a-hash",
        scopeHash,
        items: [
          { id: "b".repeat(64), source: "private-memory", score: 2 },
          null,
          { id: "c".repeat(64), source: "unknown", score: 0.5 }
        ]
      })
    ].join("\n"), { mode: 0o600 });

    const listed = await store.list({
      workspaceId: "workspace",
      actorPeerId: "peer",
      limit: 10
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      title: "私人记忆候选 1",
      score: 1,
      createdAt: 0,
      durationMs: 600_000,
      candidateCount: 0,
      selectedCount: 100
    });
    expect(listed.items[0]?.reason).toBe("startup-context · 0 个候选 · 返回 100 项");
  });
});

async function createObservedScopeHash(
  store: RecallObservationStore,
  workspaceId: string
): Promise<string> {
  await store.recordEnterprise({
    workspaceId,
    query: "scope-probe",
    route: "enterprise-experience",
    durationMs: 1,
    candidateCount: 0,
    items: []
  });
  const [record] = (await readFile(store.observationPath, "utf8")).trim().split("\n");
  return String((JSON.parse(record!) as { scopeHash: string }).scopeHash);
}
