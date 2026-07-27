import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Extension, SourceInfo } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { resolveExtensionPackageIdentity } from "./extension-package-identity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Extension package identity", () => {
  it("reads bounded installed package evidence from Pi's resolved base directory", async () => {
    const fixture = await packageFixture("@verified/example", "1.2.3");
    const identity = await resolveExtensionPackageIdentity(extension(fixture, {
      source: "npm:@verified/example@^1.0.0"
    }));

    expect(identity).toMatchObject({
      name: "@verified/example",
      version: "1.2.3",
      source: "npm:@verified/example@^1.0.0",
      evidence: "pi-resolved-package-manifest"
    });
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it("fails closed for top-level extensions and mismatched npm package names", async () => {
    const fixture = await packageFixture("@verified/example", "1.2.3");
    expect(await resolveExtensionPackageIdentity(extension(fixture, { origin: "top-level" }))).toBeUndefined();
    expect(await resolveExtensionPackageIdentity(extension(fixture, {
      source: "npm:@different/package@1.2.3"
    }))).toBeUndefined();
  });

  it("rejects invalid installed versions and oversized package manifests", async () => {
    const invalid = await packageFixture("@verified/example", "^1.2.3");
    expect(await resolveExtensionPackageIdentity(extension(invalid))).toBeUndefined();

    const oversized = await packageFixture("@verified/example", "1.2.3");
    await writeFile(join(oversized.baseDir, "package.json"), JSON.stringify({
      name: "@verified/example",
      version: "1.2.3",
      padding: "x".repeat(70 * 1024)
    }));
    expect(await resolveExtensionPackageIdentity(extension(oversized))).toBeUndefined();
  });

  it("rejects an extension path that resolves outside Pi's package base directory", async () => {
    const fixture = await packageFixture("@verified/example", "1.2.3");
    const outside = await temporaryRoot();
    const outsideExtension = join(outside, "extension.ts");
    await writeFile(outsideExtension, "export default {};");
    await rm(fixture.extensionPath);
    await symlink(outsideExtension, fixture.extensionPath, "file");

    expect(await resolveExtensionPackageIdentity(extension(fixture))).toBeUndefined();
  });

  it("accepts a contained filename that begins with two dots", async () => {
    const fixture = await packageFixture("@verified/example", "1.2.3");
    const unusualPath = join(fixture.baseDir, "..extension.ts");
    await writeFile(unusualPath, "export default {};");
    const candidate = extension(fixture);
    candidate.path = unusualPath;
    candidate.resolvedPath = unusualPath;
    candidate.sourceInfo = { ...candidate.sourceInfo, path: unusualPath };

    await expect(resolveExtensionPackageIdentity(candidate)).resolves.toMatchObject({
      name: "@verified/example",
      version: "1.2.3"
    });
  });
});

interface PackageFixture {
  baseDir: string;
  extensionPath: string;
}

async function packageFixture(name: string, version: string): Promise<PackageFixture> {
  const root = await temporaryRoot();
  const baseDir = join(root, "package");
  const extensionPath = join(baseDir, "extension.ts");
  await mkdir(baseDir);
  await Promise.all([
    writeFile(join(baseDir, "package.json"), JSON.stringify({ name, version })),
    writeFile(extensionPath, "export default {};")
  ]);
  return { baseDir, extensionPath };
}

function extension(
  fixture: PackageFixture,
  overrides: Partial<SourceInfo> = {}
): Pick<Extension, "path" | "resolvedPath" | "sourceInfo"> {
  return {
    path: fixture.extensionPath,
    resolvedPath: fixture.extensionPath,
    sourceInfo: {
      path: fixture.extensionPath,
      source: "npm:@verified/example@1.2.3",
      scope: "user",
      origin: "package",
      baseDir: fixture.baseDir,
      ...overrides
    }
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-extension-package-"));
  roots.push(root);
  return root;
}
