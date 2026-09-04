import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExperienceCandidateReview } from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listPrivateExperienceSummaries,
  reconcileExperienceCandidates,
  reviewExperienceCandidate
} from "./experience-candidate-assembler.js";
import {
  ExperienceCandidateStore,
  type StoredExperienceCandidate
} from "./experience-candidate-store.js";
import type { OpenVikingClient } from "./openviking-client.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Experience candidate assembly", () => {
  it("assembles only the exact Experience operations from a completed Commit memory diff", async () => {
    const store = await trackingStore();
    const experienceUri = "viking://user/local/memories/experiences/host-recovery.md";
    const memoryDiff = JSON.stringify({
      archive_uri: "viking://user/local/sessions/session-1/history/archive_001",
      operations: {
        adds: [{
          uri: experienceUri,
          memory_type: "experiences",
          after: "# Host epoch recovery\n\n## Situation\nOld Host events stay visible.\n\n## Approach\nDiscard stale epochs.\n\n## Reflect\nRun recovery tests."
        }, {
          uri: "viking://user/local/memories/preferences/style.md",
          memory_type: "preferences",
          after: "Unrelated"
        }],
        updates: [],
        deletes: []
      }
    });
    const client = {
      getTask: vi.fn(async () => ({
        task_id: "task-1",
        task_type: "session_commit",
        status: "completed",
        result: {
          session_id: "session-1",
          archive_uri: "viking://user/local/sessions/session-1/history/archive_001",
          memory_diff_uri: "viking://user/local/sessions/session-1/history/archive_001/memory_diff.json"
        }
      })),
      read: vi.fn(async () => memoryDiff)
    } as unknown as OpenVikingClient;
    const created = vi.fn();
    const failed = vi.fn();

    await reconcileExperienceCandidates({
      store,
      client,
      workspaceId: "workspace-1",
      onCreated: created,
      onFailed: failed
    });

    const candidates = await store.listCandidates("workspace-1");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      summary: {
        title: "Host epoch recovery",
        problem: "Old Host events stay visible.",
        strategy: expect.stringContaining("Discard stale epochs."),
        status: "candidate",
        result: "partial",
        redactionStatus: "pending",
        evidence: [
          { reference: `sha256:${"c".repeat(64)}` },
          { reference: `sha256:${sha256("# Host epoch recovery\n\n## Situation\nOld Host events stay visible.\n\n## Approach\nDiscard stale epochs.\n\n## Reflect\nRun recovery tests.")}` }
        ]
      },
      source: { experienceUri }
    });
    expect(created).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    await expect(store.trackingReceipts("workspace-1")).resolves.toEqual([]);
  });

  it("does not assemble a task whose Session hash differs from Pi JSONL provenance", async () => {
    const store = await trackingStore();
    const failed = vi.fn();
    await reconcileExperienceCandidates({
      store,
      client: {
        getTask: async () => ({
          task_id: "task-1",
          task_type: "session_commit",
          status: "completed",
          result: {
            session_id: "another-session",
            archive_uri: "viking://user/local/sessions/another/history/archive_001",
            memory_diff_uri: "viking://user/local/sessions/another/history/archive_001/memory_diff.json"
          }
        })
      } as unknown as OpenVikingClient,
      workspaceId: "workspace-1",
      onCreated: vi.fn(),
      onFailed: failed
    });
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSessionIdHash: sha256("session-1") }),
      expect.stringContaining("did not match")
    );
    await expect(store.trackingReceipts("workspace-1")).resolves.toHaveLength(1);
  });

  it("redacts deterministic sensitive patterns and requires explicit user confirmation", () => {
    const candidate = candidateFixture();
    const review: ExperienceCandidateReview = {
      id: candidate.summary.id,
      expectedUpdatedAt: candidate.summary.updatedAt,
      taskType: "credential rotation",
      title: "Fix api_key=SYNTHETIC_SECRET_1234567890 in /Users/alice/project/.env",
      problem: "Contact alice@example.com and inspect 10.0.0.8",
      strategy: "Replace Authorization: Bearer SYNTHETIC_TOKEN_1234567890 and rerun tests",
      result: "success",
      confidence: 0.9,
      sensitivity: "team",
      method: {
        preconditions: ["A project credential is rejected"],
        steps: ["Replace the rejected credential", "Run the authentication tests"],
        tools: ["test runner"],
        validationGates: ["Authentication succeeds"],
        completionCriteria: ["The protected request completes"],
        failureModes: ["The replacement credential is also rejected"],
        rollback: "Restore the previous credential reference."
      },
      applicableWhen: ["A project credential is rejected"],
      notApplicableWhen: ["No authentication is involved"],
      evidence: [{
        kind: "test",
        label: "42 tests passed",
        reference: `sha256:${"1".repeat(64)}`,
        verifiedAt: 30
      }],
      confirmOutcome: true,
      confirmRedaction: true
    };

    const reviewed = reviewExperienceCandidate(candidate, review, 40);
    expect(reviewed.summary).toMatchObject({
      status: "validated",
      result: "success",
      redactionStatus: "passed",
      sensitivity: "team",
      sourceCases: [{ result: "success", evidenceCount: 3 }],
      method: {
        steps: ["Replace the rejected credential", "Run the authentication tests"],
        validationGates: ["Authentication succeeds"]
      }
    });
    expect(JSON.stringify(reviewed.summary)).not.toMatch(/alice|\/Users|api[_ ]key|bearer|SYNTHETIC_|10\.0\.0\.8/iu);
    expect(JSON.stringify(reviewed.summary)).toContain("[REDACTED_CREDENTIAL]");
    expect(reviewed.summary.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "test", reference: `sha256:${"1".repeat(64)}` }),
      expect.objectContaining({ kind: "user-confirmation" })
    ]));
  });

  it("lists private Experiences without manufacturing enterprise eligibility", async () => {
    const root = "viking://user/local/memories/experiences";
    const uri = `${root}/recovery.md`;
    const client = {
      listDirectory: vi.fn(async (target: string) => target === "viking://user/memories" ? [root] : [uri]),
      read: vi.fn(async () => "Situation: Host restarted\nApproach: Reload state\nReflect: Verify epoch")
    } as unknown as OpenVikingClient;
    await expect(listPrivateExperienceSummaries(client, "workspace-1", 20)).resolves.toEqual([
      expect.objectContaining({
        id: uri,
        status: "private",
        sensitivity: "private",
        result: "partial",
        evidence: []
      })
    ]);
  });
});

async function trackingStore(): Promise<ExperienceCandidateStore> {
  const root = await mkdtemp(join(tmpdir(), "pi67-candidate-assembler-"));
  roots.push(root);
  const store = new ExperienceCandidateStore(root);
  await store.prepareCommit("submission-1", {
    workspaceId: "workspace-1",
    workspaceFingerprint: "a".repeat(64),
    sourceSessionIdHash: sha256("session-1"),
    sessionContentHash: "c".repeat(64),
    sessionFileIdentityHash: "d".repeat(64),
    sessionBytes: 100,
    capturedAt: 10
  });
  await store.markCommitTracking("submission-1", "task-1");
  return store;
}

function candidateFixture(): StoredExperienceCandidate {
  return {
    summary: {
      id: "candidate-1",
      taskType: "recovery",
      title: "Recovery",
      problem: "Stale state",
      strategy: "Reload",
      result: "partial",
      confidence: 0.5,
      status: "candidate",
      sensitivity: "project",
      sourceCases: [{
        id: "case-1",
        source: "pi-session-commit",
        result: "partial",
        evidenceCount: 1,
        workspaceId: "workspace-1",
        capturedAt: 10
      }],
      method: {
        preconditions: [],
        steps: [],
        tools: [],
        validationGates: [],
        completionCriteria: [],
        failureModes: [],
        rollback: ""
      },
      applicableWhen: ["Host restarts"],
      notApplicableWhen: [],
      evidence: [{ kind: "artifact", label: "Pi JSONL snapshot", reference: `sha256:${"c".repeat(64)}`, verifiedAt: 10 }],
      redactionStatus: "pending",
      workspaceId: "workspace-1",
      createdAt: 20,
      updatedAt: 20
    },
    source: {
      commitSubmissionId: "submission-1",
      workspaceFingerprint: "a".repeat(64),
      sourceSessionIdHash: sha256("session-1"),
      sessionContentHash: "c".repeat(64),
      experienceUri: "viking://user/local/memories/experiences/recovery.md",
      experienceUriHash: "e".repeat(64),
      experienceContentHash: "f".repeat(64)
    }
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
