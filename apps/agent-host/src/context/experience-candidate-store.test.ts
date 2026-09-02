import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExperienceCandidateSummary } from "@pi67/domain";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionCommitProvenance } from "./experience-candidate-provenance.js";
import {
  ExperienceCandidateStore,
  type StoredExperienceCandidate
} from "./experience-candidate-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ExperienceCandidateStore", () => {
  it("persists exact Commit receipts and reviewed candidates across Host restarts", async () => {
    const root = await temporaryRoot();
    const store = new ExperienceCandidateStore(root);
    const prepared = await store.prepareCommit("submission-1", provenance());
    expect(prepared).toMatchObject({ created: true, receipt: { state: "prepared" } });
    await expect(store.prepareCommit("submission-1", provenance())).resolves.toMatchObject({ created: false });
    await expect(store.prepareCommit("submission-1", {
      ...provenance(),
      sessionContentHash: "9".repeat(64)
    })).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });

    await store.markCommitTracking("submission-1", "task-1");
    await store.upsertCandidates([storedCandidate()]);
    await store.markCommitTerminal("submission-1", "completed", undefined, ["candidate-1"]);

    const restarted = new ExperienceCandidateStore(root);
    await expect(restarted.trackingReceipts("workspace-1")).resolves.toEqual([]);
    await expect(restarted.getCandidate("candidate-1", "workspace-1"))
      .resolves.toMatchObject({ summary: { title: "Host recovery", status: "candidate" } });
    await restarted.updateCandidate("candidate-1", "workspace-1", 20, (current) => ({
      ...current,
      summary: { ...current.summary, status: "validated", updatedAt: 21 }
    }));
    await expect(restarted.getCandidate("candidate-1", "workspace-1"))
      .resolves.toMatchObject({ summary: { status: "validated", updatedAt: 21 } });

    const persisted = await readFile(store.path, "utf8");
    expect(persisted).not.toContain("/private/local/session.jsonl");
    expect(persisted).toContain("pi67-experience-candidates.v1");
  });

  it("fails candidate storage closed for corrupt and symlinked state", async () => {
    const corruptRoot = await temporaryRoot();
    const corrupt = new ExperienceCandidateStore(corruptRoot);
    await mkdir(dirname(corrupt.path), { recursive: true });
    await writeFile(corrupt.path, "{bad-json", "utf8");
    await expect(corrupt.listCandidates("workspace-1")).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    const symlinkRoot = await temporaryRoot();
    const linked = new ExperienceCandidateStore(symlinkRoot);
    await mkdir(dirname(linked.path), { recursive: true });
    const outside = join(symlinkRoot, "outside.json");
    await writeFile(outside, JSON.stringify({ schema: "pi67-experience-candidates.v1", receipts: [], candidates: [] }));
    await symlink(outside, linked.path);
    await expect(linked.listCandidates("workspace-1")).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });
});

function provenance(): SessionCommitProvenance {
  return {
    workspaceId: "workspace-1",
    workspaceFingerprint: "a".repeat(64),
    sourceSessionIdHash: "b".repeat(64),
    sessionContentHash: "c".repeat(64),
    sessionFileIdentityHash: "d".repeat(64),
    sessionBytes: 123,
    capturedAt: 10
  };
}

function storedCandidate(): StoredExperienceCandidate {
  const summary: ExperienceCandidateSummary = {
    id: "candidate-1",
    taskType: "electron-recovery",
    title: "Host recovery",
    problem: "Old Host events remained visible.",
    strategy: "Discard events from a stale Host epoch.",
    result: "partial",
    confidence: 0.5,
    status: "candidate",
    sensitivity: "project",
    applicableWhen: ["Host epoch changes"],
    notApplicableWhen: [],
    evidence: [{ kind: "artifact", label: "Pi JSONL snapshot", reference: `sha256:${"c".repeat(64)}`, verifiedAt: 10 }],
    redactionStatus: "pending",
    workspaceId: "workspace-1",
    createdAt: 20,
    updatedAt: 20
  };
  return {
    summary,
    source: {
      commitSubmissionId: "submission-1",
      workspaceFingerprint: "a".repeat(64),
      sourceSessionIdHash: "b".repeat(64),
      sessionContentHash: "c".repeat(64),
      experienceUri: "viking://user/local/memories/experiences/host-recovery.md",
      experienceUriHash: "e".repeat(64),
      experienceContentHash: "f".repeat(64)
    }
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-experience-store-"));
  roots.push(root);
  return root;
}
