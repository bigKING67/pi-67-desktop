import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileBundledSkillSuites,
  parseSkillMetadata
} from "./bundled-skill-suites.mjs";
import {
  assertCapabilitiesMetadata,
  assertCapabilitySourceLock
} from "./prepared-capabilities-validation.mjs";
import { assertPi67SkillPackSource } from "./pi67-skill-pack-overlay.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Desktop first-party capability source lock", () => {
  it("pins four first-party repositories, the AI Berkshire Pack source, and recommended externals", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    expect(lock.schema).toBe("pi67.capability-sources-lock.v1");
    expect(lock.catalogVersion).toBe("2026.08.19.1");
    expect(lock.sources.map((source) => source.id)).toEqual([
      "pi67-core",
      "browser67",
      "design-craft",
      "commerce-growth-os"
    ]);
    expect(lock.sources.every((source) => /^[0-9a-f]{40}$/u.test(source.commit))).toBe(true);
    expect(lock.sources.find((source) => source.id === "pi67-core")).toMatchObject({
      commit: "500f3f63a14d80b0297a1dcc04237b5e2cf87894",
      ref: "refs/heads/main",
      includedExtensions: ["pi-rules-loader"]
    });
    expect(lock.sources.find((source) => source.id === "browser67")).toMatchObject({
      version: "0.4.0",
      ref: "refs/heads/main",
      commit: "bb43570f139feafc2632f8da19f34b4863e6bccb"
    });
    expect(lock.skillPacks).toEqual([{
      name: "ai-berkshire-investment-suite",
      adapter: "pi67-ai-berkshire-v1",
      adapterSourceId: "pi67-core",
      repository: "https://github.com/xbtlin/ai-berkshire",
      ref: "refs/heads/main",
      commit: "6fa010f98efb586e643f42c1d2aacdcb1ef3d61f",
      localSibling: "../ai-berkshire",
      version: "1.0.1",
      manifestSha256: "7b5394737d86719be56475494657dae0241adba47fedd7062cfc9ef513f8bc0d",
      bundleSha256: "cb80462d07ff73e6dbe261efccb9465f327131b3230ba811638bb8049bea7997"
    }]);
    expect(() => assertPi67SkillPackSource(lock.skillPacks[0])).not.toThrow();
    expect(lock.managedNpmBundles).toMatchObject([{
      id: "pi-mcp-adapter",
      version: "2.11.0",
      extensionPaths: ["index.ts"],
      defaultEnabled: true
    }, {
      id: "pi-observational-memory",
      version: "3.0.3",
      extensionPaths: ["src/index.ts"],
      defaultEnabled: true
    }]);
    expect(lock.managedNpmBundles.every((entry) => entry.packageIntegrity.startsWith("sha512-"))).toBe(true);
    expect(lock.recommendedExternal.map((entry) => entry.id)).toEqual(["pi-rewind"]);
    expect(lock.recommendedExternal.every((entry) => (
      entry.installPolicy === "prompt-once" || entry.installPolicy === "user-initiated"
    ))).toBe(true);
    expect(() => assertCapabilitySourceLock(lock)).not.toThrow();
  });

  it("rejects an implicit or unordered Pi-67 Core Extension selection", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    const coreIndex = lock.sources.findIndex((source) => source.id === "pi67-core");
    const withoutSelection = structuredClone(lock);
    delete withoutSelection.sources[coreIndex].includedExtensions;
    expect(() => assertCapabilitySourceLock(withoutSelection)).toThrow(/bundled Extension selection/u);

    const unordered = structuredClone(lock);
    unordered.sources[coreIndex].includedExtensions = ["pi-rules-loader", "pi-rules-loader"];
    expect(() => assertCapabilitySourceLock(unordered)).toThrow(/bundled Extension selection/u);
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

  it("rejects malformed first-party tracked branch refs", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    lock.sources[0].ref = "refs/heads/../main";
    expect(() => assertCapabilitySourceLock(lock)).toThrow(/invalid tracked branch ref/u);
  });

  it("rejects prepared capability metadata that drifts from locked sources", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    const generatedFrom = lock.sources.map((source) => ({ ...source }));
    const entries = lock.sources.map((source) => ({
      ...source,
      packagePath: `packages/${source.id}`,
      bundledExtensions: (source.includedExtensions ?? []).map((id) => ({ id, displayName: id }))
    }));
    const packages = lock.sources.map((source) => ({
      id: source.id,
      treeSha256: "a".repeat(64)
    }));
    const catalog = {
      schema: "pi67.capability-catalog.v1",
      catalogVersion: lock.catalogVersion,
      generatedFrom,
      entries,
      managedNpmBundles: lock.managedNpmBundles.map((entry) => ({
        id: entry.id,
        packageName: entry.packageName,
        source: entry.source,
        version: entry.version,
        packageIntegrity: entry.packageIntegrity,
        packagePath: `packages/${entry.id}`,
        extensionPaths: entry.extensionPaths,
        defaultEnabled: entry.defaultEnabled
      })),
      recommendedExternal: lock.recommendedExternal
    };
    const manifest = {
      schema: "pi67.desktop-capabilities.v1",
      catalogVersion: lock.catalogVersion,
      packages,
      managedNpmBundle: {
        treeSha256: "b".repeat(64),
        platform: process.platform,
        architecture: process.arch
      }
    };

    expect(() => assertCapabilitiesMetadata(lock, catalog, manifest)).not.toThrow();
    expect(() => assertCapabilitiesMetadata(lock, {
      ...catalog,
      entries: entries.map((entry, index) => index === 0 ? { ...entry, commit: "0".repeat(40) } : entry)
    }, manifest)).toThrow(/metadata is stale/u);
    expect(() => assertCapabilitiesMetadata(lock, {
      ...catalog,
      entries: entries.map((entry, index) => index === 0
        ? {
            ...entry,
            bundledExtensions: [
              ...entry.bundledExtensions,
              { id: "pi-hy-memory", displayName: "pi-hy-memory" }
            ]
          }
        : entry)
    }, manifest)).toThrow(/metadata is stale/u);
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
