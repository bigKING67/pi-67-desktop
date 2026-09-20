import type { SessionManager, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TeamSessionIdentity } from "@pi67/domain";
import { createSharedExperienceTools, type SharedExperienceAccess } from "./shared-experience-tools.js";
import { createSharedSopTools, type SharedSopAccess } from "./shared-sop-tools.js";
import { markSharedMemoryProvenance } from "./session-memory-provenance.js";
import { readTeamSessionIdentity } from "./team-session-birth.js";
import { createTeamKnowledgeTools } from "./team-knowledge-tools.js";
import type { TeamKnowledgeAccess } from "./team-knowledge-access.js";

/** Record a conservative durable boundary before any shared transport or result. */
export function createSessionSharedKnowledgeTools(
  experience: SharedExperienceAccess | undefined,
  sop: SharedSopAccess | undefined,
  getManager: () => SessionManager | undefined,
  knowledge?: TeamKnowledgeAccess
): ToolDefinition[] {
  // Select one transport family for this runtime. Legacy readers remain available
  // to history authorization, but must not become model-selectable fallback tools.
  const createTools = (getScope?: () => TeamSessionIdentity) => knowledge
    ? createTeamKnowledgeTools(knowledge, getScope)
    : [...createSharedExperienceTools(experience, getScope), ...createSharedSopTools(sop, getScope)];
  let binding: { manager: SessionManager; sessionId: string; scope: TeamSessionIdentity; tools: ToolDefinition[] } | undefined;
  return createTools().map((tool, index) => ({
    ...tool,
    execute(...args) {
      const manager = getManager();
      if (!manager || manager.getSessionId() !== args[4].sessionManager.getSessionId()) {
        binding = undefined;
        throw new Error("Shared knowledge no longer belongs to the active Pi Session.");
      }
      let scope: TeamSessionIdentity;
      try { scope = readTeamSessionIdentity(manager); } catch (error) {
        binding = undefined; markSharedMemoryProvenance(manager); throw error;
      }
      const sessionId = manager.getSessionId();
      if (!binding || binding.manager !== manager || binding.sessionId !== sessionId || !sameScope(binding.scope, scope)) {
        binding = { manager, sessionId, scope, tools: createTools(() => ({ ...scope })) };
      }
      const admitted = binding, context = args[4];
      const model = context.model ? { baseUrl: context.model.baseUrl, id: context.model.id } : undefined;
      const assertCurrent = () => {
        try {
          args[2]?.throwIfAborted();
          if (binding !== admitted || getManager() !== manager || manager.getSessionId() !== sessionId
            || context.sessionManager.getSessionId() !== sessionId || !sameScope(scope, readTeamSessionIdentity(manager))
            || context.model?.baseUrl !== model?.baseUrl || context.model?.id !== model?.id) {
            throw new Error("Shared knowledge Session or model changed during access. Search again.");
          }
        } catch (error) {
          if (binding === admitted) binding = undefined;
          throw error;
        }
      };
      assertCurrent();
      return admitted.tools[index]!.execute(args[0], args[1], args[2], args[3] ? (update) => {
        assertCurrent(); args[3]!(update);
      } : undefined, context).then((result) => {
        assertCurrent(); return result;
      }, (error: unknown) => {
        assertCurrent(); throw error;
      });
    }
  }));
}

function sameScope(a: TeamSessionIdentity, b: TeamSessionIdentity): boolean {
  return a.userId === b.userId && a.teamId === b.teamId && a.projectId === b.projectId && a.endpoint === b.endpoint;
}
