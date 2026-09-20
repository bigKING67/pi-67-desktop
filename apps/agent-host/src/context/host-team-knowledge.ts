import type { ContextMemoryCommandRouter } from "./context-memory-command-router.js";
import { createTeamQueryEmbedding } from "./team-query-embedding.js";
import { createHostTeamIndex } from "./host-team-index.js";
import type { TeamKnowledgeAccess } from "@pi67/pi-runtime";

export function canonicalTeamKnowledgeFromEnvironment(environment: NodeJS.ProcessEnv): boolean {
  const mode = environment.PI67_CANONICAL_TEAM_KNOWLEDGE;
  if (mode === "1") return true;
  if (mode === undefined || mode === "0") return false;
  throw new Error("Invalid Main-selected team knowledge mode.");
}

/** Internal index/query/body composition. Session variants freshly admit the
 * Agent model; Pi still owns birth provenance, selection and history validation. */
export function createHostTeamKnowledge(options: Omit<Parameters<typeof createHostTeamIndex>[0], "owner"> & {
  owner: ContextMemoryCommandRouter["teamKnowledge"];
}) {
  const loadEmbedding = async (signal: AbortSignal) => {
    if (!options.isAvailable() || !options.settings) throw new Error("Team query unavailable.");
    const snapshot = await options.settings.load(signal); signal.throwIfAborted();
    return createTeamQueryEmbedding(snapshot.embedding, signal);
  };
  const session = {
    search: (input: Omit<Parameters<typeof options.owner.searchSessionKnowledge>[0], "loadEmbedding">) => {
      if (!options.isAvailable() || !options.settings) return Promise.reject(new Error("Team Session query unavailable."));
      return options.owner.searchSessionKnowledge({ ...input, signal: AbortSignal.any([input.signal, options.settings.signal]), loadEmbedding });
    },
    read: (input: Parameters<typeof options.owner.readSessionKnowledge>[0]) => {
      if (!options.isAvailable() || !options.settings) return Promise.reject(new Error("Team Session body unavailable."));
      return options.owner.readSessionKnowledge({ ...input, signal: AbortSignal.any([input.signal, options.settings.signal]) });
    }
  };
  return { index: createHostTeamIndex(options), session,
    forWorkspace: (workspaceId: string): TeamKnowledgeAccess => ({
      search: input => session.search({ ...input, workspaceId }), read: input => session.read({ ...input, workspaceId })
    }),
    embed: (input: Omit<Parameters<typeof options.owner.embedKnowledgeQuery>[0], "loadEmbedding">) => {
      if (!options.isAvailable() || !options.settings) return Promise.reject(new Error("Team query embedding unavailable."));
      return options.owner.embedKnowledgeQuery({ ...input, signal: AbortSignal.any([input.signal, options.settings.signal]), loadEmbedding });
    },
    search: (input: Omit<Parameters<typeof options.owner.searchKnowledge>[0], "loadEmbedding">) => {
      if (!options.isAvailable() || !options.settings) return Promise.reject(new Error("Team query unavailable."));
      return options.owner.searchKnowledge({ ...input, signal: AbortSignal.any([input.signal, options.settings.signal]), loadEmbedding });
    },
    read: (input: Parameters<typeof options.owner.readKnowledge>[0]) => {
      if (!options.isAvailable() || !options.settings) return Promise.reject(new Error("Team body read unavailable."));
      return options.owner.readKnowledge({ ...input, signal: AbortSignal.any([input.signal, options.settings.signal]) });
    } };
}
