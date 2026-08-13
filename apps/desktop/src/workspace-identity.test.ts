import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNativeWorkspaceDescriptor,
  parseNativeWorkspaceDescriptor,
  parseWorkspaceDescriptor,
  refreshPersistedWorkspaceDescriptor,
  refreshNativeWorkspaceDescriptor,
  workspaceDescriptorsReferToSameDirectory,
  type NativeWorkspaceDescriptor,
  type WorkspaceDescriptor
} from "./workspace-identity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("native workspace identity", () => {
  it("returns a trusted descriptor from native-canonical path and bigint metadata", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "demo-workspace");
    await mkdir(workspace);

    const descriptor = await createNativeWorkspaceDescriptor(workspace, { createId: () => "workspace-1" });

    expect(descriptor).toEqual({
      id: "workspace-1",
      displayName: "demo-workspace",
      identity: {
        canonicalPath: realpathSync.native(workspace),
        device: expect.stringMatching(/^\d+$/u),
        inode: expect.stringMatching(/^\d+$/u),
        birthtimeNs: expect.stringMatching(/^\d+$/u),
        assurance: expect.stringMatching(/^(?:filesystem|path-only)$/u)
      },
      lastVerifiedAt: expect.any(Number),
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    expect(parseNativeWorkspaceDescriptor(descriptor)).toEqual(descriptor);
  });

  it("deduplicates a symlink or junction using realpath.native", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "workspace");
    const alias = join(root, "workspace-alias");
    await mkdir(workspace);
    await symlink(workspace, alias, process.platform === "win32" ? "junction" : "dir");

    const direct = await createNativeWorkspaceDescriptor(workspace, { createId: () => "direct" });
    const throughAlias = await createNativeWorkspaceDescriptor(alias, { createId: () => "alias" });

    expect(throughAlias.identity.canonicalPath).toBe(direct.identity.canonicalPath);
    expect(workspaceDescriptorsReferToSameDirectory(direct, throughAlias)).toBe(true);
    expect(refreshNativeWorkspaceDescriptor(direct, throughAlias).id).toBe("direct");
  });

  it("uses strong filesystem identity only when both descriptors have it", () => {
    const first = descriptorFixture("first", "/workspace/first", "filesystem");
    const relocated = descriptorFixture("second", "/workspace/relocated", "filesystem");
    const pathOnly = descriptorFixture("third", "/workspace/path-only", "path-only");

    expect(workspaceDescriptorsReferToSameDirectory(first, relocated)).toBe(true);
    expect(workspaceDescriptorsReferToSameDirectory(first, pathOnly)).toBe(false);
    expect(workspaceDescriptorsReferToSameDirectory(
      first,
      {
        ...relocated,
        identity: {
          ...relocated.identity,
          canonicalPath: first.identity.canonicalPath,
          inode: "different"
        }
      }
    )).toBe(false);
    expect(workspaceDescriptorsReferToSameDirectory(
      first,
      {
        ...relocated,
        identity: {
          canonicalPath: relocated.identity.canonicalPath,
          inode: relocated.identity.inode,
          birthtimeNs: relocated.identity.birthtimeNs,
          assurance: relocated.identity.assurance
        }
      }
    )).toBe(false);
  });

  it("preserves an established canonical spelling only for matching filesystem identity", () => {
    const established = descriptorFixture("existing", "/Workspace/Established", "filesystem");
    const samePhysicalDirectory = descriptorFixture("selected", "/workspace/observed", "filesystem");
    const replacement = {
      ...samePhysicalDirectory,
      identity: { ...samePhysicalDirectory.identity, inode: "different" }
    };
    const pathOnly = descriptorFixture("path-only", "/workspace/path-only", "path-only");

    expect(refreshNativeWorkspaceDescriptor(established, samePhysicalDirectory)).toMatchObject({
      id: "existing",
      identity: { canonicalPath: "/Workspace/Established" }
    });
    expect(refreshNativeWorkspaceDescriptor(established, replacement)).toMatchObject({
      id: "existing",
      identity: { canonicalPath: "/workspace/observed" }
    });
    expect(refreshNativeWorkspaceDescriptor(pathOnly, samePhysicalDirectory)).toMatchObject({
      id: "path-only",
      identity: { canonicalPath: "/workspace/observed" }
    });
  });

  it("uses exact spelling only when both Workspace identities are path-only", () => {
    const upper = descriptorFixture("upper", "/Workspace/Project", "path-only");
    const exact = descriptorFixture("exact", "/Workspace/Project", "path-only");
    const lower = descriptorFixture("lower", "/workspace/project", "path-only");

    expect(workspaceDescriptorsReferToSameDirectory(upper, exact)).toBe(true);
    expect(workspaceDescriptorsReferToSameDirectory(upper, lower)).toBe(false);
  });

  it("rejects files and descriptors with unexpected persisted fields", async () => {
    const root = await temporaryRoot();
    const file = join(root, "not-a-directory");
    await writeFile(file, "fixture");

    await expect(createNativeWorkspaceDescriptor(file)).rejects.toThrow(/directory/u);
    expect(parseNativeWorkspaceDescriptor({ ...descriptorFixture("first", "/workspace/first"), credential: "secret" }))
      .toBeUndefined();
  });

  it("restores trust only when the persisted filesystem identity still matches", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "restored-workspace");
    await mkdir(workspace);
    const persisted = await createNativeWorkspaceDescriptor(workspace, { createId: () => "restored" });

    const restored = await refreshPersistedWorkspaceDescriptor(persisted);

    expect(restored).toMatchObject({
      id: "restored",
      lastVerifiedAt: expect.any(Number),
      trust: "trusted",
      trustProvenance: "restored",
      availability: "available"
    });
  });

  it("marks missing and replaced workspace paths without trusting the replacement", async () => {
    const root = await temporaryRoot();
    const missingPath = join(root, "missing-workspace");
    const missing = descriptorFixture("missing", missingPath);
    const replacedPath = join(root, "replaced-workspace");
    await mkdir(replacedPath);
    const replaced = descriptorFixture("replaced", replacedPath);

    await expect(refreshPersistedWorkspaceDescriptor(missing)).resolves.toMatchObject({
      trust: "trusted",
      availability: "missing"
    });
    await expect(refreshPersistedWorkspaceDescriptor(replaced)).resolves.toMatchObject({
      trust: "unknown",
      trustProvenance: "identity-changed",
      availability: "identity-changed"
    });
  });

  it("preserves non-trusted provenance for matching filesystem registrations", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "untrusted-workspace");
    await mkdir(workspace);
    const observed = await createNativeWorkspaceDescriptor(workspace, { createId: () => "untrusted" });
    const untrusted: WorkspaceDescriptor = {
      ...observed,
      trust: "untrusted",
      trustProvenance: "indirect"
    };
    await expect(refreshPersistedWorkspaceDescriptor(untrusted)).resolves.toMatchObject({
      trust: "untrusted",
      trustProvenance: "indirect",
      availability: "available"
    });
  });

  it("does not restore a Workspace registration from path spelling alone", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "path-only-workspace");
    await mkdir(workspace);
    const observed = await createNativeWorkspaceDescriptor(workspace, {
      createId: () => "path-only",
      now: () => 200
    });
    const pathOnly: WorkspaceDescriptor = {
      ...observed,
      identity: { canonicalPath: observed.identity.canonicalPath, assurance: "path-only" },
      lastVerifiedAt: 100
    };

    await expect(refreshPersistedWorkspaceDescriptor(pathOnly)).resolves.toMatchObject({
      id: "path-only",
      identity: {
        canonicalPath: observed.identity.canonicalPath,
        assurance: expect.stringMatching(/^(?:filesystem|path-only)$/u)
      },
      lastVerifiedAt: 100,
      trust: "unknown",
      trustProvenance: "identity-changed",
      availability: "needs-confirmation"
    });
  });

  it("marks an invalid persisted path unavailable without treating it as missing", async () => {
    const invalid = descriptorFixture("invalid", "/workspace/invalid");
    invalid.identity.canonicalPath = "";

    await expect(refreshPersistedWorkspaceDescriptor(invalid)).resolves.toMatchObject({
      trust: "trusted",
      availability: "unavailable"
    });
  });

  it("covers default identity creation and rejects invalid paths and ids", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "default-id-workspace");
    await mkdir(workspace);

    await expect(createNativeWorkspaceDescriptor(workspace)).resolves.toMatchObject({
      id: expect.stringMatching(/^[A-Za-z0-9._:-]+$/u),
      availability: "available"
    });
    await expect(createNativeWorkspaceDescriptor(""))
      .rejects.toThrow("Workspace path is invalid.");
    await expect(createNativeWorkspaceDescriptor(workspace, { createId: () => "invalid id" }))
      .rejects.toThrow("Workspace id is invalid.");
    await expect(createNativeWorkspaceDescriptor(workspace, { now: () => -1 }))
      .rejects.toThrow("Workspace verification timestamp is invalid.");
  });

  it("rejects malformed workspace descriptor fields at the persistence boundary", () => {
    const valid = descriptorFixture("valid", "/workspace/valid");
    const invalidValues: unknown[] = [
      undefined,
      null,
      [],
      { ...valid, id: "invalid id" },
      { ...valid, displayName: "" },
      { ...valid, lastVerifiedAt: -1 },
      { ...valid, trust: "invalid" },
      { ...valid, trustProvenance: "invalid" },
      { ...valid, availability: "invalid" },
      { ...valid, identity: null },
      { ...valid, identity: { ...valid.identity, canonicalPath: "relative" } },
      { ...valid, identity: { ...valid.identity, device: "01" } },
      { ...valid, identity: { ...valid.identity, inode: "-1" } },
      { ...valid, identity: { ...valid.identity, birthtimeNs: "not-a-number" } },
      { ...valid, identity: { ...valid.identity, assurance: "invalid" } },
      { ...valid, identity: { canonicalPath: "/workspace/valid", assurance: "filesystem" } }
    ];

    for (const value of invalidValues) expect(parseWorkspaceDescriptor(value)).toBeUndefined();
    const legacy = { ...valid } as Record<string, unknown>;
    delete legacy.lastVerifiedAt;
    expect(parseWorkspaceDescriptor(legacy)).toMatchObject({ id: "valid", availability: "available" });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-workspace-identity-"));
  roots.push(root);
  return root;
}

function descriptorFixture(
  id: string,
  canonicalPath: string,
  assurance: "filesystem" | "path-only" = "filesystem"
): NativeWorkspaceDescriptor {
  return {
    id,
    displayName: id,
    identity: { canonicalPath, device: "1", inode: "2", birthtimeNs: "3", assurance },
    lastVerifiedAt: 1,
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}
