import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareUnsignedPreview,
  unsignedPreviewArtifactSpecs,
  validateUnsignedPreviewManifest,
  verifyUnsignedPreview
} from "./unsigned-preview-artifacts.mjs";
import { expectedVersionTag } from "./verify-version-tag.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("unsigned preview release artifacts", () => {
  it("prepares and verifies exactly the supported unsigned targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi67-unsigned-preview-"));
    temporaryDirectories.push(directory);
    const version = "0.1.0-alpha.1";
    await Promise.all(unsignedPreviewArtifactSpecs(version).map((spec, index) => (
      writeFile(join(directory, spec.source), `fixture-${index + 1}`, "utf8")
    )));

    await prepareUnsignedPreview(directory, version, "0.81.1");
    await expect(verifyUnsignedPreview(directory, version, "0.81.1")).resolves.toBeUndefined();
    const manifest = JSON.parse(await readFile(join(directory, "unsigned-preview-manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ channel: "unsigned-preview", signed: false, version });
    expect(manifest.files.map((file) => file.name)).toEqual(unsignedPreviewArtifactSpecs(version).map((spec) => spec.name));
    expect(await readFile(join(directory, "SHA256SUMS.txt"), "utf8")).toContain("win-x64-unsigned-preview.exe");
  });

  it("rejects signed or incomplete preview manifests and invalid version tags", () => {
    const failures = validateUnsignedPreviewManifest({
      schemaVersion: 1,
      product: "Pi-67 Desktop",
      version: "0.1.0-alpha.1",
      channel: "unsigned-preview",
      signed: true,
      runtime: "@earendil-works/pi-coding-agent@0.81.1",
      files: []
    }, "0.1.0-alpha.1", "0.81.1");
    expect(failures).toContain("manifest channel must be unsigned-preview");
    expect(failures).toContain("manifest must contain exactly three artifacts");
    expect(expectedVersionTag("0.1.0-alpha.1")).toBe("v0.1.0-alpha.1");
    expect(() => expectedVersionTag("latest")).toThrow(/Invalid package version/u);
  });
});
