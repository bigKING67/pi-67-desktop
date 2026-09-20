import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { UtilityProcess } from "electron";
import { installNativeTeamFixture } from "../../apps/desktop/src/team-runtime-native.test-support.js";
import { loadLocalMemoryIdentity } from "../../apps/desktop/src/local-memory-identity.mjs";
import { TeamWorkerSupervisor } from "../../apps/desktop/src/team-worker-supervisor.js";
import { TeamIndexHeadClient } from "../../apps/desktop/src/team-index-head-client.js";
import { startNativeTeamModelWorker } from "../../apps/desktop/src/native-team-model-worker.mjs";
import { captureTeamIndexArtifact } from "../../apps/desktop/src/team-index-artifact.js";
import type { SharedKnowledgeReceiptBroker } from "../../apps/desktop/src/shared-knowledge-receipt-broker.js";
import { liveRecord } from "./shared-knowledge-live-fixture.js";

/** Test-only full installation and real Main scheduler. No production trust key
 * or existing profile is read; preparation finishes before the live API window. */
export async function prepareLiveNative(memoryRoot: string, python: string, bootstrapDirectory: string) {
  await mkdir(memoryRoot, { mode: 0o700 });
  const localProfileId = await loadLocalMemoryIdentity(memoryRoot);
  const installed = await installNativeTeamFixture(python, memoryRoot, AbortSignal.timeout(180_000), bootstrapDirectory);
  return { localProfileId, compose(currentHost: () => UtilityProcess | undefined) {
    const pids: number[] = [];
    const workers = new TeamWorkerSupervisor(currentHost, async (options, signal) => {
      const worker = await startNativeTeamModelWorker(options, signal); pids.push(worker.pid);
      void worker.completion.then(result => console.error(`LIVE_NATIVE_WORKER: code=${result.code ?? -1}`),
        () => console.error("LIVE_NATIVE_WORKER: code=-2"));
      return worker;
    });
    const heads = new TeamIndexHeadClient(currentHost);
    const dependencies: Pick<ConstructorParameters<typeof SharedKnowledgeReceiptBroker>[0], "prepareIndex" | "queryConfiguration" | "revalidateIndex"> = {
      prepareIndex: input => workers.indexJobs.prepare(installed.teamPreparation, input),
      queryConfiguration: () => ({ memoryRoot, prepareRuntime: signal => installed.teamQuery.prepareRuntime(signal) }),
      revalidateIndex: (input, signal) => heads.verify(input, signal)
    };
    return { dependencies,
      handleMessage(host: UtilityProcess, value: unknown) { return workers.handleMessage(host, value) || heads.handleMessage(host, value); },
      async capturePublished(scopeKey: string) {
        assert.ok(pids.length > 0);
        const owner = join(memoryRoot, "team-projections", scopeKey);
        const pointer = liveRecord(JSON.parse(await readFile(join(owner, "current-index.json"), "utf8")) as unknown);
        assert.ok(typeof pointer.generation === "string" && /^run-[a-zA-Z0-9_-]{1,64}$/u.test(pointer.generation));
        const directory = join(owner, "staging", pointer.generation);
        const artifact = await captureTeamIndexArtifact({ directory, signal: AbortSignal.timeout(300_000), assertCurrent: async () => {} });
        return async () => {
          await artifact.assertUnchanged(false, AbortSignal.timeout(30_000));
          assert.ok(!(await readdir(join(owner, "staging"))).some(name => name.startsWith("query-")));
        };
      },
      async shutdown() {
        heads.retire(); await workers.shutdown();
        for (const pid of pids) assert.throws(() => process.kill(-pid, 0), { code: "ESRCH" });
      },
      async assertInstallation() { await installed.assertUnchanged(AbortSignal.timeout(90_000)); }
    };
  } };
}
