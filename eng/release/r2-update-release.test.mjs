import { describe, expect, it, vi } from "vitest";
import {
  createR2ReleasePlan,
  createR2RetentionPlan,
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
    expect(plan.retention).toEqual({
      retainedVersionLimit: 3,
      retainedVersions: [version, "0.1.0-alpha.29"],
      deletedVersions: [],
      futureVersions: [],
      artifactsToDelete: []
    });
  });

  it("keeps the newest three SemVer versions and selects only recognized older artifacts", () => {
    const oldestVersion = "0.1.0-alpha.27";
    const objects = [
      ...remoteVersion("0.1.0-alpha.29"),
      ...remoteVersion("0.1.0-alpha.28"),
      ...remoteVersion(oldestVersion),
      { key: "operator-notes.txt", size: 20 },
      { key: "unsigned-preview-manifest.json", size: 30 }
    ];

    const retention = createR2RetentionPlan(objects, version);

    expect(retention.retainedVersions).toEqual([
      version,
      "0.1.0-alpha.29",
      "0.1.0-alpha.28"
    ]);
    expect(retention.deletedVersions).toEqual([oldestVersion]);
    expect(retention.futureVersions).toEqual([]);
    expect(retention.artifactsToDelete).toEqual(
      remoteVersion(oldestVersion).map((entry) => entry.key).sort()
    );
  });

  it("publishes immutable artifacts before public verification and the manifest last", async () => {
    const release = fixtureRelease();
    const calls = [];
    let manifestReads = 0;
    const client = {
      listObjects: vi.fn(async () => []),
      putFile: vi.fn(async (key) => calls.push(`put:${key}`))
    };
    const progress = { stage: vi.fn(), transfer: vi.fn() };

    const result = await publishR2Release({
      release,
      client,
      readPublicManifest: vi.fn(async () => {
        manifestReads += 1;
        return manifestReads === 1 ? null : release.manifest;
      }),
      verifyArtifact: vi.fn(async (_origin, artifact) => calls.push(`verify:${artifact.name}`)),
      progress
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
    expect(progress.stage.mock.calls.map(([event]) => `${event.name}:${event.phase}`)).toEqual([
      "release-plan:start",
      "release-plan:complete",
      "immutable-artifacts:start",
      "immutable-artifacts:complete",
      "public-verification:start",
      "public-verification:complete",
      "manifest-publication:start",
      "manifest-publication:complete",
      "manifest-verification:start",
      "manifest-verification:complete",
      "retention-cleanup:start",
      "retention-cleanup:complete"
    ]);
    for (const invocation of progress.stage.mock.calls.filter(([event]) => (
      event.name === "immutable-artifacts" || event.name === "public-verification"
    ))) {
      expect(invocation[0].manifestState).toBe("not published");
    }
    expect(progress.stage.mock.calls.find(([event]) => (
      event.name === "manifest-publication" && event.phase === "complete"
    ))?.[0].manifestState).toBe("published");
    expect(result.retention).toEqual({
      retainedVersionLimit: 3,
      retainedVersions: [version],
      deletedVersions: [],
      deletedArtifacts: []
    });
  });

  it("deletes the fourth and older versions only after the public manifest is verified", async () => {
    const release = fixtureRelease();
    const prunedVersion = "0.1.0-alpha.27";
    let objects = [
      ...remoteVersion("0.1.0-alpha.29"),
      ...remoteVersion("0.1.0-alpha.28"),
      ...remoteVersion(prunedVersion),
      { key: "operator-notes.txt", size: 20 }
    ];
    const calls = [];
    let manifestReads = 0;
    const client = {
      listObjects: vi.fn(async () => objects),
      putFile: vi.fn(async (key) => {
        calls.push(`put:${key}`);
        const artifact = release.artifacts.find((entry) => entry.name === key);
        if (artifact) objects.push({ key, size: artifact.bytes });
      }),
      deleteObject: vi.fn(async (key) => {
        calls.push(`delete:${key}`);
        objects = objects.filter((entry) => entry.key !== key);
      })
    };

    const result = await publishR2Release({
      release,
      client,
      readPublicManifest: vi.fn(async () => {
        manifestReads += 1;
        if (manifestReads === 1) return null;
        calls.push("manifest:verified");
        return release.manifest;
      }),
      verifyArtifact: vi.fn()
    });

    const expectedDeleted = remoteVersion(prunedVersion).map((entry) => entry.key).sort();
    expect(result.retention).toEqual({
      retainedVersionLimit: 3,
      retainedVersions: [version, "0.1.0-alpha.29", "0.1.0-alpha.28"],
      deletedVersions: [prunedVersion],
      deletedArtifacts: expectedDeleted
    });
    expect(client.deleteObject.mock.calls.map(([key]) => key)).toEqual(expectedDeleted);
    expect(calls.indexOf("manifest:verified")).toBeLessThan(calls.indexOf(`delete:${expectedDeleted[0]}`));
    expect(objects.some((entry) => entry.key === "operator-notes.txt")).toBe(true);
    expect(objects.some((entry) => entry.key.includes(prunedVersion))).toBe(false);
  });

  it("reports an already-current manifest truthfully during an idempotent publish", async () => {
    const release = fixtureRelease();
    const progress = { stage: vi.fn(), transfer: vi.fn() };
    const client = {
      listObjects: vi.fn(async () => release.artifacts.map((artifact) => ({
        key: artifact.name,
        size: artifact.bytes
      }))),
      putFile: vi.fn(),
      verifyObject: vi.fn(async (artifact) => ({
        cacheControl: immutableArtifactCacheControl,
        contentType: artifact.name.endsWith(".zip")
          ? "application/zip"
          : artifact.name.endsWith(".dmg")
            ? "application/x-apple-diskimage"
            : "application/vnd.microsoft.portable-executable",
        etag: '"verified-etag"',
        preservedMetadata: {}
      }))
    };

    await publishR2Release({
      release,
      client,
      readPublicManifest: vi.fn(async () => release.manifest),
      verifyArtifact: vi.fn(),
      progress
    });

    expect(client.putFile).not.toHaveBeenCalled();
    for (const stageName of ["immutable-artifacts", "public-verification"]) {
      expect(progress.stage.mock.calls.find(([event]) => (
        event.name === stageName && event.phase === "start"
      ))?.[0].manifestState).toBe("already current");
    }
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
      replaceObjectHttpMetadata: vi.fn(),
      deleteObject: vi.fn()
    };

    await expect(publishR2Release({
      release,
      client,
      readPublicManifest: vi.fn(async () => null),
      verifyArtifact: vi.fn()
    })).rejects.toThrow("R2 SHA-256 mismatch");
    expect(client.replaceObjectHttpMetadata).not.toHaveBeenCalled();
    expect(client.putFile).not.toHaveBeenCalled();
    expect(client.deleteObject).not.toHaveBeenCalled();
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

  it("fails before upload or deletion when R2 contains a recognized future version", async () => {
    const release = fixtureRelease();
    const client = {
      listObjects: vi.fn(async () => remoteVersion("0.1.0-alpha.31")),
      putFile: vi.fn(),
      deleteObject: vi.fn()
    };

    await expect(publishR2Release({
      release,
      client,
      readPublicManifest: vi.fn(async () => null),
      verifyArtifact: vi.fn()
    })).rejects.toThrow("newer than the target version");
    expect(client.putFile).not.toHaveBeenCalled();
    expect(client.deleteObject).not.toHaveBeenCalled();
  });

  it("fails publication when post-delete inventory still exceeds retention", async () => {
    const release = fixtureRelease();
    const staleVersion = "0.1.0-alpha.27";
    let objects = [
      ...remoteVersion("0.1.0-alpha.29"),
      ...remoteVersion("0.1.0-alpha.28"),
      ...remoteVersion(staleVersion)
    ];
    let manifestReads = 0;
    const client = {
      listObjects: vi.fn(async () => objects),
      putFile: vi.fn(async (key) => {
        const artifact = release.artifacts.find((entry) => entry.name === key);
        if (artifact) objects = [...objects, { key, size: artifact.bytes }];
      }),
      deleteObject: vi.fn(async () => undefined)
    };

    await expect(publishR2Release({
      release,
      client,
      readPublicManifest: vi.fn(async () => {
        manifestReads += 1;
        return manifestReads === 1 ? null : release.manifest;
      }),
      verifyArtifact: vi.fn()
    })).rejects.toThrow("retention verification");
    expect(client.deleteObject).toHaveBeenCalledTimes(3);
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

function remoteVersion(remoteVersionName) {
  return [
    `Pi-67-Desktop-${remoteVersionName}-win-x64-unsigned-preview.exe`,
    `Pi-67-Desktop-${remoteVersionName}-mac-arm64-unsigned-preview.dmg`,
    `Pi-67-Desktop-${remoteVersionName}-mac-arm64-unsigned-preview.zip`
  ].map((key, index) => ({ key, size: 100 + index }));
}
