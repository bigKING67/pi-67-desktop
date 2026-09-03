import { describe, expect, it } from "vitest";
import {
  assessSopReadiness,
  contextOwnerTransitionAllowed,
  enterpriseCandidateEligibility,
  memoryPrivacyCapabilities,
  resolveContextOwner,
  type ContextOwnerLock
} from "./context-memory.js";
import { summarizeRecallMetrics } from "./context-recall.js";

describe("context and memory policy", () => {
  it("keeps personal learning local unless full learning is explicitly selected", () => {
    expect(memoryPrivacyCapabilities("private-learning")).toEqual({
      recall: true,
      writePrivateMemory: true,
      createTeamCandidate: false
    });
    expect(memoryPrivacyCapabilities("full-learning").createTeamCandidate).toBe(true);
    expect(memoryPrivacyCapabilities("off").recall).toBe(false);
  });

  it("fails Pi open and memory closed when owners conflict", () => {
    expect(resolveContextOwner({
      openVikingEnabled: true,
      openVikingAvailable: true,
      conflictingOwners: ["pi-hy-memory"]
    })).toBe("pi-default-compaction");
  });

  it("does not switch the context owner inside one session", () => {
    const lock: ContextOwnerLock = {
      sessionId: "session-a",
      owner: "pi67-openviking",
      lockedAt: 1,
      reason: "session-created"
    };
    expect(contextOwnerTransitionAllowed(lock, "pi-default-compaction", "session-a")).toBe(false);
    expect(contextOwnerTransitionAllowed(lock, "pi-default-compaction", "session-b")).toBe(true);
  });

  it("summarizes bounded recall latency without source content", () => {
    expect(summarizeRecallMetrics([
      { durationMs: 120, route: "find-fast", selectedCount: 1 },
      { durationMs: 160, route: "cache", selectedCount: 1 },
      { durationMs: 900, route: "session-context", selectedCount: 0 },
      { durationMs: 1_700, route: "enterprise-experience", selectedCount: 1 }
    ], 1_500)).toEqual({
      sampleCount: 4,
      p50Ms: 160,
      p95Ms: 1_700,
      fastPathRate: 0.25,
      expansionRate: 0.25,
      cacheHitRate: 0.25,
      emptyRate: 0.25,
      targetP95Ms: 1_500,
      withinTarget: false
    });
  });

  it("requires login, trust, binding, evidence, redaction, and full learning", () => {
    expect(enterpriseCandidateEligibility({
      identity: { state: "signed-in", accountId: "team-a", userId: "user-a" },
      workspace: { state: "bound", workspaceId: "workspace-a", enterpriseProjectId: "project-a" },
      privacyMode: "full-learning",
      workspaceTrusted: true,
      result: "success",
      evidenceCount: 1,
      redactionStatus: "passed",
      sensitivity: "team",
      methodComplete: true
    })).toEqual({ eligible: true, reasons: [] });
  });

  it("reports every failed enterprise promotion gate", () => {
    expect(enterpriseCandidateEligibility({
      identity: { state: "signed-out" },
      workspace: { state: "unbound", workspaceId: "workspace-a" },
      privacyMode: "private-learning",
      workspaceTrusted: false,
      result: "partial",
      evidenceCount: 0,
      redactionStatus: "pending",
      sensitivity: "private",
      methodComplete: false
    }).reasons).toEqual([
      "signed-out",
      "workspace-untrusted",
      "workspace-unbound",
      "privacy-mode",
      "result-unverified",
      "missing-evidence",
      "redaction-incomplete",
      "method-incomplete",
      "private-sensitivity"
    ]);
  });

  it("never treats one successful Case as an SOP candidate", () => {
    expect(assessSopReadiness(experience({ status: "validated" }))).toMatchObject({
      state: "not-ready",
      caseCount: 1,
      workspaceCount: 1,
      reasons: [
        "insufficient-independent-cases",
        "insufficient-independent-workspaces"
      ]
    });
  });

  it("requires three successful Cases across two Workspaces and a complete method", () => {
    expect(assessSopReadiness(experience({
      status: "shared",
      sourceCases: [
        sourceCase("case-1", "workspace-1"),
        sourceCase("case-2", "workspace-1"),
        sourceCase("case-3", "workspace-2")
      ]
    }))).toEqual({
      state: "candidate-ready",
      reasons: [],
      caseCount: 3,
      workspaceCount: 2,
      requiredCaseCount: 3,
      requiredWorkspaceCount: 2
    });
  });
});

function experience(overrides: Partial<Parameters<typeof assessSopReadiness>[0]> = {}) {
  return {
    id: "experience-1",
    taskType: "electron-recovery",
    title: "Host recovery",
    problem: "Old Host events remain visible.",
    strategy: "Discard stale Host events.",
    result: "success" as const,
    confidence: 0.9,
    status: "validated" as const,
    sensitivity: "team" as const,
    sourceCases: [sourceCase("case-1", "workspace-1")],
    method: {
      preconditions: ["The Agent Host epoch changed"],
      steps: ["Discard events from the stale epoch"],
      tools: ["packaged smoke"],
      validationGates: ["No stale Projection remains"],
      completionCriteria: ["The current epoch resumes"],
      failureModes: ["A stale approval remains visible"],
      rollback: "Restore the previous host state."
    },
    applicableWhen: ["The Agent Host restarts"],
    notApplicableWhen: ["A normal renderer rerender occurs"],
    evidence: [],
    redactionStatus: "passed" as const,
    workspaceId: "workspace-1",
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  };
}

function sourceCase(id: string, workspaceId: string) {
  return {
    id,
    source: "pi-session-commit" as const,
    result: "success" as const,
    evidenceCount: 1,
    workspaceId,
    capturedAt: 1
  };
}
