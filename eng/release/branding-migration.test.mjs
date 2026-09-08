import { describe, expect, it } from "vitest";
import { parseR2ArtifactKey } from "./r2-update-release-contract.mjs";
import { unsignedPreviewArtifactSpecs, validateUnsignedPreviewManifest } from "./unsigned-preview-artifacts.mjs";
import { parseUnsignedPreviewManifest } from "../../apps/desktop/src/unsigned-preview-update.js";
import { buildWindowsUpdateInstallerArguments } from "../../apps/desktop/src/unsigned-update-installer.js";

describe("New Money update compatibility", () => {
  it.each(["New-Money", "Pi-67-Desktop"])("accepts a complete %s artifact family with the existing product identity", (prefix) => {
    const manifest = fixture(prefix);
    expect(validateUnsignedPreviewManifest(manifest, manifest.version, "0.84.3")).toEqual([]);
    expect(parseUnsignedPreviewManifest(manifest).artifacts).toHaveLength(3);
    expect(parseR2ArtifactKey(manifest.files[0].name)).toEqual({ key: manifest.files[0].name, version: manifest.version });
  });

  it("rejects mixed naming families and preserves exact manifest membership", () => {
    const manifest = fixture("New-Money");
    manifest.files[1].name = manifest.files[1].name.replace("New-Money", "Pi-67-Desktop");
    expect(validateUnsignedPreviewManifest(manifest, manifest.version, "0.84.3").length).toBeGreaterThan(0);
    expect(() => parseUnsignedPreviewManifest(manifest)).toThrow();
  });

  it.each(["New Money.exe", "Pi-67 Desktop.exe"])("keeps the existing Windows install directory for %s", (name) => {
    expect(buildWindowsUpdateInstallerArguments(`C:\\Existing Install\\${name}`)).toEqual([
      "--updated", "--force-run", "/S", "/D=C:\\Existing Install"
    ]);
  });
});

function fixture(prefix) {
  const version = "0.1.0-alpha.41";
  return {
    schemaVersion: 1,
    product: "Pi-67 Desktop",
    version,
    channel: "unsigned-preview",
    signed: false,
    runtime: "@earendil-works/pi-coding-agent@0.84.3",
    files: unsignedPreviewArtifactSpecs(version, prefix).map(({ name, target }) => ({
      name, target, bytes: 10, sha256: "a".repeat(64)
    }))
  };
}
