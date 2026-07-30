import { rm } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveManagedSessionPath } from "./session-import.js";

interface CrossRuntimeSessionForkOptions<Result> {
  sourcePath: string;
  entryId: string;
  cwd: string;
  agentDir: string;
  prepare: () => Promise<void>;
  switchSession: (path: string, cwd: string) => Promise<{ cancelled: boolean }>;
  getActiveSessionPath: () => string | undefined;
  commit: () => Promise<Result>;
}

export async function runCrossRuntimeSessionFork<Result>(
  options: CrossRuntimeSessionForkOptions<Result>
): Promise<Result> {
  await options.prepare();
  const managedSourcePath = await resolveManagedSessionPath(
    options.sourcePath,
    options.cwd,
    options.agentDir
  );
  const source = SessionManager.open(managedSourcePath, undefined, options.cwd);
  const forkedPath = source.createBranchedSession(options.entryId);
  if (!forkedPath) throw new Error("Pi did not persist the forked Session.");

  let switched = false;
  try {
    const result = await options.switchSession(forkedPath, source.getCwd());
    if (result.cancelled) throw new Error("A Pi extension cancelled the session fork.");
    switched = true;
    return await options.commit();
  } catch (error) {
    if (!switched && options.getActiveSessionPath() !== forkedPath) {
      await discardCrossRuntimeSessionFork(forkedPath, error);
    }
    throw error;
  }
}

async function discardCrossRuntimeSessionFork(path: string, cause: unknown): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (cleanupError) {
    throw new AggregateError(
      [cause, cleanupError],
      "Pi Session fork failed and its orphaned file could not be removed."
    );
  }
}
