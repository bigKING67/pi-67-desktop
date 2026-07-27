import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTarball } from "./extension-adapter-provenance-fixture.mjs";
import {
  extractStaticExtensionSurfaces,
  resolveRepositoryPackageRoot,
  verifyExtensionAdapterPublishedArtifacts,
  verifyPackageIntegrity,
  verifyRegistryMetadata
} from "./extension-adapter-provenance.mjs";

const PACKAGE_NAME = "@verified/example";
const PACKAGE_VERSION = "1.4.2";
const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SOURCE_REPOSITORY = "https://github.com/verified/example";
const PACKAGE_ROOT = "packages/example";

describe("Extension Adapter published artifact provenance", () => {
  it("verifies an npm tarball against the exact monorepo package and static surfaces", async () => {
    const fixture = publishedFixture();

    const report = await verifyExtensionAdapterPublishedArtifacts(fixture.record, fixture.artifacts);

    expect(report).toMatchObject({
      adapterId: "verified-example-1.4.2",
      package: PACKAGE_NAME,
      installedVersion: PACKAGE_VERSION,
      packageRoot: PACKAGE_ROOT,
      commands: ["inspect"],
      tools: ["read_artifact"]
    });
    expect(report.verifiedSources).toHaveLength(2);
    expect(report.verifiedSources.every((source) => /^[a-f0-9]{64}$/u.test(source.sha256))).toBe(true);
  });

  it("rejects package bytes that do not match the pinned sha512 integrity", () => {
    const fixture = publishedFixture();

    expect(() => verifyPackageIntegrity("sha512-invalid", fixture.artifacts.tarballBytes))
      .toThrow(/sha512 integrity mismatch/u);
  });

  it.each([
    ["identity", { name: "@verified/other" }, /identity mismatch/u],
    ["license", { license: "Apache-2.0" }, /license mismatch/u],
    ["gitHead", { gitHead: "f".repeat(40) }, /gitHead mismatch/u],
    ["repository", { repository: "git+https://github.com/verified/other.git" }, /repository mismatch/u],
    ["integrity", { dist: { integrity: "sha512-other", tarball: npmTarballUrl() } }, /integrity metadata mismatch/u]
  ])("rejects npm registry %s drift", (_label, override, expected) => {
    const fixture = publishedFixture();
    const metadata = { ...fixture.artifacts.metadata, ...override };

    expect(() => verifyRegistryMetadata(fixture.record.evidence, metadata)).toThrow(expected);
  });

  it("rejects npm source bytes that differ from the source commit", async () => {
    const fixture = publishedFixture({ repositorySourceOverride: "export const changed = true;\n" });

    await expect(verifyExtensionAdapterPublishedArtifacts(fixture.record, fixture.artifacts))
      .rejects.toThrow(/bytes differ/u);
  });

  it("rejects undeclared or missing static command and tool surfaces", async () => {
    const fixture = publishedFixture();
    const record = {
      ...fixture.record,
      evidence: { ...fixture.record.evidence, tools: [] }
    };

    await expect(verifyExtensionAdapterPublishedArtifacts(record, fixture.artifacts))
      .rejects.toThrow(/static tools mismatch/u);
  });

  it("extracts supported command and tool registrations and rejects invalid TypeScript", () => {
    expect(extractStaticExtensionSurfaces([
      "pi.registerCommand('inspect', {});",
      "pi.registerTool({ name: `direct_tool` }); defineTool({ name: 'defined_tool' }); "
        + "definePortableTool({ 'name': 'portable_tool' });"
    ])).toEqual({
      commands: ["inspect"],
      tools: ["defined_tool", "direct_tool", "portable_tool"]
    });
    expect(() => extractStaticExtensionSurfaces(["const broken: = ;"]))
      .toThrow(/syntax errors/u);
  });

  it("locates a matching monorepo package root and rejects cross-root evidence", async () => {
    const fixture = publishedFixture();
    await expect(resolveRepositoryPackageRoot(
      fixture.record.evidence,
      fixture.artifacts.readRepositoryFile
    )).resolves.toBe(PACKAGE_ROOT);

    await expect(resolveRepositoryPackageRoot({
      ...fixture.record.evidence,
      sourcePaths: [`${PACKAGE_ROOT}/src/index.ts`, "other/outside.ts"]
    }, fixture.artifacts.readRepositoryFile)).rejects.toThrow(/cannot locate/u);
  });

  it("rejects non-canonical registry URLs", () => {
    const fixture = publishedFixture();
    const metadata = {
      ...fixture.artifacts.metadata,
      dist: {
        ...fixture.artifacts.metadata.dist,
        tarball: `${npmTarballUrl()}?token=unexpected`
      }
    };

    expect(() => verifyRegistryMetadata(fixture.record.evidence, metadata)).toThrow(/canonical HTTPS URL/u);
  });
});

function publishedFixture(options = {}) {
  const packageJson = `${JSON.stringify({ name: PACKAGE_NAME, version: PACKAGE_VERSION }, null, 2)}\n`;
  const indexSource = "pi.registerCommand('inspect', { description: 'Inspect' });\n";
  const toolSource = "export const tool = defineTool({ name: 'read_artifact' });\n";
  const tarballBytes = createTarball([
    file("package/package.json", packageJson),
    file("package/src/index.ts", indexSource),
    file("package/src/tools.ts", toolSource)
  ]);
  const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  const repositoryFiles = new Map([
    [`${PACKAGE_ROOT}/package.json`, Buffer.from(packageJson)],
    [`${PACKAGE_ROOT}/src/index.ts`, Buffer.from(options.repositorySourceOverride ?? indexSource)],
    [`${PACKAGE_ROOT}/src/tools.ts`, Buffer.from(toolSource)]
  ]);
  const evidence = {
    schemaVersion: 2,
    adapterId: "verified-example-1.4.2",
    package: PACKAGE_NAME,
    installedVersion: PACKAGE_VERSION,
    packageIntegrity: integrity,
    license: "MIT",
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: SOURCE_COMMIT,
    sourcePaths: [`${PACKAGE_ROOT}/src/index.ts`, `${PACKAGE_ROOT}/src/tools.ts`],
    commands: ["inspect"],
    tools: ["read_artifact"]
  };
  return {
    record: { manifest: {}, evidence },
    artifacts: {
      metadata: {
        name: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        license: "MIT",
        gitHead: SOURCE_COMMIT,
        repository: `git+${SOURCE_REPOSITORY}.git`,
        dist: { integrity, tarball: npmTarballUrl() }
      },
      tarballBytes,
      readRepositoryFile: async (path) => repositoryFiles.get(path)
    }
  };
}

function npmTarballUrl() {
  return "https://registry.npmjs.org/@verified/example/-/example-1.4.2.tgz";
}

function file(path, data) {
  return { path, data, type: "0" };
}
