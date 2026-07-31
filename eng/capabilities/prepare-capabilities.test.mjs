import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileBundledSkillSuites,
  parseSkillMetadata
} from "./bundled-skill-suites.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Desktop first-party capability source lock", () => {
  it("pins four first-party repositories and the recommended external package set", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    expect(lock.schema).toBe("pi67.capability-sources-lock.v1");
    expect(lock.catalogVersion).toBe("2026.07.31.2");
    expect(lock.sources.map((source) => source.id)).toEqual([
      "pi67-core",
      "browser67",
      "design-craft",
      "commerce-growth-os"
    ]);
    expect(lock.sources.every((source) => /^[0-9a-f]{40}$/u.test(source.commit))).toBe(true);
    expect(lock.recommendedExternal.map((entry) => entry.id)).toEqual([
      "pi-subagents",
      "pi-observational-memory",
      "pi-fff",
      "pi-web-access",
      "pi-smart-fetch",
      "pi-plan-mode",
      "pi-rewind",
      "pi-mcp-adapter"
    ]);
  });

  it("declares five explicit suites covering all 66 bundled Skill identities", async () => {
    const definition = JSON.parse(await readFile(
      resolve(root, "eng/capabilities/bundled-skill-suites.json"),
      "utf8"
    ));
    expect(definition.schema).toBe("pi67.bundled-skill-suites.v1");
    expect(definition.suites.map((suite) => suite.id)).toEqual([
      "lark-cli",
      "ai-berkshire-investment-suite",
      "commerce-growth-os",
      "browser67",
      "design-output-tools"
    ]);
    expect(definition.suites.map((suite) => suite.members.length)).toEqual([27, 21, 8, 3, 7]);
    expect(definition.suites.flatMap((suite) => suite.members)).toHaveLength(66);
  });

  it("extracts bounded single-line and folded Skill descriptions", () => {
    expect(parseSkillMetadata([
      "---",
      "name: browser67",
      "description: >-",
      "  Controls managed browsers,",
      "  screenshots, and downloads.",
      "---"
    ].join("\n"))).toEqual({
      name: "browser67",
      description: "Controls managed browsers, screenshots, and downloads."
    });
    expect(parseSkillMetadata([
      "---",
      "name: lark-doc",
      "description: \"读取和编辑飞书文档。\"",
      "---"
    ].join("\n"))).toEqual({ name: "lark-doc", description: "读取和编辑飞书文档。" });
  });

  it("rejects missing or duplicated suite membership", () => {
    const entries = [{
      id: "core",
      bundledSkills: [
        { id: "one", displayName: "one", description: "One" },
        { id: "two", displayName: "two", description: "Two" }
      ]
    }];
    const suite = (members) => ({
      schema: "pi67.bundled-skill-suites.v1",
      suites: [{ id: "core", displayName: "Core", description: "Core skills", members }]
    });
    expect(() => compileBundledSkillSuites(suite([
      { packageId: "core", skillId: "one" }
    ]), entries)).toThrow(/missing suite membership/u);
    expect(() => compileBundledSkillSuites(suite([
      { packageId: "core", skillId: "one" },
      { packageId: "core", skillId: "one" }
    ]), entries)).toThrow(/duplicated/u);
  });
});
