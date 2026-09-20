import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { TeamSessionIdentity } from "@pi67/domain";

export function readTeamSessionIdentity(manager: Pick<SessionManager, "getEntries" | "getHeader" | "getSessionId">): TeamSessionIdentity {
  const markers = manager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === "pi67.memory-provenance.v1");
  const marker = markers[0];
  const data = marker?.type === "custom" ? marker.data as Record<string, unknown> | null : null;
  if (markers.length !== 1 || !data || data.version !== 1 || data.kind !== "team"
    || data.originSessionId !== manager.getSessionId() || manager.getHeader()?.parentSession
    || ![data.userId, data.teamId, data.projectId].every((value) => typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\s\p{Cc}]/u.test(value))
    || typeof data.endpoint !== "string" || data.endpoint.length > 2048) throw new Error("A valid birth-bound team Session is required for shared knowledge.");
  let endpoint: URL;
  try { endpoint = new URL(data.endpoint); } catch { throw new Error("Invalid team Session service endpoint."); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || !(endpoint.protocol === "https:" || endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))) {
    throw new Error("Invalid team Session service endpoint.");
  }
  return { userId: data.userId as string, teamId: data.teamId as string, projectId: data.projectId as string, endpoint: endpoint.href };
}

/** Birth-only identity, never a renewable authorization or permission to replay history. */
export function markTeamSessionBirth(manager: SessionManager, identity: TeamSessionIdentity): void {
  if (manager.getHeader()?.parentSession || manager.getEntries().some((entry) =>
    ["message", "compaction", "branch_summary", "custom_message"].includes(entry.type)
    || entry.type === "custom" && entry.customType === "pi67.memory-provenance.v1")) {
    throw new Error("Team identity can only be assigned at Session birth.");
  }
  manager.appendCustomEntry("pi67.memory-provenance.v1", { version: 1, kind: "team",
    originSessionId: manager.getSessionId(), ...identity });
}
