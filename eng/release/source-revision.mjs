import { execFileSync } from "node:child_process";

export function resolveSourceState() {
  let revision = process.env.PI67_SOURCE_REVISION ?? process.env.GITHUB_SHA ?? null;
  if (revision !== null && !/^[0-9a-f]{40}$/iu.test(revision)) {
    throw new Error("PI67_SOURCE_REVISION/GITHUB_SHA must be a full 40-character commit SHA");
  }
  revision = revision?.toLowerCase() ?? null;

  if (revision === null) {
    try {
      revision = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim().toLowerCase();
    } catch {
      revision = "uncommitted-source";
    }
  }
  if (revision !== "uncommitted-source" && !/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error("Resolved source revision must be a full 40-character commit SHA");
  }

  let dirty = null;
  try {
    dirty = execFileSync("git", ["status", "--porcelain=v1"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim().length > 0;
  } catch {
    // A source archive has no Git worktree, so its dirty state is unknowable.
  }
  return { revision, dirty };
}
