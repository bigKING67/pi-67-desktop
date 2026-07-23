import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export async function canonicalizePotentialPath(value: string, workspace: string): Promise<string> {
  let candidate = isAbsolute(value) ? resolve(value) : resolve(workspace, value);
  const missing: string[] = [];
  for (;;) {
    try {
      await lstat(candidate);
      candidate = await realpath(candidate);
      break;
    } catch (error) {
      if (!isErrorWithCode(error) || error.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missing.unshift(candidate.slice(parent.length).replace(/^[/\\]+/, ""));
      candidate = parent;
    }
  }
  return resolve(candidate, ...missing);
}

export function isContained(candidate: string, workspace: string): boolean {
  const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const normalizedWorkspace = process.platform === "win32" ? workspace.toLowerCase() : workspace;
  const pathFromWorkspace = relative(normalizedWorkspace, normalizedCandidate);
  return pathFromWorkspace === "" || (
    !pathFromWorkspace.startsWith(`..${sep}`) &&
    pathFromWorkspace !== ".." &&
    !isAbsolute(pathFromWorkspace)
  );
}

function isErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
