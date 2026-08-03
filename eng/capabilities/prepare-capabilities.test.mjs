import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileBundledSkillSuites,
  parseSkillMetadata
} from "./bundled-skill-suites.mjs";
import { assertPi67SkillPackSource } from "./pi67-skill-pack-overlay.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Desktop first-party capability source lock", () => {
  it("pins four first-party repositories, the AI Berkshire Pack source, and recommended externals", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    expect(lock.schema).toBe("pi67.capability-sources-lock.v1");
    expect(lock.catalogVersion).toBe("2026.08.03.2");
    expect(lock.sources.map((source) => source.id)).toEqual([
      "pi67-core",
      "browser67",
      "design-craft",
      "commerce-growth-os"
    ]);
    expect(lock.sources.every((source) => /^[0-9a-f]{40}$/u.test(source.commit))).toBe(true);
    expect(lock.sources.find((source) => source.id === "browser67")).toMatchObject({
      version: "0.4.0",
      commit: "eb857d335660380a383490f549c4d40227dbf3dc"
    });
    expect(lock.skillPacks).toEqual([{
      name: "ai-berkshire-investment-suite",
      adapter: "pi67-ai-berkshire-v1",
      adapterSourceId: "pi67-core",
      repository: "https://github.com/xbtlin/ai-berkshire",
      ref: "refs/heads/main",
      commit: "66e556262d6486a9819286252e5c9f90a4cfa386",
      localSibling: "../ai-berkshire",
      version: "1.0.1",
      manifestSha256: "ce79fbc1c20d8da9e6a3171dc267df50470fe89c52db577ff441c8c582556ab0",
      bundleSha256: "7438834d7e26b0043332c886503cfdf45ac3dab5d1e46def95ce2b899f08d018"
    }]);
    expect(() => assertPi67SkillPackSource(lock.skillPacks[0])).not.toThrow();
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

  it("rejects a branch-tracked Skill Pack without immutable generated hashes", () => {
    expect(() => assertPi67SkillPackSource({
      name: "ai-berkshire-investment-suite",
      adapter: "pi67-ai-berkshire-v1",
      adapterSourceId: "pi67-core",
      repository: "https://github.com/xbtlin/ai-berkshire",
      ref: "refs/heads/main",
      commit: "1".repeat(40),
      version: "1.0.1",
      manifestSha256: "invalid",
      bundleSha256: "2".repeat(64)
    })).toThrow(/source is invalid/u);
  });

  it("declares five explicit suites covering all 65 bundled Skill identities", async () => {
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
    expect(definition.suites.map((suite) => suite.members.length)).toEqual([27, 21, 8, 2, 7]);
    expect(definition.suites.flatMap((suite) => suite.members)).toHaveLength(65);
    expect(definition.suites.find((suite) => suite.id === "ai-berkshire-investment-suite")).toMatchObject({
      versionSource: { kind: "pi67-skill-pack", packName: "ai-berkshire-investment-suite" },
      upstream: "https://github.com/xbtlin/ai-berkshire",
      updatePolicy: "hybrid",
      updateManager: "pi67-skill-pack-registry",
      independentUpdateState: "available"
    });
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
      suites: [{
        id: "core",
        displayName: "Core",
        description: "Core skills",
        versionSource: { kind: "unversioned" },
        updatePolicy: "source-specific",
        updateManager: "source-specific",
        independentUpdateState: "not-applicable",
        members
      }]
    });
    expect(() => compileBundledSkillSuites(suite([
      { packageId: "core", skillId: "one" }
    ]), entries)).toThrow(/missing suite membership/u);
    expect(() => compileBundledSkillSuites(suite([
      { packageId: "core", skillId: "one" },
      { packageId: "core", skillId: "one" }
    ]), entries)).toThrow(/duplicated/u);
  });

  it("resolves suite versions from capability packages and pi-67 Skill Pack provenance", () => {
    const entries = [{
      id: "core",
      version: "0.15.8",
      repository: "https://github.com/example/core",
      commit: "1".repeat(40),
      bundledSkills: [{ id: "one", displayName: "one", description: "One" }]
    }, {
      id: "browser",
      version: "0.4.0",
      repository: "https://github.com/example/browser",
      commit: "2".repeat(40),
      bundledSkills: [{ id: "two", displayName: "two", description: "Two" }]
    }];
    const definition = {
      schema: "pi67.bundled-skill-suites.v1",
      suites: [{
        id: "pack",
        displayName: "Pack",
        description: "Pack skills",
        versionSource: { kind: "pi67-skill-pack", packName: "pack" },
        upstream: "https://github.com/example/pack",
        updatePolicy: "hybrid",
        updateManager: "pi67-skill-pack-registry",
        independentUpdateState: "planned",
        members: [{ packageId: "core", skillId: "one" }]
      }, {
        id: "browser",
        displayName: "Browser",
        description: "Browser skills",
        versionSource: { kind: "capability-package", packageId: "browser" },
        updatePolicy: "capability-package",
        updateManager: "desktop-capability",
        independentUpdateState: "not-applicable",
        members: [{ packageId: "browser", skillId: "two" }]
      }]
    };
    expect(compileBundledSkillSuites(definition, entries, {
      skillPacks: [{
        name: "pack",
        version: "1.0.0",
        sourceCommit: "3".repeat(40)
      }]
    })).toMatchObject([{
      id: "pack",
      versionSource: "skill-pack",
      bundledVersion: "1.0.0",
      upstream: "https://github.com/example/pack",
      sourceCommit: "3".repeat(40)
    }, {
      id: "browser",
      versionSource: "capability-package",
      bundledVersion: "0.4.0",
      upstream: "https://github.com/example/browser",
      sourceCommit: "2".repeat(40)
    }]);
  });
});
