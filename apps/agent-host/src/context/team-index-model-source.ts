import { resolveLocalMemoryExtractionModel, type PiConfigurationService } from "@pi67/pi-runtime";
import type { TeamIndexSettings } from "@pi67/protocol";
import { assertTeamIndexModel, createTeamIndexModelTransport } from "./team-index-model-transport.js";

export interface TeamIndexModels {
  models: { embedding: { baseUrl: string; id: string }; extraction: { baseUrl: string; id: string } };
  embeddingDimension: number;
  invoke: ReturnType<typeof createTeamIndexModelTransport>;
}

/** Snapshot at creation, resolve once per index under its owner lifetime. Pi is
 * the extraction catalog/auth authority; no direct auth.json access or fallback.
 * The returned metadata is credential-free; only the invoke closure holds keys. */
export function createTeamIndexModelSource(
  configuration: Pick<PiConfigurationService, "createModelRuntime">,
  input: TeamIndexSettings
): (signal: AbortSignal) => Promise<TeamIndexModels> {
  const settings = { extraction: { ...input.extraction }, embedding: { ...input.embedding } };
  return async signal => {
    try {
      signal.throwIfAborted();
      assertTeamIndexModel(settings.embedding);
      const dimension = settings.embedding.dimension;
      if (!Number.isSafeInteger(dimension) || dimension < 4 || dimension > 4096 || dimension % 4
        || !settings.extraction.provider.trim() || settings.extraction.provider.length > 256
        || !settings.extraction.model.trim() || settings.extraction.model.length > 512) throw new Error();
      const resolutionSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
      const extraction = await resolveLocalMemoryExtractionModel(configuration, settings.extraction, resolutionSignal);
      resolutionSignal.throwIfAborted();
      const invoke = createTeamIndexModelTransport({ embedding: settings.embedding, extraction }, signal);
      return { models: {
        embedding: { baseUrl: settings.embedding.endpoint, id: settings.embedding.model },
        extraction: { baseUrl: extraction.endpoint, id: extraction.model }
      }, embeddingDimension: dimension, invoke };
    } catch { throw new Error("Team index model configuration unavailable."); }
  };
}
