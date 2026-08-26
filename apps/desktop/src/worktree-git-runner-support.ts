import { dirname, delimiter, isAbsolute, relative, sep } from "node:path";
import {
  GitInspectionError,
  type GitFilterInspection,
  type GitInspectionStage,
  type GitSubmoduleInspection,
  type GitWorktreeRecord
} from "./worktree-git-contract.js";

export function parseSubmoduleStatus(output: string): GitSubmoduleInspection {
  if (output.length === 0) {
    return { status: "not-configured", total: 0, uninitialized: 0, divergent: 0, conflicted: 0 };
  }
  const lines = output.split(/\r?\n/u).filter((line) => line.length > 0);
  let uninitialized = 0;
  let divergent = 0;
  let conflicted = 0;
  for (const line of lines) {
    if (!/^[-+ U][0-9a-f]{40}\s/u.test(line)) {
      throw new GitInspectionError("submodule-status", "invalid-output");
    }
    if (line[0] === "-") uninitialized += 1;
    else if (line[0] === "+") divergent += 1;
    else if (line[0] === "U") conflicted += 1;
  }
  const status = conflicted > 0
    ? "conflicted" as const
    : uninitialized > 0 || divergent > 0
      ? "incomplete" as const
      : "complete" as const;
  return { status, total: lines.length, uninitialized, divergent, conflicted };
}

export function parseSubmodulePathConfiguration(output: string): Array<{ name: string; path: string }> {
  if (output.length === 0) return [];
  const entries: Array<{ name: string; path: string }> = [];
  for (const record of output.split("\0").filter(Boolean)) {
    const separator = record.indexOf("\n");
    if (separator <= 0) throw new GitInspectionError("submodule-status", "invalid-output");
    const key = record.slice(0, separator);
    const path = record.slice(separator + 1);
    const match = /^submodule\.(.+)\.path$/u.exec(key);
    const name = match?.[1];
    if (!name || !isSafeSubmoduleIdentifier(name) || !isSafeRelativeSubmodulePath(path)) {
      throw new GitInspectionError("submodule-status", "invalid-output");
    }
    entries.push({ name, path });
  }
  return entries;
}

function isSafeSubmoduleIdentifier(value: string): boolean {
  return value.length <= 512
    && /^[A-Za-z0-9._/-]+$/u.test(value)
    && !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function isSafeRelativeSubmodulePath(value: string): boolean {
  return value.length > 0
    && value.length <= 4_096
    && !value.includes("\0")
    && !isAbsolute(value)
    && !/^[A-Za-z]:[\\/]/u.test(value)
    && !value.split(/[\\/]/u).some((segment) => segment === "" || segment === "." || segment === "..");
}

export function isContainedPath(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

export function assertRelativeGitPath(path: string): void {
  if (
    path.length === 0
    || path.length > 32_768
    || path.includes("\0")
    || path.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(path)
    || path.split(/[\\/]/u).some((segment) => segment === "..")
  ) throw new Error("Git diff path is invalid.");
}

export function parseGitWorktreePorcelain(
  output: string,
  platform: NodeJS.Platform = process.platform
): GitWorktreeRecord[] {
  if (output.length === 0 || !output.includes("\0")) {
    throw new GitInspectionError("worktree-list", "invalid-output");
  }
  const records: GitWorktreeRecord[] = [];
  let current: GitWorktreeRecord | undefined;
  const finish = () => {
    if (!current) return;
    if (!isAbsoluteForPlatform(current.path, platform)) {
      throw new GitInspectionError("worktree-list", "invalid-output");
    }
    records.push(current);
    current = undefined;
  };

  for (const field of output.split("\0")) {
    if (field.length === 0) {
      finish();
      continue;
    }
    if (field.startsWith("worktree ")) {
      finish();
      const path = field.slice("worktree ".length);
      if (path.length === 0 || path.length > 32_768 || path.includes("\0")) {
        throw new GitInspectionError("worktree-list", "invalid-output");
      }
      current = { path, detached: false, locked: false, prunable: false };
      continue;
    }
    if (!current) throw new GitInspectionError("worktree-list", "invalid-output");
    if (field.startsWith("HEAD ")) {
      const headSha = field.slice("HEAD ".length);
      if (!/^[0-9a-f]{40}$/u.test(headSha)) {
        throw new GitInspectionError("worktree-list", "invalid-output");
      }
      current.headSha = headSha;
    } else if (field.startsWith("branch refs/heads/")) {
      const branchName = field.slice("branch refs/heads/".length);
      if (branchName.length === 0 || branchName.length > 512) {
        throw new GitInspectionError("worktree-list", "invalid-output");
      }
      current.branchName = branchName;
    } else if (field === "detached") {
      current.detached = true;
    } else if (field === "locked" || field.startsWith("locked ")) {
      current.locked = true;
    } else if (field === "prunable" || field.startsWith("prunable ")) {
      current.prunable = true;
    } else if (field !== "bare") {
      throw new GitInspectionError("worktree-list", "invalid-output");
    }
  }
  finish();
  if (records.length === 0 || records.length > 100) {
    throw new GitInspectionError("worktree-list", "invalid-output");
  }
  return records;
}

export function parseSinglePath(output: string, stage: GitInspectionStage): string {
  const path = output.replace(/[\r\n]+$/u, "");
  if (
    path.length === 0
    || path.length > 32_768
    || path.includes("\r")
    || path.includes("\n")
    || path.includes("\0")
  ) {
    throw new GitInspectionError(stage, "invalid-output");
  }
  return path;
}

export function parseHeadSha(output: string, stage: GitInspectionStage): string {
  const headSha = output.replace(/[\r\n]+$/u, "");
  if (!/^[0-9a-f]{40}$/u.test(headSha)) throw new GitInspectionError(stage, "invalid-output");
  return headSha;
}

export function parseConfiguredFilters(output: string): GitFilterInspection {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const match = /^filter\.([A-Za-z0-9._-]{1,128})\.(?:process|smudge|required)(?:\s|$)/u.exec(line);
    if (!match?.[1]) throw new GitInspectionError("filters", "invalid-output");
    names.add(match[1]);
  }
  const values = [...names].sort((left, right) => left.localeCompare(right));
  return {
    lfsConfigured: values.includes("lfs"),
    unknownFilterNames: values.filter((name) => name !== "lfs")
  };
}

export function assertMutationIdentity(input: {
  targetPath: string;
  branchName: string;
  headSha: string;
  hooksPath: string;
}, platform: NodeJS.Platform): void {
  assertAbsolutePath(input.targetPath, platform);
  assertAbsolutePath(input.hooksPath, platform);
  assertBranchName(input.branchName);
  if (!/^[0-9a-f]{40}$/u.test(input.headSha)) throw new Error("Git mutation HEAD is invalid.");
}

export function assertAbsolutePath(path: string, platform: NodeJS.Platform): void {
  if (
    path.length === 0
    || path.length > 32_768
    || path.includes("\0")
    || !isAbsoluteForPlatform(path, platform)
  ) throw new Error("Git mutation path is invalid.");
}

export function assertBranchName(branchName: string): void {
  if (!/^pi67\/task-[a-z0-9]{16}$/u.test(branchName)) throw new Error("Git mutation branch is invalid.");
}

export function privateGitEnvironment(executable: string, gitExecPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [dirname(executable), process.env.PATH].filter(Boolean).join(delimiter),
    GIT_EXEC_PATH: gitExecPath,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    LANG: "C",
    LC_ALL: "C"
  };
}

function isAbsoluteForPlatform(path: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") return /^[A-Za-z]:[\\/]/u.test(path) || /^\\\\[^\\]+\\[^\\]+/u.test(path);
  return path.startsWith("/");
}
