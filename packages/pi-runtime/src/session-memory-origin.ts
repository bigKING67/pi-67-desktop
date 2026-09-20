import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionMemoryOrigin } from "@pi67/domain";
import { assertPrivateMemoryProvenance } from "./session-memory-provenance.js";
import { readTeamSessionIdentity } from "./team-session-birth.js";

/** Read-only display projection. Neither login nor Workspace binding establishes origin. */
export function projectSessionMemoryOrigin(manager: SessionManager): SessionMemoryOrigin {
  try {
    const { teamId, projectId } = readTeamSessionIdentity(manager);
    return { kind: "team", teamId, projectId };
  } catch {
    // A non-team marker may still be verified private; malformed history is not.
  }
  try {
    assertPrivateMemoryProvenance(manager);
    return { kind: "private" };
  } catch {
    return { kind: "unverified" };
  }
}
