import { describe, expect, it, vi } from "vitest";
import { parseR2ArtifactKey } from "./r2-update-release-contract.mjs";
import {
  cleanupR2Release,
  parseReleaseCommandFlags
} from "./r2-update-release.mjs";

const version = "0.1.0-alpha.30";
const runtimeVersion = "0.84.2";

describe("R2 update cleanup and command contracts", () => {
  it("cleans only recognized old versions after explicit target-platform confirmation", async () => {
    const current = currentManifest();
    const old = "Pi-67-Desktop-0.1.0-alpha.29-mac-arm64-unsigned-preview.zip";
    const unknown = "operator-notes.txt";
    let objects = [
      ...current.files.map((entry) => ({ key: entry.name, size: entry.bytes })),
      { key: old, size: 10 },
      { key: unknown, size: 20 },
      { key: "unsigned-preview-manifest.json", size: 30 }
    ];
    const client = {
      listObjects: vi.fn(async () => objects),
      deleteObject: vi.fn(async (key) => { objects = objects.filter((entry) => entry.key !== key); }),
      purgeExactUrls: vi.fn()
    };

    const result = await cleanupR2Release({
      client,
      confirmedVersion: version,
      runtimeVersion,
      targetUpgradesConfirmed: true,
      readPublicManifest: vi.fn(async () => current)
    });

    expect(result.deleted).toEqual([old]);
    expect(client.deleteObject).toHaveBeenCalledWith(old);
    expect(client.purgeExactUrls).toHaveBeenCalledWith([
      `https://updates.52671314.xyz/${encodeURIComponent(old)}`
    ]);
    expect(objects.some((entry) => entry.key === unknown)).toBe(true);
  });

  it("rejects cleanup without explicit target-platform upgrade evidence", async () => {
    await expect(cleanupR2Release({
      client: {},
      confirmedVersion: version,
      runtimeVersion,
      targetUpgradesConfirmed: false
    })).rejects.toThrow("confirm-target-upgrades");
  });

  it("recognizes only exact Pi-67 SemVer artifact identities", () => {
    expect(parseR2ArtifactKey(`Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`))
      .toEqual({ key: `Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`, version });
    expect(parseR2ArtifactKey(`Pi-67-Desktop-v${version}-win-x64-unsigned-preview.exe`)).toBeUndefined();
    expect(parseR2ArtifactKey("Pi-67-Desktop-latest-win-x64-unsigned-preview.exe")).toBeUndefined();
    expect(parseR2ArtifactKey("notes-0.1.0-alpha.29.zip")).toBeUndefined();
  });

  it("accepts only command-specific non-duplicated release flags", () => {
    expect(parseReleaseCommandFlags("publish", [
      "--confirm-version", version,
      "--source-commit", "a".repeat(40)
    ])).toEqual(new Map([
      ["confirm-version", version],
      ["source-commit", "a".repeat(40)]
    ]));
    expect(() => parseReleaseCommandFlags("plan", ["--source-commit", "a".repeat(40)]))
      .toThrow("Usage");
    expect(() => parseReleaseCommandFlags("cleanup", [
      "--confirm-version", version,
      "--confirm-version", version
    ])).toThrow("Usage");
  });
});

function currentManifest() {
  const files = [
    ["win-x64-unsigned-preview.exe", "windows-x64", 101, "a"],
    ["mac-arm64-unsigned-preview.dmg", "macos-arm64", 102, "b"],
    ["mac-arm64-unsigned-preview.zip", "macos-arm64", 103, "c"]
  ].map(([suffix, target, bytes, character]) => ({
    name: `Pi-67-Desktop-${version}-${suffix}`,
    target,
    bytes,
    sha256: character.repeat(64)
  }));
  return {
    schemaVersion: 1,
    product: "Pi-67 Desktop",
    version,
    channel: "unsigned-preview",
    signed: false,
    runtime: `@earendil-works/pi-coding-agent@${runtimeVersion}`,
    files
  };
}
