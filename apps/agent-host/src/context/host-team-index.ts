import type { PiConfigurationService } from "@pi67/pi-runtime";
import type { ContextMemoryCommandRouter } from "./context-memory-command-router.js";
import type { TeamIndexSettingsClient } from "./team-index-settings-client.js";
import type { TeamWorkerBrokerClient } from "./team-worker-broker-client.js";
import type { TeamModelPortAdmission } from "./team-model-port-admission.js";
import { createTeamIndexModelSource } from "./team-index-model-source.js";

/** Production Host composition; no Renderer command or automatic sync trigger.
 * The index owner captures settings invalidation before the first await, so it
 * covers configuration/authorization, preparation, worker execution and cleanup. */
export function createHostTeamIndex(options: {
  configuration: Pick<PiConfigurationService, "createModelRuntime">;
  settings: TeamIndexSettingsClient | undefined;
  workers: TeamWorkerBrokerClient | undefined;
  admission: TeamModelPortAdmission;
  owner: Pick<ContextMemoryCommandRouter["teamKnowledge"], "indexKnowledge">;
  isAvailable(this: void): boolean;
}) {
  const { settings, workers, configuration, admission, owner } = options;
  return (input: { teamId: string; projectId: string | null; workspaceId?: string; signal: AbortSignal }) => {
    if (!options.isAvailable() || !settings || !workers) return Promise.reject(new Error("Team indexing unavailable."));
    return owner.indexKnowledge(admission, workers, { ...input,
      signal: AbortSignal.any([input.signal, settings.signal]), loadModels: async signal => {
        const snapshot = await settings.load(signal); signal.throwIfAborted();
        return createTeamIndexModelSource(configuration, snapshot)(signal);
      } });
  };
}
