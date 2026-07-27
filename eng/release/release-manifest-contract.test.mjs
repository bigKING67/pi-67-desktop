import { describe, expect, it } from "vitest";
import {
  createSignedReleaseManifest,
  findUnexpectedSignedReleaseProductArtifacts,
  parseCanonicalStableTag,
  parseCanonicalStableVersion,
  validateSignedReleaseManifest
} from "./release-manifest-contract.mjs";

describe("signed stable release manifest contract", () => {
  it("accepts only canonical stable versions and tags", () => {
    expect(parseCanonicalStableVersion("1.2.3")).toBe("1.2.3");
    expect(parseCanonicalStableTag("v1.2.3")).toBe("1.2.3");
    for (const value of ["1.2.3-alpha.1", "1.2.3+build.1", "01.2.3", "latest"]) {
      expect(() => parseCanonicalStableVersion(value)).toThrow("Invalid canonical");
    }
  });

  it("creates an explicit stable signed manifest", () => {
    const manifest = createSignedReleaseManifest({
      version: "1.2.3",
      runtime: "@earendil-works/pi-coding-agent@0.81.1",
      files: files("1.2.3")
    });
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      channel: "stable",
      signed: true,
      version: "1.2.3"
    });
    expect(validateSignedReleaseManifest(manifest, "1.2.3")).toEqual([]);
  });

  it("rejects unsigned identity and artifact drift", () => {
    const manifest = createSignedReleaseManifest({
      version: "1.2.3",
      runtime: "@earendil-works/pi-coding-agent@0.81.1",
      files: files("1.2.3")
    });
    manifest.signed = false;
    manifest.files[0].target = "macos-arm64";
    expect(validateSignedReleaseManifest(manifest, "1.2.3")).toEqual(expect.arrayContaining([
      "invalid signed release manifest identity",
      expect.stringContaining("unexpected release artifact")
    ]));
  });

  it("rejects extra product-like files outside the exact stable allowlist", () => {
    expect(findUnexpectedSignedReleaseProductArtifacts("1.2.3", [
      ...files("1.2.3").map((entry) => entry.name),
      "Pi-67-Desktop-debug-win-x64.exe",
      "Pi-67-Desktop-1.2.2-mac-arm64.dmg",
      "windows-native-release-gate.json"
    ])).toEqual([
      "Pi-67-Desktop-debug-win-x64.exe",
      "Pi-67-Desktop-1.2.2-mac-arm64.dmg"
    ]);
  });
});

function files(version) {
  return [
    {
      name: `Pi-67-Desktop-${version}-win-x64.exe`,
      bytes: 1,
      sha256: "1".repeat(64),
      target: "windows-x64"
    },
    {
      name: `Pi-67-Desktop-${version}-mac-arm64.dmg`,
      bytes: 1,
      sha256: "2".repeat(64),
      target: "macos-arm64"
    },
    {
      name: `Pi-67-Desktop-${version}-mac-arm64.zip`,
      bytes: 1,
      sha256: "3".repeat(64),
      target: "macos-arm64"
    }
  ];
}
