import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  observePhysicalDirectoryIdentity,
  physicalDirectoryIdentitiesMatch,
  repositoryGroupId,
  workspaceIdentityFingerprint,
  workspaceMatchesPhysicalDirectory,
  worktreeProjectionId
} from "./repository-identity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository physical identity", () => {
  it("derives opaque stable projection ids without including the source path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-repository-identity-"));
    roots.push(root);
    const repository = join(root, "仓库");
    await mkdir(repository);
    const identity = await observePhysicalDirectoryIdentity(repository);

    expect(repositoryGroupId(identity)).toMatch(/^repo_[0-9a-f]{32}$/u);
    expect(worktreeProjectionId(identity)).toMatch(/^wt_[0-9a-f]{32}$/u);
    expect(repositoryGroupId(identity)).not.toContain("仓库");
  });

  it("matches filesystem identities and uses case-insensitive path fallback on Windows", () => {
    const filesystem = {
      canonicalPath: "/repo",
      device: "1",
      inode: "2",
      birthtimeNs: "3",
      assurance: "filesystem" as const
    };
    expect(physicalDirectoryIdentitiesMatch(filesystem, { ...filesystem, canonicalPath: "/other" }))
      .toBe(true);
    expect(physicalDirectoryIdentitiesMatch(
      { canonicalPath: "C:\\Repo", assurance: "path-only" },
      { canonicalPath: "c:\\repo\\", assurance: "path-only" },
      "win32"
    )).toBe(true);
    expect(physicalDirectoryIdentitiesMatch(
      { canonicalPath: "/Repo", assurance: "path-only" },
      { canonicalPath: "/repo", assurance: "path-only" },
      "darwin"
    )).toBe(false);
    expect(physicalDirectoryIdentitiesMatch(
      filesystem,
      { ...filesystem, inode: "different" }
    )).toBe(false);
  });

  it("matches registered Workspace identity without exposing its canonical path", () => {
    const workspace = {
      id: "workspace-a",
      displayName: "repo",
      identity: {
        canonicalPath: "C:\\Repo",
        assurance: "path-only" as const
      },
      trust: "trusted" as const,
      trustProvenance: "native-picker" as const,
      availability: "available" as const
    };
    expect(workspaceMatchesPhysicalDirectory(
      workspace,
      { canonicalPath: "c:\\repo", assurance: "path-only" },
      "win32"
    )).toBe(true);

    const filesystemWorkspace = {
      ...workspace,
      identity: {
        canonicalPath: "/registered",
        device: "1",
        inode: "2",
        birthtimeNs: "3",
        assurance: "filesystem" as const
      }
    };
    expect(workspaceMatchesPhysicalDirectory(filesystemWorkspace, {
      canonicalPath: "/observed",
      device: "1",
      inode: "2",
      birthtimeNs: "3",
      assurance: "filesystem"
    })).toBe(true);
    expect(workspaceMatchesPhysicalDirectory(filesystemWorkspace, {
      canonicalPath: "/observed",
      device: "1",
      inode: "different",
      birthtimeNs: "3",
      assurance: "filesystem"
    })).toBe(false);
  });

  it("fingerprints both Workspace identity assurances without retaining the path", () => {
    const pathWorkspace = {
      id: "workspace-path",
      displayName: "repo",
      identity: { canonicalPath: "/private/repository", assurance: "path-only" as const },
      trust: "trusted" as const,
      trustProvenance: "native-picker" as const,
      availability: "available" as const
    };
    const filesystemWorkspace = {
      ...pathWorkspace,
      id: "workspace-filesystem",
      identity: {
        canonicalPath: "/private/repository",
        device: "1",
        inode: "2",
        assurance: "filesystem" as const
      }
    };
    const pathFingerprint = workspaceIdentityFingerprint(pathWorkspace);
    const filesystemFingerprint = workspaceIdentityFingerprint(filesystemWorkspace);
    expect(pathFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(filesystemFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(filesystemFingerprint).not.toBe(pathFingerprint);
    expect(pathFingerprint).not.toContain("private");
  });

  it("rejects a physical identity target that is not a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-repository-identity-file-"));
    roots.push(root);
    const file = join(root, "not-a-directory");
    await writeFile(file, "fixture", "utf8");
    await expect(observePhysicalDirectoryIdentity(file))
      .rejects.toThrow("Physical identity target must be a directory.");
  });
});
