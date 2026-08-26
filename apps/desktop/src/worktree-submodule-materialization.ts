import type { RepositorySubmoduleObservation } from "@pi67/protocol";
import {
  GitInspectionError,
  type GitSubmoduleInspection,
  type RepositoryMutationGitRunner
} from "./worktree-git-runner.js";

export function observeRepositorySubmodules(
  inspection: GitSubmoduleInspection
): RepositorySubmoduleObservation {
  return {
    ...inspection,
    networkActionRequired: inspection.status === "incomplete"
      && inspection.uninitialized > 0
      && inspection.divergent === 0
      && inspection.conflicted === 0
  };
}

export async function materializeLocalSubmodules(
  runner: RepositoryMutationGitRunner,
  targetPath: string,
  signal: AbortSignal
): Promise<RepositorySubmoduleObservation> {
  let inspection = await runner.inspectSubmodules(targetPath, signal);
  if (inspection.uninitialized > 0 && inspection.divergent === 0 && inspection.conflicted === 0) {
    try {
      await runner.initializeSubmodules(targetPath, "local-only", signal);
    } catch (error) {
      if (!(error instanceof GitInspectionError && error.code === "process-failed")) throw error;
    }
    inspection = await runner.inspectSubmodules(targetPath, signal);
  }
  return observeRepositorySubmodules(inspection);
}
