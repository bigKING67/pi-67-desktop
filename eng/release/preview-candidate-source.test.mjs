import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPreviewCandidateSource } from "./preview-candidate-source.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("preview candidate source", () => {
  it("accepts an exact checkout that is reachable from main", async () => {
    const fixture = await gitFixture();
    const result = await verifyPreviewCandidateSource({
      root: fixture.root,
      sourceCommit: fixture.candidate
    });
    expect(result).toMatchObject({
      mainCommit: fixture.main,
      sourceCommit: fixture.candidate,
      tag: "v0.1.0-alpha.10",
      version: "0.1.0-alpha.10"
    });
  });

  it("rejects a mismatched or non-canonical source", async () => {
    const fixture = await gitFixture();
    await expect(verifyPreviewCandidateSource({
      root: fixture.root,
      sourceCommit: fixture.main
    })).rejects.toThrow("does not match requested source");
    await expect(verifyPreviewCandidateSource({
      root: fixture.root,
      sourceCommit: "main"
    })).rejects.toThrow("full lowercase Git commit SHA");
  });
});

async function gitFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-preview-source-"));
  temporaryDirectories.push(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.1.0-alpha.10" }));
  git(root, ["add", "package.json"]);
  git(root, ["commit", "-m", "candidate"]);
  const candidate = git(root, ["rev-parse", "HEAD"]);
  await writeFile(join(root, "marker.txt"), "main advanced\n");
  git(root, ["add", "marker.txt"]);
  git(root, ["commit", "-m", "main"]);
  const main = git(root, ["rev-parse", "HEAD"]);
  git(root, ["update-ref", "refs/remotes/origin/main", main]);
  git(root, ["checkout", "--detach", candidate]);
  return { candidate, main, root };
}

function git(cwd, arguments_) {
  return execFileSync("git", arguments_, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
