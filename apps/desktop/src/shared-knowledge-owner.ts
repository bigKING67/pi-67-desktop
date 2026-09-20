import { createHash } from "node:crypto";

export interface SharedKnowledgeReceiptOwner {
  localProfileId: string;
  endpoint: string;
  userId: string;
  teamId: string;
  scopeKind: "team" | "project";
  scopeId: string;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

/** Shared receipts and projections use the same exact owner, in separate roots.
 * This stable v1 key is persisted already; changing it requires a migration.
 * Namespace validation never grants membership or permission to process models. */
export function bindSharedKnowledgeOwner(input: SharedKnowledgeReceiptOwner) {
  const owner = normalizeOwner(input);
  const key = createHash("sha256").update(JSON.stringify([
    "newmoney.shared-receipt.v1", owner.localProfileId, owner.endpoint,
    owner.userId, owner.teamId, owner.scopeKind, owner.scopeId
  ]), "utf8").digest("hex");
  return Object.freeze({ owner, key });
}

function normalizeOwner(owner: SharedKnowledgeReceiptOwner): Readonly<SharedKnowledgeReceiptOwner> {
  if (!UUID.test(owner.localProfileId) || !UUID.test(owner.teamId) || !UUID.test(owner.scopeId)
      || !["team", "project"].includes(owner.scopeKind)
      || (owner.scopeKind === "team" && owner.scopeId !== owner.teamId)
      || typeof owner.userId !== "string" || owner.userId.length > 2048 || !owner.userId.trim()
      || hasForbiddenAscii(owner.userId, 31)
      || typeof owner.endpoint !== "string" || owner.endpoint.length > 2048
      || owner.endpoint.trim() !== owner.endpoint || hasForbiddenAscii(owner.endpoint, 32) || owner.endpoint.includes("\\")) {
    throw new Error("Invalid shared receipt owner.");
  }
  let endpoint: URL;
  try { endpoint = new URL(owner.endpoint); } catch { throw new Error("Invalid shared receipt endpoint."); }
  if (endpoint.username || endpoint.password || owner.endpoint.includes("?") || owner.endpoint.includes("#")
      || (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:"
        && ["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname)))) {
    throw new Error("Invalid shared receipt endpoint.");
  }
  // Preserve service base paths and non-default ports; match Gateway's removal
  // of trailing slashes without collapsing different services on one origin.
  return Object.freeze({ localProfileId: owner.localProfileId, userId: owner.userId,
    teamId: owner.teamId, scopeKind: owner.scopeKind, scopeId: owner.scopeId,
    endpoint: endpoint.href.replace(/\/+$/u, "") });
}

function hasForbiddenAscii(value: string, maximum: number): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= maximum || character.charCodeAt(0) === 127);
}
