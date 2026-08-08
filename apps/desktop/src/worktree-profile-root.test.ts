import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareWorktreeProfilePath,
  recoverWorktreeProfilePath
} from "./worktree-profile-root.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Worktree profile root", () => {
  it("creates a contained opaque target and a verified empty hooks directory", async () => {
    const userData = await temporaryRoot();
    const prepared = await prepareWorktreeProfilePath(
      userData,
      `repo_${"a".repeat(32)}`,
      "a1b2c3d4e5f6g7h8"
    );

    expect(prepared.targetPath).toBe(join(
      prepared.root,
      `repo_${"a".repeat(32)}`,
      "a1b2c3d4e5f6g7h8"
    ));
    expect(prepared.hooksPath).toBe(join(prepared.root, ".empty-hooks"));
  });

  it("fails closed on target collisions, non-empty hooks, and a symlinked profile root", async () => {
    const userData = await temporaryRoot();
    const repositoryGroupId = `repo_${"b".repeat(32)}`;
    const worktreeToken = "b1b2b3b4b5b6b7b8";
    const first = await prepareWorktreeProfilePath(userData, repositoryGroupId, worktreeToken);
    await mkdir(first.targetPath);
    await expect(prepareWorktreeProfilePath(userData, repositoryGroupId, worktreeToken))
      .rejects.toThrow("already exists");

    await writeFile(join(first.hooksPath, "checkout"), "unexpected");
    await expect(prepareWorktreeProfilePath(userData, repositoryGroupId, "c1c2c3c4c5c6c7c8"))
      .rejects.toThrow("not empty");

    const otherUserData = await temporaryRoot();
    const outside = await temporaryRoot();
    await symlink(outside, join(otherUserData, "worktrees"), process.platform === "win32" ? "junction" : "dir");
    await expect(prepareWorktreeProfilePath(otherUserData, repositoryGroupId, worktreeToken))
      .rejects.toThrow("not a real directory");
  });

  it("recovers exact existing targets and reports missing profile components without creating them", async () => {
    const repositoryGroupId = `repo_${"c".repeat(32)}`;
    const worktreeToken = "c1c2c3c4c5c6c7c8";
    const userData = await temporaryRoot();
    const missingRoot = await recoverWorktreeProfilePath(userData, repositoryGroupId, worktreeToken);
    expect(missingRoot).toMatchObject({ exists: false });
    expect(missingRoot.targetPath).toContain(join("worktrees", repositoryGroupId, worktreeToken));

    const prepared = await prepareWorktreeProfilePath(userData, repositoryGroupId, worktreeToken);
    const missingTarget = await recoverWorktreeProfilePath(userData, repositoryGroupId, worktreeToken);
    expect(missingTarget).toEqual({ targetPath: prepared.targetPath, exists: false });

    await mkdir(prepared.targetPath);
    await expect(recoverWorktreeProfilePath(userData, repositoryGroupId, worktreeToken)).resolves.toEqual({
      targetPath: prepared.targetPath,
      exists: true
    });
  });

  it("rejects symlinked recovery roots, Repository roots, and targets", async () => {
    const repositoryGroupId = `repo_${"d".repeat(32)}`;
    const worktreeToken = "d1d2d3d4d5d6d7d8";
    const directoryLinkType = process.platform === "win32" ? "junction" : "dir";

    const rootUserData = await temporaryRoot();
    const rootOutside = await temporaryRoot();
    await symlink(rootOutside, join(rootUserData, "worktrees"), directoryLinkType);
    await expect(recoverWorktreeProfilePath(rootUserData, repositoryGroupId, worktreeToken))
      .rejects.toThrow("not a real directory");

    const groupUserData = await temporaryRoot();
    const groupOutside = await temporaryRoot();
    await mkdir(join(groupUserData, "worktrees"));
    await symlink(groupOutside, join(groupUserData, "worktrees", repositoryGroupId), directoryLinkType);
    await expect(recoverWorktreeProfilePath(groupUserData, repositoryGroupId, worktreeToken))
      .rejects.toThrow("not a real directory");

    const targetUserData = await temporaryRoot();
    const targetOutside = await temporaryRoot();
    await mkdir(join(targetUserData, "worktrees", repositoryGroupId), { recursive: true });
    await symlink(
      targetOutside,
      join(targetUserData, "worktrees", repositoryGroupId, worktreeToken),
      directoryLinkType
    );
    await expect(recoverWorktreeProfilePath(targetUserData, repositoryGroupId, worktreeToken))
      .rejects.toThrow("not a real directory");
  });

  it("rejects invalid recovery identities before resolving profile paths", async () => {
    const userData = await temporaryRoot();
    await expect(recoverWorktreeProfilePath(userData, "../repo", "a1b2c3d4e5f6g7h8"))
      .rejects.toThrow("identity is invalid");
    await expect(recoverWorktreeProfilePath(userData, `repo_${"e".repeat(32)}`, "../worktree"))
      .rejects.toThrow("identity is invalid");
    await expect(recoverWorktreeProfilePath("relative/user-data", `repo_${"e".repeat(32)}`, "e1e2e3e4e5e6e7e8"))
      .rejects.toThrow("root is invalid");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-worktree-profile-"));
  roots.push(root);
  return root;
}
