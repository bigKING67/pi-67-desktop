import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createKnowledgeAgentLoop } from "./team-knowledge-native.test-support.js";
import type { TeamKnowledgeAccess } from "./team-knowledge-access.js";

it("runs registered canonical tools through the real SDK loop and fences later model replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi67-team-agent-loop-"));
  const assetId = "00000000-0000-4000-8000-000000000001", contentRevision = "a".repeat(64);
  const identity = { userId: "user", teamId: assetId, projectId: assetId, endpoint: "https://service.invalid/" };
  const snapshot = { epoch: assetId, cursor: "1" }, document = { kind: "sop" as const, title: "Synthetic", summary: "Shipping", body: "Check the order." };
  let allowed = true;
  const search = vi.fn<TeamKnowledgeAccess["search"]>(async () => ({ snapshot, hits: [{ assetId, contentRevision, score: 1 }] }));
  const read = vi.fn<TeamKnowledgeAccess["read"]>(async () => ({ snapshot, assetId, contentRevision, content: document }));
  let loop: Awaited<ReturnType<typeof createKnowledgeAgentLoop>> | undefined;
  try {
    loop = await createKnowledgeAgentLoop({ directory, identity, model: { baseUrl: "https://model.invalid/v1", id: "fixture" },
      access: { search, read }, assetId, document,
      authorizeTeamSession: async () => ({ identity, assertValid() { if (!allowed) throw new Error("Team access revoked."); } }) });
    await loop.run(); expect(search).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalled();
    allowed = false; await loop.assertReplayDenied(/Team access revoked/u);
  } finally { await loop?.close(); await rm(directory, { recursive: true, force: true }); }
}, 30_000);
