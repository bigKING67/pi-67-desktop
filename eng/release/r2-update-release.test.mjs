import { describe, expect, it, vi } from "vitest";
import {
  createR2ReleasePlan,
  parseR2ArtifactKey
} from "./r2-update-release-contract.mjs";
import {
  cleanupR2Release,
  immutableArtifactCacheControl,
  parseReleaseCommandFlags,
  publishR2Release
} from "./r2-update-release.mjs";

const version = "0.1.0-alpha.30";
const runtimeVersion = "0.84.2";

describe("R2 update release", () => {
  it("plans missing uploads while preserving recognized old and unknown objects", () => {
    const release = fixtureRelease();
    const plan = createR2ReleasePlan(release, [
      { key: release.artifacts[0].name, size: release.artifacts[0].bytes },
      { key: "Pi-67-Desktop-0.1.0-alpha.29-win-x64-unsigned-preview.exe", size: 10 },
      { key: "operator-notes.txt", size: 20 }
    ], null);

    expect(plan.uploads).toEqual(release.artifacts.slice(1).map((entry) => entry.name));
    expect(plan.alreadyPresent).toEqual([release.artifacts[0].name]);
    expect(plan.oldArtifacts).toEqual(["Pi-67-Desktop-0.1.0-alpha.29-win-x64-unsigned-preview.exe"]);
    expect(plan.unknownObjects).toEqual(["operator-notes.txt"]);
  });

  it("publishes immutable artifacts before public verification and the manifest last", async () => {
    const release = fixtureRelease();
    const calls = [];
    let manifestReads = 0;
    const client = {
      listObjects: vi.fn(async () => []),
      putFile: vi.fn(async (key) => calls.push(`put:${key}`))
    };

    const result = await publishR2Release({
      release,
      client,
      readPublicManifest: vi.fn(async () => {
        manifestReads += 1;
        return manifestReads === 1 ? null : release.manifest;
      }),
      verifyArtifact: vi.fn(async (_origin, artifact) => calls.push(`verify:${artifact.name}`))
    });

    expect(calls).toEqual([
      ...release.artifacts.map((entry) => `put:${entry.name}`),
      ...release.artifacts.map((entry) => `verify:${entry.name}`),
      "put:unsigned-preview-manifest.json"
    ]);
    for (const artifact of release.artifacts) {
      expect(client.putFile).toHaveBeenCalledWith(
        artifact.name,
        artifact.path,
        expect.any(String),
        immutableArtifactCacheControl
      );
    }
    expect(client.putFile).toHaveBeenLastCalledWith(
      "unsigned-preview-manifest.json",
      release.manifestPath,
      "application/json; charset=utf-8",
      "no-store"
    );
    expect(result.published).toBe(true);
    expect(result.metadataRepairs).toEqual([]);
  });

  it("verifies existing bytes before conditionally repairing HTTP metadata", async () => {
    const release = fixtureRelease();
    const calls = [];
    let manifestReads = 0;
    const client = {
      listObjects: vi.fn(async () => release.artifacts.map((artifact) => ({
        key: artifact.name,
        size: artifact.bytes
      }))),
      putFile: vi.fn(async (key) => calls.push(`put:${key}`)),
      verifyObject: vi.fn(async (artifact) => {
        calls.push(`verify-r2:${artifact.name}`);
        return {
          cacheControl: artifact === release.artifacts[0]
            ? "max-age=31536000"
            : immutableArtifactCacheControl,
          contentType: artifact.name.endsWith(".zip")
            ? "application/zip"
            : artifact.name.endsWith(".dmg")
              ? "application/x-apple-diskimage"
              : "application/vnd.microsoft.portable-executable",
          etag: '"verified-etag"',
          preservedMetadata: { Metadata: { source: "candidate" } }
        };
      }),
      replaceObjectHttpMetadata: vi.fn(async (key) => calls.push(`repair:${key}`))
    };

    const result = await publishR2Release({
      release,
      client,
      readPublicManifest: vi.fn(async () => {
        manifestReads += 1;
        return manifestReads === 1 ? null : release.manifest;
      }),
      verifyArtifact: vi.fn(async (_origin, artifact) => calls.push(`verify-public:${artifact.name}`))
    });

    expect(calls).toEqual([
      `verify-r2:${release.artifacts[0].name}`,
      `repair:${release.artifacts[0].name}`,
      `verify-r2:${release.artifacts[1].name}`,
      `verify-r2:${release.artifacts[2].name}`,
      ...release.artifacts.map((artifact) => `verify-public:${artifact.name}`),
      "put:unsigned-preview-manifest.json"
    ]);
    expect(client.replaceObjectHttpMetadata).toHaveBeenCalledWith(release.artifacts[0].name, {
      contentType: "application/vnd.microsoft.portable-executable",
      cacheControl: immutableArtifactCacheControl,
      etag: '"verified-etag"',
      preservedMetadata: { Metadata: { source: "candidate" } }
    });
    expect(result.metadataRepairs).toEqual([release.artifacts[0].name]);
  });

  it("does not mutate metadata when direct R2 verification fails", async () => {
    const release = fixtureRelease();
    const client = {
      listObjects: vi.fn(async () => release.artifacts.map((artifact) => ({
        key: artifact.name,
        size: artifact.bytes
      }))),
      putFile: vi.fn(),
      verifyObject: vi.fn(async () => { throw new Error("R2 SHA-256 mismatch"); }),
      replaceObjectHttpMetadata: vi.fn()
    };

    await expect(publishR2Release({
      release,
      client,
      readPublicManifest: vi.fn(async () => null),
      verifyArtifact: vi.fn()
    })).rejects.toThrow("R2 SHA-256 mismatch");
    expect(client.replaceObjectHttpMetadata).not.toHaveBeenCalled();
    expect(client.putFile).not.toHaveBeenCalled();
  });

  it("fails closed instead of overwriting an immutable artifact", async () => {
    const release = fixtureRelease();
    const client = {
      listObjects: vi.fn(async () => [{ key: release.artifacts[0].name, size: 999 }]),
      putFile: vi.fn()
    };

    await expect(publishR2Release({
      release,
      client,
      readPublicManifest: vi.fn(async () => null),
      verifyArtifact: vi.fn()
    })).rejects.toThrow("immutable");
    expect(client.putFile).not.toHaveBeenCalled();
  });

  it("cleans only recognized old versions after explicit target-platform confirmation", async () => {
    const current = fixtureRelease().manifest;
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

function fixtureRelease() {
  const artifacts = [
    artifact(`Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`, "windows-x64", 101, "a"),
    artifact(`Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.dmg`, "macos-arm64", 102, "b"),
    artifact(`Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.zip`, "macos-arm64", 103, "c")
  ];
  const manifest = {
    schemaVersion: 1,
    product: "Pi-67 Desktop",
    version,
    channel: "unsigned-preview",
    signed: false,
    runtime: `@earendil-works/pi-coding-agent@${runtimeVersion}`,
    files: artifacts.map(({ path: _path, ...entry }) => entry)
  };
  return {
    version,
    artifacts,
    manifest,
    manifestPath: "/local/unsigned-preview-manifest.json",
    provenance: {
      candidateIdentitySha256: "d".repeat(64),
      repository: "bigKING67/pi-67-desktop",
      sourceCommit: "e".repeat(40),
      windowsCandidateRunId: "42",
      windowsCandidateRunAttempt: "2"
    }
  };
}

function artifact(name, target, bytes, character) {
  return { name, target, bytes, sha256: character.repeat(64), path: `/local/${name}` };
}
