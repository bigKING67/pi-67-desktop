import type { ExperienceCandidateSummary } from "@pi67/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  candidateFlowFetch,
  cleanupRouterFixtures,
  createRouter,
  requestUrl,
  workspaceContext
} from "./context-memory-command-router.test-support.js";

afterEach(cleanupRouterFixtures);

describe("Context Memory enterprise Experience flow", () => {
  it("assembles, reviews, and explicitly submits one evidence-backed candidate without raw Session data", async () => {
    const endpoint = "https://datahub.example.test";
    const expiresAt = Date.now() + 10 * 60_000;
    const fetchMock = candidateFlowFetch(expiresAt);
    vi.stubGlobal("fetch", fetchMock);
    const fixture = await createRouter(
      { enterpriseGatewayEndpoint: endpoint, privacyMode: "full-learning" },
      {
        secureStorage: "available",
        workspaceTrusted: true,
        credential: {
          endpoint,
          accessToken: "agent-access-token",
          accountId: "account-1",
          userId: "user-1",
          expiresAt
        }
      }
    );

    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "context.session.commit",
      payload: { submissionId: "commit-candidate-1", sessionId: "session/one" }
    }, "commit-candidate-1")).resolves.toMatchObject({ kind: "accepted" });
    await vi.waitFor(() => {
      expect(fixture.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "context.commitCompleted" })
      ]));
    });

    const listed = await fixture.router.dispatchWorkspace(workspaceContext, {
      type: "experience.private.list",
      payload: { limit: 20 }
    });
    if (!("items" in listed)) throw new Error("Expected Experience list");
    const draft = (listed.items as ExperienceCandidateSummary[]).find((item) => item.status === "candidate");
    if (!draft) throw new Error("Expected exact Commit candidate");
    expect(draft).toMatchObject({
      result: "partial",
      redactionStatus: "pending",
      evidence: [{ kind: "artifact" }, { kind: "artifact" }]
    });

    const reviewed = await fixture.router.dispatchWorkspace(workspaceContext, {
      type: "experience.candidate.review",
      payload: {
        id: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        taskType: "electron-recovery",
        title: "Host epoch recovery",
        problem: "Old Host events remain visible",
        strategy: "Discard stale epoch events and run recovery tests",
        result: "success",
        confidence: 0.9,
        sensitivity: "team",
        method: {
          preconditions: ["The Agent Host epoch changes"],
          steps: ["Discard stale epoch events", "Run recovery tests"],
          tools: ["packaged smoke"],
          validationGates: ["No stale Projection remains"],
          completionCriteria: ["The active Session resumes"],
          failureModes: ["An old approval remains visible"],
          rollback: "Restore the previous Host build."
        },
        applicableWhen: ["The Agent Host epoch changes"],
        notApplicableWhen: ["A normal renderer rerender occurs"],
        evidence: [{
          kind: "test",
          label: "42 tests passed",
          reference: `sha256:${"9".repeat(64)}`,
          verifiedAt: Date.now()
        }],
        confirmOutcome: true,
        confirmRedaction: true
      }
    }, "review-candidate-1");
    expect(reviewed).toMatchObject({ status: "validated", result: "success", redactionStatus: "passed" });

    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "experience.candidate.promote",
      payload: { submissionId: "submit-candidate-1", id: draft.id }
    }, "submit-candidate-1")).resolves.toMatchObject({ kind: "accepted" });
    await vi.waitFor(() => {
      expect(fixture.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "experience.candidatePromoted" })
      ]));
    });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "experience.candidate.get",
      payload: { id: draft.id }
    })).resolves.toMatchObject({
      status: "submitted",
      enterpriseCandidateId: "candidate-remote-1",
      submittedAt: expect.any(Number)
    });

    const candidateRequest = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith("/candidates"));
    expect(candidateRequest).toBeDefined();
    const body = candidateRequest?.[1]?.body;
    if (typeof body !== "string") throw new Error("Expected serialized candidate request body");
    const candidateBody = JSON.parse(body) as Record<string, unknown>;
    expect(candidateBody).toMatchObject({
      projectId: "project-1",
      workspaceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      sourceSessionIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      result: "success",
      redactionStatus: "passed",
      strategy: "Discard stale epoch events and run recovery tests",
      method: {
        preconditions: ["The Agent Host epoch changes"],
        steps: ["Discard stale epoch events", "Run recovery tests"],
        tools: ["packaged smoke"],
        validationGates: ["No stale Projection remains"],
        completionCriteria: ["The active Session resumes"],
        failureModes: ["An old approval remains visible"],
        rollback: "Restore the previous Host build."
      }
    });
    expect(JSON.stringify(candidateBody)).not.toContain("session/one");
    expect(JSON.stringify(candidateBody)).not.toContain(fixture.sessionPath);
    await fixture.router.shutdown();
  });
});
