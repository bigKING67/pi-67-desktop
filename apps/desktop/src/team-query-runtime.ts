import type { KeyObject } from "node:crypto";
import { release } from "node:os";
import { admitOpenVikingRuntime } from "./openviking-runtime-admission.js";
import { locateTeamQueryBootstrap } from "./team-worker-bootstrap.js";

/** Main-only runtime evidence, not read/model authority or a process launch.
 * No profile, settings, staging or private runtime is created or consulted here.
 * The owner must keep the installation unchanged through the subsequent spawn.
 */
export async function prepareTeamQueryRuntime(options: {
  trustedKey: KeyObject;
  loadRuntime(this: void, signal: AbortSignal): Promise<{ runtimeRoot: string; manifest: Buffer; signature: Buffer }>;
}, lifetime: AbortSignal) {
  const { trustedKey, loadRuntime } = options;
  lifetime.throwIfAborted();
  if (process.platform !== "darwin" || process.arch !== "arm64" || Number.parseInt(release(), 10) < 23) {
    throw new Error("Team query runtime requires macOS 14+ Apple Silicon.");
  }
  const admit = async (signal: AbortSignal) => {
    const bounded = AbortSignal.any([lifetime, signal, AbortSignal.timeout(30_000)]);
    const runtime = await admitOpenVikingRuntime(await loadRuntime(bounded), trustedKey, bounded);
    const bootstrap = await locateTeamQueryBootstrap(runtime.runtimeRoot, bounded);
    bounded.throwIfAborted();
    return { ...runtime, bootstrap };
  };
  const prepared = await admit(lifetime);
  return Object.freeze({ python: prepared.python, bootstrap: prepared.bootstrap,
    async assertLaunchable(signal: AbortSignal) {
      const current = await admit(signal);
      if (current.runtimeRoot !== prepared.runtimeRoot || current.python !== prepared.python
          || current.tree.sha256 !== prepared.tree.sha256 || current.bootstrap !== prepared.bootstrap) {
        throw new Error("Team query runtime changed after preparation.");
      }
      lifetime.throwIfAborted(); signal.throwIfAborted();
    }
  });
}
