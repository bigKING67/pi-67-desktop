import type { ExperienceCandidateSummary } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  buildExperienceCandidateReview,
  createReviewDraft,
  experienceCandidateNeedsReview
} from "./ExperienceCandidateReviewForm.js";

describe("Experience Inspector review model", () => {
  it("never pre-confirms an extracted candidate", () => {
    expect(createReviewDraft(candidate())).toMatchObject({
      result: "",
      confirmOutcome: false,
      confirmRedaction: false,
      sensitivity: "project"
    });
  });

  it("lets a legacy validated candidate reopen review until its method is complete", () => {
    const item = candidate();
    expect(experienceCandidateNeedsReview(item)).toBe(true);
    expect(experienceCandidateNeedsReview({ ...item, status: "validated" })).toBe(true);
    expect(experienceCandidateNeedsReview({
      ...item,
      status: "validated",
      method: {
        preconditions: ["The Agent Host epoch changes"],
        steps: ["Discard stale epoch events"],
        tools: [],
        validationGates: ["No stale Projection remains"],
        completionCriteria: ["The active Session resumes"],
        failureModes: ["An old approval remains visible"],
        rollback: "Restore the previous Host build"
      }
    })).toBe(false);
  });

  it("requires explicit outcome, exclusion boundary, and redaction confirmation", () => {
    const item = candidate();
    const draft = createReviewDraft(item);
    expect(buildExperienceCandidateReview(item, draft)).toBe("请选择并确认真实任务结果。");
    expect(buildExperienceCandidateReview(item, {
      ...draft,
      result: "success",
      confirmOutcome: true,
      confirmRedaction: true
    })).toBe("适用条件和不适用条件都至少需要一项。");
    expect(buildExperienceCandidateReview(item, {
      ...draft,
      result: "success",
      notApplicableWhen: "A normal renderer rerender occurs",
      confirmOutcome: true,
      confirmRedaction: true
    })).toBe("前置条件和关键步骤都至少需要一项。");
  });

  it("builds a version-fenced local review without manufacturing extra evidence", () => {
    const item = candidate();
    const review = buildExperienceCandidateReview(item, {
      ...createReviewDraft(item),
      result: "success",
      confidence: "0.90",
      sensitivity: "team",
      preconditions: "The Agent Host epoch changes",
      steps: "Discard stale epoch events\nRun recovery tests",
      tools: "packaged smoke",
      validationGates: "No stale Projection remains",
      completionCriteria: "The active Session resumes",
      failureModes: "An old approval remains visible",
      rollback: "Restore the previous Host build",
      notApplicableWhen: "A normal renderer rerender occurs",
      confirmOutcome: true,
      confirmRedaction: true
    });
    expect(review).toEqual({
      id: item.id,
      expectedUpdatedAt: item.updatedAt,
      taskType: item.taskType,
      title: item.title,
      problem: item.problem,
      strategy: item.strategy,
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
        rollback: "Restore the previous Host build"
      },
      applicableWhen: ["The Agent Host epoch changes"],
      notApplicableWhen: ["A normal renderer rerender occurs"],
      evidence: [],
      confirmOutcome: true,
      confirmRedaction: true
    });
  });
});

function candidate(): ExperienceCandidateSummary {
  return {
    id: "candidate-1",
    taskType: "electron-recovery",
    title: "Host epoch recovery",
    problem: "Old Host events remain visible",
    strategy: "Discard stale epoch events and run recovery tests",
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
      capturedAt: 1
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
    applicableWhen: ["The Agent Host epoch changes"],
    notApplicableWhen: [],
    evidence: [{
      kind: "artifact",
      label: "Pi JSONL snapshot",
      reference: `sha256:${"a".repeat(64)}`,
      verifiedAt: 1
    }],
    redactionStatus: "pending",
    workspaceId: "workspace-1",
    createdAt: 1,
    updatedAt: 2
  };
}
