import type { KeyObject } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import type { LocalMemoryModelClient } from "./local-memory-model-client.js";
import { LocalMemoryModelSettingsStore } from "./local-memory-model-settings.js";
import { createLocalMemoryConfigurationLoader } from "./local-memory-configuration-loader.js";
import { LocalMemoryService } from "./local-memory-service.mjs";
import { loadOpenVikingRuntimeInstallation } from "./openviking-runtime-installation.js";
import { openVikingRuntimeTrustedKey } from "./openviking-runtime-trust.js";
import { prepareTeamWorker } from "./team-worker-preparation.js";
import { prepareTeamQueryRuntime } from "./team-query-runtime.js";
import { locateTeamWorkerBootstrap } from "./team-worker-bootstrap.js";
import { admitOpenVikingRuntime } from "./openviking-runtime-admission.js";
import { writeTeamIndexJob } from "./team-index-job.js";
import { writeLocalMemoryStartupReceipt } from "./local-memory-startup.mjs";
import type { SharedKnowledgeReceiptOwner } from "./shared-knowledge-owner.js";

/** Main composition with source-pinned trust, no downloads or implicit Lab adoption. */
export function createInstalledLocalMemory(options: {
  memoryRoot: string;
  installationRoot: string;
  /** Explicit team-only revision; application wiring must never fall back to private. */
  teamInstallationRoot?: string;
  /** Explicit independent query revision; omission disables query admission. */
  queryInstallationRoot?: string;
  trustedKey?: KeyObject;
  encryption: DesktopTextEncryption;
  models: Pick<LocalMemoryModelClient, "resolve">;
}) {
  const { memoryRoot, installationRoot, teamInstallationRoot = installationRoot, trustedKey = openVikingRuntimeTrustedKey(), encryption, models } = options;
  if ([memoryRoot, installationRoot, teamInstallationRoot].some(path => !isAbsolute(path) || path.includes("\0"))) {
    throw new Error("Installed memory requires absolute owned paths.");
  }
  const memory = resolve(memoryRoot);
  const installation = resolve(installationRoot);
  const teamInstallation = resolve(teamInstallationRoot);
  if (options.teamInstallationRoot !== undefined && (teamInstallation === installation
      || teamInstallation.startsWith(`${installation}${sep}`) || installation.startsWith(`${teamInstallation}${sep}`))) {
    throw new Error("Explicit private and team installations must be separate.");
  }
  assertSeparate(memory, installation);
  assertSeparate(memory, teamInstallation);
  const queryInstallation = options.queryInstallationRoot;
  if (queryInstallation !== undefined) {
    if (!isAbsolute(queryInstallation) || queryInstallation.includes("\0")) throw new Error("Query installation requires an absolute path.");
    assertSeparate(memory, resolve(queryInstallation));
    for (const peer of [installation, teamInstallation]) assertDisjoint(resolve(queryInstallation), peer);
  }
  if (trustedKey.type !== "public" || trustedKey.asymmetricKeyType !== "ed25519") throw new Error("A trusted Ed25519 public key is required.");
  const loadFrom = async (selected: string, signal: AbortSignal) => {
    const installed = await loadOpenVikingRuntimeInstallation(selected, signal);
    const physicalMemory = await realpath(memory);
    const physicalInstallation = await realpath(selected);
    assertSeparate(physicalMemory, physicalInstallation);
    return { ...installed, dataRoot: physicalMemory };
  };
  const loadRuntime = (signal: AbortSignal) => loadFrom(installation, signal);
  const loadTeamRuntime = (signal: AbortSignal) => loadFrom(teamInstallation, signal);
  const settings = new LocalMemoryModelSettingsStore(join(memory, "settings"), encryption);
  const service = new LocalMemoryService({ trustedKey, recordStartup: receipt => writeLocalMemoryStartupReceipt(memory, receipt), loadConfiguration: createLocalMemoryConfigurationLoader({
    settings, models, loadRuntime
  }) });
  const prepare = (owner: SharedKnowledgeReceiptOwner, signal: AbortSignal) =>
    prepareTeamWorker({ memoryRoot: memory, trustedKey, loadRuntime: loadTeamRuntime }, owner, signal);
  const teamPreparation = { prepare, writeIndexJob: writeTeamIndexJob, async prepareIndexWorker(owner: SharedKnowledgeReceiptOwner, signal: AbortSignal) {
    const prepared = await prepare(owner, signal);
    try {
      const bootstrap = await locateTeamWorkerBootstrap(prepared.runtime.runtimeRoot, signal);
      await prepared.assertCurrent();
      const assertLaunchable = async (launchSignal: AbortSignal) => {
        const currentSignal = AbortSignal.any([signal, launchSignal]);
        await prepared.assertCurrent();
        const current = await admitOpenVikingRuntime(await loadTeamRuntime(currentSignal), trustedKey, currentSignal);
        if (current.runtimeRoot !== prepared.runtime.runtimeRoot || current.python !== prepared.runtime.python
            || current.tree.sha256 !== prepared.runtime.tree.sha256
            || await locateTeamWorkerBootstrap(current.runtimeRoot, currentSignal) !== bootstrap) {
          throw new Error("Team index runtime changed after preparation.");
        }
        await prepared.assertCurrent(); currentSignal.throwIfAborted();
      };
      return Object.freeze({ ...prepared, bootstrap, assertLaunchable });
    } catch (error) { await prepared.discard(); throw error; }
  } };
  const teamQuery = { async prepareRuntime(signal: AbortSignal) {
    if (queryInstallation === undefined) throw new Error("Team query runtime is not configured.");
    return prepareTeamQueryRuntime({ trustedKey, async loadRuntime(currentSignal) {
      const installed = await loadFrom(queryInstallation, currentSignal);
      const physicalQuery = await realpath(queryInstallation);
      // Lexically separate paths can still share a symlinked ancestor. Do not
      // admit a private/index installation through another path spelling.
      for (const peer of [installation, teamInstallation]) {
        let physicalPeer: string;
        try { physicalPeer = await realpath(peer); }
        catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
          throw error;
        }
        assertDisjoint(physicalQuery, physicalPeer);
      }
      currentSignal.throwIfAborted();
      return installed;
    } }, signal);
  } };
  return { settings, service, teamPreparation, teamQuery };
}

function assertDisjoint(left: string, right: string): void {
  if (left === right || left.startsWith(`${right}${sep}`) || right.startsWith(`${left}${sep}`)) {
    throw new Error("Query, index and private installations must be separate.");
  }
}

function assertSeparate(memory: string, installation: string): void {
  const within = (path: string, root: string) => path === root || path.startsWith(`${root}${sep}`);
  if (within(memory, installation) || ["data", "settings", "team-projections"].some((name) => within(installation, join(memory, name)))) {
    throw new Error("Runtime installation and writable memory state must be separate.");
  }
}
