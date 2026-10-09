import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_TASK_BUDGET,
  formatImagePromptContext,
  imageBudgetDecision,
  imageCandidateActions,
  imageEditSubmission,
  imageEngineFailure,
  imagePreviewRelativePath,
  imageProjectRelativePath,
  isImageId,
  isTerminalImageJobState,
  type ImageCandidateListStatus,
  type ImagePromptContext
} from "./image-workbench.js";

describe("image workbench policy", () => {
  it("accepts engine identifiers only", () => {
    expect(isImageId("spring-poster_2")).toBe(true);
    expect(isImageId("x".repeat(64))).toBe(true);
    for (const value of ["", "2poster", "-a", "a b", "a/b", "x".repeat(65), 7, undefined]) expect(isImageId(value)).toBe(false);
  });

  it("never offers acceptance of stale, decided or unreadable candidates", () => {
    const table: Record<ImageCandidateListStatus, string> = {
      ready: "accept discard compare", stale: "discard compare restage", accepted: "compare", discarded: "compare",
      decision_pending: "compare unlock", incomplete: "", unreadable: ""
    };
    for (const [status, expected] of Object.entries(table) as [ImageCandidateListStatus, string][]) {
      const actions = imageCandidateActions(status);
      expect(Object.entries(actions).filter(([, allowed]) => allowed).map(([name]) => name).join(" ")).toBe(expected);
    }
  });

  it("classifies engine refusals into typed failures", () => {
    const cases: [string, string][] = [
      ["Revision conflict: expected 3, received 2", "revision_conflict"],
      ["Provider base revision conflict", "revision_conflict"],
      ["Candidate base revision conflict: re-read and restage explicitly", "revision_conflict"],
      ["Revision changed during rendering", "revision_conflict"],
      ["Object is locked: logo", "locked"], ["Revert would change locked object: product", "locked"], ["Cannot reorder a locked object", "locked"],
      ["Text overflow: headline", "text_overflow"], ["Text box narrower than glyph: price", "text_overflow"],
      ["Missing font glyphs: U+10FFFF", "missing_glyph"],
      ["Canvas pixel limit exceeded", "limit_exceeded"], ["Revision limit reached (1000)", "limit_exceeded"],
      ["Candidate already accepted", "candidate_decided"], ["Candidate already discarded", "candidate_decided"], ["Candidate is discarded", "candidate_decided"],
      ["Candidate decision in progress; inspect before recovery", "decision_pending"],
      ["ENOENT: no such file", "not_found"], ["Unknown object: ghost", "not_found"], ["Incomplete project: no saved revision", "not_found"],
      ["Invalid object.x", "invalid"]
    ];
    for (const [message, failure] of cases) expect(imageEngineFailure(message), message).toBe(failure);
  });

  it("never submits an edit computed against an older revision", () => {
    expect(imageEditSubmission(4, 4)).toBe("submit");
    expect(imageEditSubmission(3, 4)).toBe("refresh-first");
  });

  it("places library projects at the library root and workspace projects in one hidden folder", () => {
    expect(imageProjectRelativePath("library", "poster")).toEqual(["poster"]);
    expect(imageProjectRelativePath("workspace", "poster")).toEqual([".newmoney", "images", "poster"]);
    expect(() => imageProjectRelativePath("library", "../escape")).toThrow(/Invalid image project id/);
  });

  it("names previews by project and digest only", () => {
    expect(imagePreviewRelativePath("poster", "a".repeat(64))).toEqual([".newmoney", "image-work", "poster", "previews", `${"a".repeat(64)}.png`]);
    for (const [project, sha] of [["../x", "a".repeat(64)], ["poster", "A".repeat(64)], ["poster", "a".repeat(63)], ["poster", "../../etc"]]) {
      expect(() => imagePreviewRelativePath(project ?? "", sha ?? "")).toThrow(/Invalid image preview reference/);
    }
  });

  it("recognises terminal job states", () => {
    expect(["queued", "running"].map((state) => isTerminalImageJobState(state as "queued"))).toEqual([false, false]);
    expect(["completed", "failed", "cancelled"].map((state) => isTerminalImageJobState(state as "completed"))).toEqual([true, true, true]);
  });

  it("proceeds within the task budget and asks once beyond it", () => {
    const budget = DEFAULT_IMAGE_TASK_BUDGET, none = { draftCandidates: 0, finals: 0, rounds: 0 };
    expect(imageBudgetDecision(budget, none, { stage: "draft", count: 4, quality: "low" })).toBe("proceed");
    expect(imageBudgetDecision(budget, none, { stage: "draft", count: 5, quality: "low" })).toBe("ask");
    expect(imageBudgetDecision(budget, { ...none, draftCandidates: 3 }, { stage: "draft", count: 2, quality: "low" })).toBe("ask");
    expect(imageBudgetDecision(budget, none, { stage: "draft", count: 1, quality: "medium" })).toBe("ask");
    expect(imageBudgetDecision(budget, none, { stage: "final", count: 1, quality: "high" })).toBe("proceed");
    expect(imageBudgetDecision(budget, { ...none, finals: 1 }, { stage: "final", count: 1, quality: "medium" })).toBe("ask");
    expect(imageBudgetDecision({ ...budget, finalQuality: "medium" }, none, { stage: "final", count: 1, quality: "high" })).toBe("ask");
    expect(imageBudgetDecision(budget, { ...none, rounds: 3 }, { stage: "draft", count: 1, quality: "low" })).toBe("ask");
    for (const count of [0, 1.5, -1]) expect(imageBudgetDecision(budget, none, { stage: "draft", count, quality: "low" })).toBe("ask");
  });

  describe("prompt context", () => {
    const base: ImagePromptContext = { projectId: "poster", revision: 3, selectedObjectIds: [], marks: [], references: [] };

    it("renders a stable block with selections, marks and reference roles", () => {
      expect(formatImagePromptContext({
        ...base,
        selectedObjectIds: ["headline", "price", "bad id"],
        marks: [{ id: "m1", x: 10, y: 20, width: 30, height: 40, instruction: "  去掉\n左上角装饰\t " }],
        references: [{ assetId: "style", role: "keep-style" }, { assetId: "bottle", role: "keep-subject" }, { assetId: "layout", role: "take-composition" }]
      })).toBe([
        "<image-context>", "project: poster", "revision: 3", "selected: headline, price",
        "mark m1 [x=10 y=20 w=30 h=40]: 去掉 左上角装饰",
        "reference style: 保留风格", "reference bottle: 保留主体", "reference layout: 取构图", "</image-context>"
      ].join("\n"));
    });

    it("omits empty sections and drops malformed marks or references", () => {
      expect(formatImagePromptContext({
        ...base,
        marks: [{ id: "m1", x: -1, y: 0, width: 1, height: 1, instruction: "x" }, { id: "bad id", x: 0, y: 0, width: 1, height: 1, instruction: "x" }, { id: "m3", x: 0.5, y: 0, width: 1, height: 1, instruction: "x" }],
        references: [{ assetId: "../x", role: "keep-style" }]
      })).toBe("<image-context>\nproject: poster\nrevision: 3\n</image-context>");
    });

    it("bounds instructions and refuses invalid identity or oversized context", () => {
      const long = formatImagePromptContext({ ...base, marks: [{ id: "m1", x: 0, y: 0, width: 1, height: 1, instruction: "长".repeat(900) }] });
      expect(long.split("\n")[3]?.length).toBe("mark m1 [x=0 y=0 w=1 h=1]: ".length + 500);
      expect(() => formatImagePromptContext({ ...base, projectId: "../x" })).toThrow(/Invalid image prompt context/);
      expect(() => formatImagePromptContext({ ...base, revision: 0 })).toThrow(/Invalid image prompt context/);
      expect(() => formatImagePromptContext({ ...base, selectedObjectIds: Array.from({ length: 33 }, (_, i) => `o${i}`) })).toThrow(/limits/);
      expect(() => formatImagePromptContext({ ...base, marks: Array.from({ length: 17 }, (_, i) => ({ id: `m${i}`, x: 0, y: 0, width: 1, height: 1, instruction: "x" })) })).toThrow(/limits/);
      expect(() => formatImagePromptContext({ ...base, references: Array.from({ length: 4 }, () => ({ assetId: "a", role: "keep-style" as const })) })).toThrow(/limits/);
    });
  });
});
