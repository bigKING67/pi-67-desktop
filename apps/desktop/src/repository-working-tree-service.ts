import { createHash, randomBytes } from "node:crypto";
import {
  MAX_REPOSITORY_CHANGES,
  MAX_REPOSITORY_DIFF_CHARS,
  type RepositoryChangeDetail,
  type RepositoryChangeKind,
  type RepositoryWorkingTreeChange,
  type RepositoryWorkingTreeSnapshot
} from "@pi67/protocol";
import type { WorkbenchStateV5 } from "./workbench-state-contract.js";
import type { RepositoryWorkingTreeGitRunner } from "./worktree-git-contract.js";

interface WorkbenchStateReader {
  load(): Promise<{ state: WorkbenchStateV5 }>;
}

interface AuthoritativeChange {
  path: string;
  previousPath?: string;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  kind: RepositoryChangeKind;
}

interface InstalledSnapshot {
  cwd: string;
  revision: number;
  statusFingerprint: string;
  changes: Map<string, AuthoritativeChange>;
}

export class RepositoryWorkingTreeService {
  readonly #runner: RepositoryWorkingTreeGitRunner;
  readonly #workbenchState: WorkbenchStateReader;
  readonly #now: () => number;
  readonly #snapshots = new Map<string, InstalledSnapshot>();
  readonly #revisions = new Map<string, number>();
  #disposed = false;

  constructor(options: {
    runner: RepositoryWorkingTreeGitRunner;
    workbenchState: WorkbenchStateReader;
    now?: () => number;
  }) {
    this.#runner = options.runner;
    this.#workbenchState = options.workbenchState;
    this.#now = options.now ?? Date.now;
  }

  async inspect(value: { workspaceId: string }): Promise<RepositoryWorkingTreeSnapshot> {
    this.#assertActive();
    const cwd = await this.#workspacePath(value.workspaceId);
    await this.#runner.resolveRepositoryRoot(cwd);
    const [headSha, rawStatus] = await Promise.all([
      this.#runner.resolveHeadSha(cwd).catch(() => undefined),
      this.#runner.statusPorcelain(cwd)
    ]);
    const parsed = parseGitStatusPorcelainV2(rawStatus);
    const revision = Math.min(Number.MAX_SAFE_INTEGER, (this.#revisions.get(value.workspaceId) ?? 0) + 1);
    const installed = new Map<string, AuthoritativeChange>();
    const changes = parsed.changes.slice(0, MAX_REPOSITORY_CHANGES).map((change): RepositoryWorkingTreeChange => {
      const changeId = `chg_${randomBytes(16).toString("hex")}`;
      installed.set(changeId, change);
      return {
        changeId,
        displayPath: change.path,
        ...(change.previousPath ? { previousDisplayPath: change.previousPath } : {}),
        kind: change.kind,
        staged: change.staged,
        unstaged: change.unstaged,
        conflicted: change.conflicted
      };
    });
    this.#revisions.set(value.workspaceId, revision);
    this.#snapshots.set(value.workspaceId, {
      cwd,
      revision,
      statusFingerprint: sha256(rawStatus),
      changes: installed
    });
    return {
      workspaceId: value.workspaceId,
      revision,
      observedAt: this.#now(),
      ...(headSha ? { headSha } : {}),
      changes,
      truncated: parsed.changes.length > changes.length
    };
  }

  async detail(value: {
    workspaceId: string;
    revision: number;
    changeId: string;
  }): Promise<RepositoryChangeDetail> {
    this.#assertActive();
    const snapshot = this.#snapshots.get(value.workspaceId);
    if (!snapshot || snapshot.revision !== value.revision) {
      throw new Error("Repository change snapshot is stale; refresh before reading the diff.");
    }
    const change = snapshot.changes.get(value.changeId);
    if (!change) throw new Error("Repository change identity is stale or unknown.");
    const cwd = await this.#workspacePath(value.workspaceId);
    if (cwd !== snapshot.cwd) throw new Error("Workspace identity changed; refresh repository changes.");
    await this.#assertStatusCurrent(snapshot);

    const staged = change.staged
      ? await this.#runner.diffPath(cwd, change.path, "staged")
      : undefined;
    const unstaged = change.conflicted
      ? await this.#runner.diffPath(cwd, change.path, "conflict")
      : change.kind === "untracked"
        ? await this.#runner.diffPath(cwd, change.path, "untracked")
        : change.unstaged
          ? await this.#runner.diffPath(cwd, change.path, "unstaged")
          : undefined;
    await this.#assertStatusCurrent(snapshot);
    const fullFingerprint = sha256(`${staged ?? ""}\0${unstaged ?? ""}`);
    const bounded = boundPatches(staged, unstaged);
    return {
      workspaceId: value.workspaceId,
      revision: value.revision,
      changeId: value.changeId,
      contentFingerprint: fullFingerprint,
      ...(bounded.stagedPatch === undefined ? {} : { stagedPatch: bounded.stagedPatch }),
      ...(bounded.unstagedPatch === undefined ? {} : { unstagedPatch: bounded.unstagedPatch }),
      truncated: bounded.truncated
    };
  }

  removeWorkspace(workspaceId: string): void {
    this.#snapshots.delete(workspaceId);
    this.#revisions.delete(workspaceId);
  }

  diagnostics(): { cachedSnapshotCount: number; disposed: boolean } {
    return { cachedSnapshotCount: this.#snapshots.size, disposed: this.#disposed };
  }

  dispose(): void {
    this.#disposed = true;
    this.#snapshots.clear();
  }

  async #assertStatusCurrent(snapshot: InstalledSnapshot): Promise<void> {
    const current = await this.#runner.statusPorcelain(snapshot.cwd);
    if (sha256(current) !== snapshot.statusFingerprint) {
      throw new Error("Repository changed after the snapshot; refresh before reading the diff.");
    }
  }

  async #workspacePath(workspaceId: string): Promise<string> {
    const workbench = await this.#workbenchState.load();
    const workspace = workbench.state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace || workspace.availability !== "available") {
      throw new Error("Workspace is unavailable for repository inspection.");
    }
    return workspace.identity.canonicalPath;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Repository change inspection is shutting down.");
  }
}

export function parseGitStatusPorcelainV2(raw: string): {
  changes: AuthoritativeChange[];
} {
  const records = raw.split("\0");
  const changes: AuthoritativeChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.startsWith("# ") || record.startsWith("! ")) continue;
    if (record.startsWith("? ")) {
      changes.push({
        path: assertGitDisplayPath(record.slice(2)),
        kind: "untracked",
        staged: false,
        unstaged: true,
        conflicted: false
      });
      continue;
    }
    if (record.startsWith("1 ")) {
      const { fields, remainder: path } = splitStatusPrefix(record, 8);
      changes.push(statusChange(assertGitDisplayPath(path), fields[1] ?? ".."));
      continue;
    }
    if (record.startsWith("2 ")) {
      const { fields, remainder: path } = splitStatusPrefix(record, 9);
      const previousPath = records[++index];
      if (!previousPath) throw new Error("Git rename status omitted its previous path.");
      changes.push(statusChange(
        assertGitDisplayPath(path),
        fields[1] ?? "..",
        assertGitDisplayPath(previousPath)
      ));
      continue;
    }
    if (record.startsWith("u ")) {
      const { remainder: path } = splitStatusPrefix(record, 10);
      changes.push({
        path: assertGitDisplayPath(path),
        kind: "conflict",
        staged: true,
        unstaged: true,
        conflicted: true
      });
      continue;
    }
    throw new Error("Git returned an unsupported status record.");
  }
  changes.sort((left, right) => left.path.localeCompare(right.path));
  return { changes };
}

function statusChange(path: string, xy: string, previousPath?: string): AuthoritativeChange {
  if (!/^[. MADRCU?!]{2}$/u.test(xy)) throw new Error("Git returned an invalid status code.");
  const stagedCode = xy[0] ?? ".";
  const unstagedCode = xy[1] ?? ".";
  const conflicted = stagedCode === "U" || unstagedCode === "U";
  return {
    path,
    ...(previousPath ? { previousPath } : {}),
    kind: conflicted ? "conflict" : statusKind(stagedCode, unstagedCode, previousPath),
    staged: stagedCode !== "." && stagedCode !== " ",
    unstaged: unstagedCode !== "." && unstagedCode !== " ",
    conflicted
  };
}

function statusKind(staged: string, unstaged: string, previousPath?: string): RepositoryChangeKind {
  const codes = `${staged}${unstaged}`;
  if (codes.includes("R") || previousPath) return "renamed";
  if (codes.includes("C")) return "copied";
  if (codes.includes("A")) return "added";
  if (codes.includes("D")) return "deleted";
  return "modified";
}

function splitStatusPrefix(value: string, fieldCount: number): { fields: string[]; remainder: string } {
  const fields: string[] = [];
  let offset = 0;
  while (fields.length < fieldCount) {
    const next = value.indexOf(" ", offset);
    if (next < 0) throw new Error("Git status record is incomplete.");
    fields.push(value.slice(offset, next));
    offset = next + 1;
  }
  return { fields, remainder: value.slice(offset) };
}

function assertGitDisplayPath(value: string): string {
  if (
    value.length === 0
    || value.length > 4_096
    || value.includes("\0")
    || value.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(value)
    || value.split(/[\\/]/u).some((segment) => segment === "..")
  ) throw new Error("Git status path is outside the supported boundary.");
  return value;
}

function boundPatches(stagedPatch: string | undefined, unstagedPatch: string | undefined): {
  stagedPatch?: string;
  unstagedPatch?: string;
  truncated: boolean;
} {
  let remaining = MAX_REPOSITORY_DIFF_CHARS;
  const staged = stagedPatch?.slice(0, remaining);
  remaining -= staged?.length ?? 0;
  const unstaged = unstagedPatch?.slice(0, remaining);
  return {
    ...(staged === undefined ? {} : { stagedPatch: staged }),
    ...(unstaged === undefined ? {} : { unstagedPatch: unstaged }),
    truncated: (stagedPatch?.length ?? 0) > (staged?.length ?? 0)
      || (unstagedPatch?.length ?? 0) > (unstaged?.length ?? 0)
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
