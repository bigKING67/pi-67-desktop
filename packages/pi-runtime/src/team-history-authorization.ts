import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { TeamSessionIdentity } from "@pi67/domain";
import type { PiSdkRuntimeOptions } from "./pi-sdk-runtime-options.js";
import { readTeamSessionIdentity } from "./team-session-birth.js";
import { TEAM_KNOWLEDGE_TOOLS } from "./team-knowledge-access.js";
import { documentIdentity, readTeamKnowledgeHistory } from "./team-knowledge-history.js";

export type TeamHistoryAccess = {
  authorizeTeamSession?: PiSdkRuntimeOptions["authorizeTeamSession"] | undefined;
  sharedExperienceAccess?: PiSdkRuntimeOptions["sharedExperienceAccess"] | undefined;
  sharedSopAccess?: PiSdkRuntimeOptions["sharedSopAccess"] | undefined;
  teamKnowledgeAccess?: PiSdkRuntimeOptions["teamKnowledgeAccess"] | undefined;
};
const tools = new Set(["viking_shared_search", "viking_shared_read", "viking_sop_search", "viking_sop_read", ...TEAM_KNOWLEDGE_TOOLS]);
export interface TeamHistoryLease {
  assertValid(): void;
  /** Revalidate the admitted model's asset basis, not unfinished Tool results. */
  renewToolBasis(signal: AbortSignal): Promise<TeamHistoryLease>;
}

/** Inspect all Pi entries, not just the current branch or a disposable index. */
export async function authorizeTeamHistory(manager: SessionManager, model: { baseUrl: string; id: string }, access: TeamHistoryAccess, signal?: AbortSignal): Promise<TeamHistoryLease> {
  const scope = readTeamSessionIdentity(manager);
  const entries = manager.getEntries();
  const leaf = manager.getLeafId();
  const sessionId = manager.getSessionId();
  const references = new Map<string, { id: string; revision: string; sop: boolean }>();
  const documents = new Map<string, ReturnType<typeof readTeamKnowledgeHistory>[number]>();
  const calls = new Set<string>(), results = new Set<string>();
  for (const entry of entries) {
    if (["compaction", "branch_summary", "custom_message"].includes(entry.type)) throw new Error("Team history contains derived content without verified asset provenance.");
    if (entry.type === "message" && entry.message.role === "assistant") {
      for (const part of entry.message.content) if (part.type === "toolCall" && tools.has(part.name)) calls.add(part.id);
    }
    if (entry.type !== "message" || entry.message.role !== "toolResult" || !tools.has(entry.message.toolName)) continue;
    const message = entry.message;
    results.add(message.toolCallId);
    if (TEAM_KNOWLEDGE_TOOLS.has(message.toolName)) {
      for (const item of readTeamKnowledgeHistory(message)) {
        const key = JSON.stringify(item.reference), previous = documents.get(key);
        if (previous?.document !== undefined && item.document !== undefined && previous.document !== item.document) throw new Error("Conflicting canonical asset provenance.");
        if (!previous || item.document !== undefined) documents.set(key, item);
      }
      continue;
    }
    const details = record(message.details);
    if (message.isError || details.provider !== "openviking-enterprise" || details.trust !== "untrusted") throw new Error("Team history contains an unverified shared result.");
    const search = message.toolName.endsWith("_search");
    const items = search ? details.items : [details.item];
    if (!Array.isArray(items) || search && (details.count !== items.length || items.length > (message.toolName === "viking_sop_search" ? 1 : 5))) throw new Error("Team history contains invalid shared references.");
    for (const value of items) {
      const item = record(value);
      if (typeof item.id !== "string" || !item.id || item.id.length > 512 || item.projectId !== scope.projectId
        || typeof item.externalRevision !== "string" || !/^[a-f0-9]{64}$/u.test(item.externalRevision)) throw new Error("Team history contains an invalid asset revision or scope.");
      const sop = message.toolName.startsWith("viking_sop_");
      references.set(JSON.stringify([sop, item.id, item.externalRevision]), { id: item.id, revision: item.externalRevision, sop });
    }
  }
  if ([...calls].some((id) => !results.has(id))) throw new Error("Team history contains an unresolved shared Tool call.");
  if (!access.authorizeTeamSession) throw new Error("Verified team Session model authorization is unavailable.");
  const authorize = access.authorizeTeamSession;
  const assertBasis = (initial: boolean) => {
    assertIdentity(scope, readTeamSessionIdentity(manager));
    const current = manager.getEntries();
    if (manager.getSessionId() !== sessionId || current.length < entries.length
      || entries.some((entry, index) => current[index]?.id !== entry.id)
      || (initial ? manager.getLeafId() !== leaf || current.length !== entries.length
        : leaf !== null && !manager.getBranch().some((entry) => entry.id === leaf))) {
      throw new Error("Team history changed during model authorization.");
    }
  };
  const verify = async (signal?: AbortSignal, initial = false): Promise<TeamHistoryLease> => {
    assertBasis(initial);
    const expiries: number[] = [];
    signal?.throwIfAborted();
    const grant = await authorize(scope, model, signal);
    assertIdentity(scope, grant.identity);
    grant.assertValid();
    for (const reference of references.values()) {
      signal?.throwIfAborted();
      const reader = reference.sop ? access.sharedSopAccess : access.sharedExperienceAccess;
      if (!reader) throw new Error("Team history asset verification is unavailable.");
      const item = await reader.read(reference.id, signal, { ...model, scope });
      if (item.id !== reference.id || item.projectId !== scope.projectId || item.externalRevision !== reference.revision) throw new Error("A historical team asset is no longer the authorized revision.");
      if ("expiresAt" in item && item.expiresAt !== undefined) expiries.push(item.expiresAt);
      grant.assertValid();
    }
    for (const { reference, document } of documents.values()) {
      signal?.throwIfAborted();
      if (!access.teamKnowledgeAccess) throw new Error("Canonical team history verification is unavailable.");
      const item = await access.teamKnowledgeAccess.read({ identity: scope, model, ...reference,
        snapshot: "current", signal: signal ?? new AbortController().signal });
      if (item.assetId !== reference.assetId || item.contentRevision !== reference.contentRevision
        || document !== undefined && documentIdentity(item.content) !== document) throw new Error("A historical team document is no longer the authorized revision.");
      grant.assertValid();
    }
    signal?.throwIfAborted();
    if (expiries.some((expiry) => expiry <= Date.now())) throw new Error("A historical team SOP has expired.");
    assertBasis(initial);
    grant.assertValid();
    return { assertValid() {
      grant.assertValid();
      if (expiries.some((expiry) => expiry <= Date.now())) throw new Error("A historical team SOP has expired.");
    }, renewToolBasis: (signal) => verify(signal) };
  };
  return verify(signal, true);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid shared history metadata.");
  return value as Record<string, unknown>;
}
function assertIdentity(expected: TeamSessionIdentity, actual: TeamSessionIdentity): void {
  if (expected.userId !== actual.userId || expected.teamId !== actual.teamId || expected.projectId !== actual.projectId
    || expected.endpoint !== new URL(actual.endpoint).href) throw new Error("Team Session identity no longer matches current authorization.");
}
