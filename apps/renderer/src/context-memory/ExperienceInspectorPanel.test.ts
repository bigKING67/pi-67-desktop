import type { ExperienceCandidateSummary } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  buildExperienceCandidateReview,
  createReviewDraft
} from "./ExperienceInspectorPanel.js";

describe("Experience Inspector review model", () => {
  it("never pre-confirms an extracted candidate", () => {
    expect(createReviewDraft(candidate())).toMatchObject({
      result: "",
      confirmOutcome: false,
      confirmRedaction: false,
      sensitivity: "project"
    });
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
  });

  it("builds a version-fenced local review without manufacturing extra evidence", () => {
    const item = candidate();
    const review = buildExperienceCandidateReview(item, {
      ...createReviewDraft(item),
      result: "success",
      confidence: "0.90",
      sensitivity: "team",
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
