import { describe, expect, it } from "vitest";
import { resolveSkillPackSource } from "./smoke-packaged-skill-suites.mjs";

describe("resolveSkillPackSource", () => {
  it("reads the exact version and commit for a uniquely locked Skill Pack", () => {
    expect(resolveSkillPackSource({
      schema: "pi67.capability-sources-lock.v1",
      skillPacks: [{ name: "suite", version: "1.2.3", commit: "a".repeat(40) }]
    }, "suite")).toEqual({ version: "1.2.3", commit: "a".repeat(40) });
  });

  it.each([
    { schema: "invalid", skillPacks: [] },
    { schema: "pi67.capability-sources-lock.v1", skillPacks: [] },
    {
      schema: "pi67.capability-sources-lock.v1",
      skillPacks: [
        { name: "suite", version: "1.2.3", commit: "a".repeat(40) },
        { name: "suite", version: "1.2.3", commit: "b".repeat(40) }
      ]
    },
    {
      schema: "pi67.capability-sources-lock.v1",
      skillPacks: [{ name: "suite", version: "1.2.3", commit: "not-a-commit" }]
    },
    {
      schema: "pi67.capability-sources-lock.v1",
      skillPacks: [{ name: "suite", version: "latest", commit: "a".repeat(40) }]
    }
  ])("fails closed for an invalid or ambiguous lock", (lock) => {
    expect(() => resolveSkillPackSource(lock, "suite"))
      .toThrow(/does not (?:contain|uniquely pin)/u);
  });
});
