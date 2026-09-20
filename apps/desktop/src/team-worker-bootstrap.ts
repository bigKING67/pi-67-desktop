import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";

/** Called immediately after full signed-tree admission, only for an unchanged
 * Main-owned runtime. Never accepts an executable path from Host or Renderer. */
export async function locateTeamWorkerBootstrap(runtimeRoot: string, signal: AbortSignal): Promise<string> {
  return locateBootstrap(runtimeRoot, "v1", ["team_index_worker.py", "team_model_transport.py", "team_model_channel.py"], signal);
}

/** Independent signed query revision; an index bootstrap is never a fallback. */
export async function locateTeamQueryBootstrap(runtimeRoot: string, signal: AbortSignal): Promise<string> {
  return locateBootstrap(runtimeRoot, "query/v1", ["team_query_worker.py"], signal);
}

async function locateBootstrap(runtimeRoot: string, revision: string, names: readonly [string, ...string[]], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const root = await realpath(runtimeRoot);
  const directory = join(root, "newmoney-team", revision);
  const directories = [join(root, "newmoney-team")];
  for (const part of revision.split("/")) directories.push(join(directories.at(-1)!, part));
  for (const path of directories) {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o022) !== 0) {
      throw new Error("Unsafe team worker bootstrap directory.");
    }
  }
  for (const name of names) {
    const metadata = await lstat(join(directory, name));
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0 || metadata.size > 64 * 1024 || (metadata.mode & 0o022) !== 0) {
      throw new Error("Invalid team worker bootstrap file.");
    }
  }
  signal.throwIfAborted();
  return join(directory, names[0]);
}
