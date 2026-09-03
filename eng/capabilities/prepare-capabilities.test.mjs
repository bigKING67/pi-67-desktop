import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileBundledSkillSuites,
  parseSkillMetadata
} from "./bundled-skill-suites.mjs";
import {
  assertCapabilitiesMetadata,
  assertCapabilitySourceLock,
  treeSha256
} from "./prepared-capabilities-validation.mjs";
import { assertPi67SkillPackSource } from "./pi67-skill-pack-overlay.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("Desktop first-party capability source lock", () => {
  it("excludes only reinstallable node_modules from internal source hashes", async () => {
    const source = await mkdtemp(join(tmpdir(), "pi67-capability-source-hash-"));
    try {
      await writeFile(join(source, "index.ts"), "export {};\n", "utf8");
      const before = await treeSha256(source, { includeNodeModules: false });
      await mkdir(join(source, "node_modules", "dependency"), { recursive: true });
      await writeFile(join(source, "node_modules", "dependency", "index.js"), "export {};\n", "utf8");
      expect(await treeSha256(source, { includeNodeModules: false })).toBe(before);
      expect(await treeSha256(source)).not.toBe(before);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("pins two Desktop-internal packages, three first-party repositories, the AI Berkshire Pack source, and recommended externals", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    expect(lock.schema).toBe("pi67.capability-sources-lock.v1");
    expect(lock.catalogVersion).toBe("2026.09.03.1");
    expect(lock.sources.map((source) => source.id)).toEqual([
      "pi-workspace-resources",
      "openviking-pi-extension",
      "browser67",
      "design-craft",
      "commerce-growth-os"
    ]);
    expect(lock.sources.filter((source) => source.repository).every((source) => /^[0-9a-f]{40}$/u.test(source.commit))).toBe(true);
    expect(lock.sources.find((source) => source.id === "pi-workspace-resources")).toMatchObject({
      internalPath: "packages/pi-workspace-resources",
      treeSha256: "c0efa86f09d805a1e2310e4e7347bcdbbc81c440fca4b01aa99823c0a712702d",
      includedExtensions: [{
        id: "pi-rules-loader",
        displayName: "工作规则加载器",
        description: "根据当前任务自动匹配并加载已配置的工作规则。"
      }]
    });
    const workspaceSourceManifest = JSON.parse(await readFile(
      resolve(root, "packages/pi-workspace-resources/package.json"),
      "utf8"
    ));
    expect(workspaceSourceManifest.desktopMigration).toEqual({
      legacyRulesLoaderTreeSha256: "92f8bdb0332b8812f1844284d555ec281dcd3d00c3cf49990989b19b78707a84"
    });
    expect(lock.sources.find((source) => source.id === "openviking-pi-extension")).toMatchObject({
      internalPath: "packages/openviking-pi-extension",
      treeSha256: "b7812bb14c5baa455909a0a81cda1ea2662f9eaba9fb9568835e8e5f98ef3743",
      version: "0.2.0-desktop.2",
      includedExtensions: [{ id: "pi67-openviking" }]
    });
    expect(lock.sources.find((source) => source.id === "browser67")).toMatchObject({
      version: "0.8.0",
      ref: "refs/heads/main",
      commit: "c9d45ae020ca502390b4b4838d924ace0d8e60d7"
    });
    expect(lock.skillPacks).toHaveLength(1);
    expect(lock.skillPacks[0]).toMatchObject({
      name: "ai-berkshire-investment-suite",
      adapter: "desktop-ai-berkshire-v1",
      adapterSourceId: "pi-workspace-resources",
      repository: "https://github.com/xbtlin/ai-berkshire",
      ref: "refs/heads/main",
      commit: "fd83d06347c6e3ee50133cda6962f40e226b5252",
      localSibling: "../ai-berkshire",
      version: "1.1.1",
      manifestSha256: "2db432f23f09146ef5ffcfdd5615ce2643637f592f3f3d90e30531fa65c87ac6",
      bundleSha256: "65e12e1320560fb9f707665729ff58a9941c0ebd324202ec9dbe67cdc1baa04c"
    });
    expect(lock.skillPacks[0].skills).toHaveLength(22);
    expect(lock.skillPacks[0].skills.map((skill) => skill.name)).toEqual([
      "bottleneck-hunter",
      "deep-company-series",
      "dyp-ask",
      "earnings-review",
      "earnings-team",
      "era-alpha",
      "financial-data",
      "income-investment",
      "industry-funnel",
      "industry-research",
      "investment-checklist",
      "investment-memo-craft",
      "investment-research",
      "investment-team",
      "management-deep-dive",
      "news-pulse",
      "portfolio-review",
      "private-company-research",
      "quality-screen",
      "thesis-drift",
      "thesis-tracker",
      "wechat-article"
    ]);
    expect(lock.skillPacks[0].skills.every((skill) => /^[0-9a-f]{64}$/u.test(skill.sha256))).toBe(true);
    expect(() => assertPi67SkillPackSource(lock.skillPacks[0])).not.toThrow();
    expect(lock.managedNpmBundles).toMatchObject([{
      id: "pi-mcp-adapter",
      version: "2.11.0",
      extensionPaths: ["index.ts"],
      defaultEnabled: true
    }]);
    expect(lock.managedNpmBundles.every((entry) => entry.packageIntegrity.startsWith("sha512-"))).toBe(true);
    expect(lock.recommendedExternal.map((entry) => entry.id)).toEqual(["pi-rewind"]);
    expect(lock.recommendedExternal.every((entry) => (
      entry.installPolicy === "prompt-once" || entry.installPolicy === "user-initiated"
    ))).toBe(true);
    expect(() => assertCapabilitySourceLock(lock)).not.toThrow();
  });

  it("rejects an implicit or unordered Desktop Extension selection", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    const coreIndex = lock.sources.findIndex((source) => source.id === "pi-workspace-resources");
    const withoutSelection = structuredClone(lock);
    delete withoutSelection.sources[coreIndex].includedExtensions;
    expect(() => assertCapabilitySourceLock(withoutSelection)).toThrow(/bundled Extension selection/u);

    const unordered = structuredClone(lock);
    unordered.sources[coreIndex].includedExtensions = [
      ...unordered.sources[coreIndex].includedExtensions,
      ...unordered.sources[coreIndex].includedExtensions
    ];
    expect(() => assertCapabilitySourceLock(unordered)).toThrow(/bundled Extension selection/u);

    const incompleteMetadata = structuredClone(lock);
    delete incompleteMetadata.sources[coreIndex].includedExtensions[0].description;
    expect(() => assertCapabilitySourceLock(incompleteMetadata)).toThrow(/bundled Extension selection/u);
  });

  it("rejects a branch-tracked Skill Pack without immutable generated hashes", () => {
    expect(() => assertPi67SkillPackSource({
      name: "ai-berkshire-investment-suite",
      adapter: "desktop-ai-berkshire-v1",
      adapterSourceId: "pi-workspace-resources",
      repository: "https://github.com/xbtlin/ai-berkshire",
      ref: "refs/heads/main",
      commit: "1".repeat(40),
      version: "1.0.1",
      manifestSha256: "invalid",
      bundleSha256: "2".repeat(64)
    })).toThrow(/source is invalid/u);
  });

  it("rejects an incomplete or unordered Skill Pack member baseline", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    const missing = structuredClone(lock.skillPacks[0]);
    delete missing.skills;
    expect(() => assertPi67SkillPackSource(missing)).toThrow(/source is invalid/u);

    const unordered = structuredClone(lock.skillPacks[0]);
    unordered.skills.reverse();
    expect(() => assertPi67SkillPackSource(unordered)).toThrow(/source is invalid/u);
  });

  it("rejects malformed first-party tracked branch refs", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    lock.sources.find((source) => source.id === "browser67").ref = "refs/heads/../main";
    expect(() => assertCapabilitySourceLock(lock)).toThrow(/invalid tracked branch ref/u);
  });

  it("rejects prepared capability metadata that drifts from locked sources", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    const sourceProvenance = (source) => source.internalPath === undefined
      ? { repository: source.repository, commit: source.commit }
      : { internalPath: source.internalPath, sourceTreeSha256: source.treeSha256 };
    const generatedFrom = lock.sources.map((source) => ({
      id: source.id,
      version: source.version,
      ...sourceProvenance(source)
    }));
    const entries = lock.sources.map((source) => ({
      id: source.id,
      version: source.version,
      ...sourceProvenance(source),
      packagePath: `packages/${source.id}`,
      bundledExtensions: source.includedExtensions ?? []
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
      entries: entries.map((entry, index) => index === 0
        ? { ...entry, sourceTreeSha256: "0".repeat(64) }
        : entry)
    }, manifest)).toThrow(/metadata is stale/u);
    expect(() => assertCapabilitiesMetadata(lock, {
      ...catalog,
      entries: entries.map((entry, index) => index === 0
        ? {
            ...entry,
            bundledExtensions: [
              ...entry.bundledExtensions,
              { id: "example-extension", displayName: "Example", description: "Extension fixture." }
            ]
          }
        : entry)
    }, manifest)).toThrow(/metadata is stale/u);
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
    expect(definition.suites.map((suite) => suite.members.length)).toEqual([27, 22, 8, 2, 7]);
    expect(definition.suites.flatMap((suite) => suite.members)).toHaveLength(66);
    expect(definition.suites.find((suite) => suite.id === "ai-berkshire-investment-suite")).toMatchObject({
      versionSource: { kind: "pi67-skill-pack", packName: "ai-berkshire-investment-suite" },
      upstream: "https://github.com/xbtlin/ai-berkshire",
      updatePolicy: "capability-package",
      updateManager: "desktop-capability",
      independentUpdateState: "not-applicable"
    });
    expect(definition.suites.find((suite) => suite.id === "ai-berkshire-investment-suite")?.members)
      .toContainEqual({ packageId: "pi-workspace-resources", skillId: "era-alpha" });
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
        updatePolicy: "capability-package",
        updateManager: "desktop-capability",
        independentUpdateState: "not-applicable",
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
