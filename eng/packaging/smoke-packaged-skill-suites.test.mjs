import { describe, expect, it } from "vitest";
import { resolveSkillPackSourceCommit } from "./smoke-packaged-skill-suites.mjs";

describe("resolveSkillPackSourceCommit", () => {
  it("reads the exact commit for a uniquely locked Skill Pack", () => {
    expect(resolveSkillPackSourceCommit({
      schema: "pi67.capability-sources-lock.v1",
      skillPacks: [{ name: "suite", commit: "a".repeat(40) }]
    }, "suite")).toBe("a".repeat(40));
  });

  it.each([
    { schema: "invalid", skillPacks: [] },
    { schema: "pi67.capability-sources-lock.v1", skillPacks: [] },
    {
      schema: "pi67.capability-sources-lock.v1",
      skillPacks: [
        { name: "suite", commit: "a".repeat(40) },
        { name: "suite", commit: "b".repeat(40) }
      ]
    },
    {
      schema: "pi67.capability-sources-lock.v1",
      skillPacks: [{ name: "suite", commit: "not-a-commit" }]
    }
  ])("fails closed for an invalid or ambiguous lock", (lock) => {
    expect(() => resolveSkillPackSourceCommit(lock, "suite"))
      .toThrow(/does not (?:contain|uniquely pin)/u);
  });
});
