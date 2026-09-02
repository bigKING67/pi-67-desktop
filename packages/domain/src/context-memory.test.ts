import { describe, expect, it } from "vitest";
import {
  contextOwnerTransitionAllowed,
  enterpriseCandidateEligibility,
  memoryPrivacyCapabilities,
  resolveContextOwner,
  type ContextOwnerLock
} from "./context-memory.js";

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

  it("requires login, trust, binding, evidence, redaction, and full learning", () => {
    expect(enterpriseCandidateEligibility({
      identity: { state: "signed-in", accountId: "team-a", userId: "user-a" },
      workspace: { state: "bound", workspaceId: "workspace-a", enterpriseProjectId: "project-a" },
      privacyMode: "full-learning",
      workspaceTrusted: true,
      result: "success",
      evidenceCount: 1,
      redactionStatus: "passed",
      sensitivity: "team"
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
      sensitivity: "private"
    }).reasons).toEqual([
      "signed-out",
      "workspace-untrusted",
      "workspace-unbound",
      "privacy-mode",
      "result-unverified",
      "missing-evidence",
      "redaction-incomplete",
      "private-sensitivity"
    ]);
  });
});
