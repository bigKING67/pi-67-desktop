import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareUnsignedPreview,
  unsignedPreviewArtifactSpecs,
  validateUnsignedPreviewManifest,
  verifyUnsignedPreview
} from "./unsigned-preview-artifacts.mjs";
import { expectedStableVersionTag, expectedVersionTag } from "./verify-version-tag.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("unsigned preview release artifacts", () => {
  it("prepares and verifies exactly the supported unsigned targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-unsigned-preview-"));
    temporaryDirectories.push(directory);
    const version = "0.1.0-alpha.1";
    const runtimeVersion = "9.8.7";
    await Promise.all(unsignedPreviewArtifactSpecs(version).map((spec, index) => (
      writeFile(join(directory, spec.source), `fixture-${index + 1}`, "utf8")
    )));

    await prepareUnsignedPreview(directory, version, runtimeVersion);
    await expect(verifyUnsignedPreview(directory, version, runtimeVersion)).resolves.toBeUndefined();
    const manifest = JSON.parse(await readFile(join(directory, "unsigned-preview-manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ channel: "unsigned-preview", signed: false, version });
    expect(manifest.files.map((file) => file.name)).toEqual(unsignedPreviewArtifactSpecs(version).map((spec) => spec.name));
    expect(await readFile(join(directory, "SHA256SUMS.txt"), "utf8")).toContain("win-x64-unsigned-preview.exe");
  });

  it("rejects signed or incomplete preview manifests and invalid version tags", () => {
    const runtimeVersion = "9.8.7";
    const failures = validateUnsignedPreviewManifest({
      schemaVersion: 1,
      product: "Pi-67 Desktop",
      version: "0.1.0-alpha.1",
      channel: "unsigned-preview",
      signed: true,
      runtime: `@earendil-works/pi-coding-agent@${runtimeVersion}`,
      files: []
    }, "0.1.0-alpha.1", runtimeVersion);
    expect(failures).toContain("manifest channel must be unsigned-preview");
    expect(failures).toContain("manifest must contain exactly three artifacts");
    expect(expectedVersionTag("0.1.0-alpha.1")).toBe("v0.1.0-alpha.1");
    expect(() => expectedVersionTag("latest")).toThrow(/Invalid package version/u);
    expect(expectedStableVersionTag("1.2.3")).toBe("v1.2.3");
    expect(() => expectedStableVersionTag("1.2.3-alpha.1")).toThrow(/canonical MAJOR\.MINOR\.PATCH/u);
  });

  it.each([0, 1, 2])("rejects symbolic-link input %i before moving any artifact", async (invalidIndex) => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-unsigned-preview-symlink-"));
    temporaryDirectories.push(directory);
    const version = "0.1.0-alpha.1";
    const specs = unsignedPreviewArtifactSpecs(version);
    const target = join(directory, "outside.exe");
    await writeFile(target, "fixture");
    await symlink(target, join(directory, specs[invalidIndex].source));
    const validSpecs = specs.filter((_, index) => index !== invalidIndex);
    await Promise.all(validSpecs.map((spec) => writeFile(join(directory, spec.source), "fixture")));

    await expect(prepareUnsignedPreview(directory, version, "9.8.7"))
      .rejects.toThrow("source is not a regular file");
    for (const spec of validSpecs) {
      await expect(readFile(join(directory, spec.source), "utf8")).resolves.toBe("fixture");
    }
    for (const spec of specs) {
      await expect(access(join(directory, spec.name))).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(access(join(directory, "unsigned-preview-manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops later moves after a rename failure and emits no success manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-unsigned-preview-rename-"));
    temporaryDirectories.push(directory);
    const version = "0.1.0-alpha.1";
    const specs = unsignedPreviewArtifactSpecs(version);
    await Promise.all(specs.map((spec) => writeFile(join(directory, spec.source), "fixture")));
    await mkdir(join(directory, specs[1].name));
    await expect(prepareUnsignedPreview(directory, version, "9.8.7")).rejects.toThrow();
    await expect(readFile(join(directory, specs[0].name), "utf8")).resolves.toBe("fixture");
    await expect(readFile(join(directory, specs[2].source), "utf8")).resolves.toBe("fixture");
    await expect(access(join(directory, specs[2].name))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(directory, "unsigned-preview-manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

});
