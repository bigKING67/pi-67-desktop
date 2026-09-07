import { lstat, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { GitInspectionError } from "./worktree-git-contract.js";
import { isContainedPath, parseConfiguredFilters, parseSinglePath, parseSubmodulePathConfiguration } from "./worktree-git-runner-support.js";

type Execute = (cwd: string, args: string[], acceptedExitCodes?: readonly number[]) => Promise<string>;

// Preparation never attaches a .git file to the target. Git's own submodule
// helper therefore retains its just-cloned checkout semantics, even at equal HEAD.
export async function initializeAdmittedSubmodules(input: {
  cwd: string;
  mode: "local-only" | "network-explicit";
  local?: { overrides: string[]; paths: string[] };
  execute: Execute;
}): Promise<void> {
  const transports = input.mode === "local-only"
    ? ["-c", "protocol.allow=never", "-c", "protocol.file.allow=always"]
    : ["-c", "protocol.allow=never", ...["http", "https", "ssh", "git"].flatMap((name) => ["-c", `protocol.${name}.allow=always`]), "-c", "protocol.file.allow=never"];
  const prefix = ["--no-optional-locks", "-c", "core.longpaths=true", "-c", "core.hooksPath=/dev/null", "-c", "submodule.recurse=false", ...transports];
  const run: Execute = (cwd, args, accepted) => input.execute(cwd, [...prefix, ...args], accepted);
  let count = 0;
  const visit = async (cwd: string, depth: number): Promise<void> => {
    const output = await run(cwd, ["config", "--file", ".gitmodules", "--null", "--get-regexp", "^submodule\\..*\\.path$"], [0, 1]);
    const entries = parseSubmodulePathConfiguration(output);
    if (entries.length === 0) return;
    if (entries.length > 128) throw new GitInspectionError("submodule-update", "output-limit");
    if (new Set(entries.map((entry) => entry.name)).size !== entries.length
      || new Set(entries.map((entry) => entry.path)).size !== entries.length) {
      throw new GitInspectionError("submodule-update", "invalid-output");
    }
    const activeConfig = input.mode === "network-explicit"
      ? await run(cwd, ["config", "--null", "--get-all", "submodule.active"], [0, 1]) : "";
    let activePaths: Set<string> | undefined;
    if (activeConfig) {
      // submodule status limits output to gitlinks even for broad pathspecs.
      // Compare Git's own cached status labels instead of parsing quoted paths.
      const selected = new Set((await run(cwd, ["submodule", "status", "--cached", "--", ...activeConfig.split("\0").slice(0, -1)], [0, 1])).split("\n").filter(Boolean));
      const labels = new Set<string>();
      activePaths = new Set();
      for (const entry of entries) {
        if (/[\r\n]/u.test(entry.path)) throw new GitInspectionError("submodule-update", "invalid-output");
        const label = (await run(cwd, ["submodule", "status", "--cached", "--", entry.path])).replace(/\n$/u, "");
        if (!label || label.includes("\n") || labels.has(label)) throw new GitInspectionError("submodule-update", "invalid-output");
        labels.add(label);
        if (selected.has(label)) activePaths.add(entry.path);
      }
    }
    for (const entry of entries) {
      if (input.mode === "local-only" && !input.local?.paths.includes(entry.path)) continue;
      if (input.mode === "network-explicit") {
        const active = (await run(cwd, ["config", "--type=bool", "--get", `submodule.${entry.name}.active`], [0, 1])).trim();
        if (active === "false" || (active !== "true" && activePaths && !activePaths.has(entry.path))) continue;
      }
      if (++count > 128 || depth > 8) throw new GitInspectionError("submodule-update", "output-limit");
      const index = await run(cwd, ["ls-files", "--stage", "-z", "--", entry.path]);
      const records = index.split("\0");
      const record = /^160000 [0-9a-f]{40} 0\t([\s\S]+)$/u.exec(records[0] ?? "");
      if (records.length !== 2 || records[1] !== "" || record?.[1] !== entry.path) throw new GitInspectionError("submodule-update", "invalid-output");
      const target = resolve(cwd, entry.path);
      await assertDirectoryPath(cwd, target);
      let gitDirectory = parseSinglePath(await run(cwd, ["rev-parse", "--path-format=absolute", "--git-path", `modules/${entry.name}`]), "submodule-update");
      const gitFile = join(target, ".git");
      const attached = await exists(gitFile);
      if (attached) {
        const info = await lstat(gitFile);
        if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new GitInspectionError("submodule-update", "invalid-output");
        const actual = parseSinglePath(await run(target, ["rev-parse", "--absolute-git-dir"]), "submodule-update");
        const top = parseSinglePath(await run(target, ["rev-parse", "--show-toplevel"]), "submodule-update");
        const expected = info.isDirectory() ? gitFile : gitDirectory;
        if (resolve(actual) !== resolve(expected) || resolve(top) !== target) throw new GitInspectionError("submodule-update", "invalid-output");
        gitDirectory = actual;
      } else {
        const moduleRoot = parseSinglePath(await run(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "modules"]), "submodule-update");
        await assertDirectoryPath(moduleRoot, gitDirectory);
      }
      const overrides = input.mode === "local-only" ? input.local!.overrides : [];
      // init resolves relative URLs through Git rather than duplicating its rules.
      await run(cwd, [...overrides, "submodule", "init", "--", entry.path]);
      if (!(await exists(gitDirectory))) {
        const url = (await run(cwd, [...overrides, "config", "--get", `submodule.${entry.name}.url`])).trimEnd();
        if (!url || url.includes("\n") || url.includes("\0")) throw new GitInspectionError("submodule-update", "invalid-output");
        await mkdir(dirname(gitDirectory), { recursive: true });
        await run(cwd, ["clone", "--bare", "--", url, gitDirectory]);
      }
      const childContext = [`--git-dir=${gitDirectory}`, `--work-tree=${target}`];
      const filters = await run(cwd, [...childContext, "config", "--null", "--get-regexp", "^filter\\..*\\.(process|smudge|clean|required)$"], [0, 1]);
      if (parseConfiguredFilters(filters).unknownFilterNames.length > 0) {
        // Ordinary incomplete is safe: no checkout has occurred and no target
        // registration was fabricated by preparation.
        throw new GitInspectionError("submodule-update", "process-failed", { cleanupConfirmed: true });
      }
      const bare = (await run(cwd, [...childContext, "config", "--get", "core.bare"])).trim();
      if (bare === "true") {
        if (attached) throw new GitInspectionError("submodule-update", "invalid-output");
        await run(cwd, [...childContext, "config", "--local", "core.bare", "false"]);
      } else if (bare !== "false") {
        throw new GitInspectionError("submodule-update", "invalid-output");
      }
      await run(cwd, [...overrides, "submodule", "update", "--init", "--checkout", ...(input.mode === "local-only" ? ["--no-fetch"] : []), "--", entry.path]);
      // No --recursive checkout may bypass the next child's admission.
      if (input.mode === "network-explicit") await visit(target, depth + 1);
    }
  };
  await visit(input.cwd, 0);
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertDirectoryPath(root: string, target: string): Promise<void> {
  if (!isContainedPath(root, target) || root === target) throw new GitInspectionError("submodule-update", "invalid-output");
  // Check the root as well: Git metadata may contain symlinked modules directories.
  let current = root;
  for (const component of ["", ...relative(root, target).split(sep)]) {
    current = component ? join(current, component) : current;
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new GitInspectionError("submodule-update", "invalid-output");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
}
