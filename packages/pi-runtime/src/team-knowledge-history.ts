import { isTeamKnowledgeReference, TEAM_KNOWLEDGE_PROVIDER, teamKnowledgeText, type TeamKnowledgeDocument, type TeamKnowledgeReference } from "./team-knowledge-access.js";

/** Decode persisted Pi Tool Results before admitting any model transport. */
export function readTeamKnowledgeHistory(message: { toolName: string; isError: boolean; details?: unknown; content: unknown }) {
  const search = message.toolName === "viking_team_search", details = record(message.details);
  const keys = search ? ["provider", "trust", "snapshot", "count", "items"] : ["provider", "trust", "snapshot", "reference", "document"];
  if (message.isError || details.provider !== TEAM_KNOWLEDGE_PROVIDER || details.trust !== "untrusted"
    || Object.keys(details).some(key => !keys.includes(key))) throw invalid();
  const snapshot = record(details.snapshot);
  if (Object.keys(snapshot).length !== 2 || typeof snapshot.epoch !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(snapshot.epoch)
    || typeof snapshot.cursor !== "string" || !/^[1-9][0-9]{0,18}$/u.test(snapshot.cursor) || BigInt(snapshot.cursor) > 9223372036854775807n) throw invalid();
  if (!Array.isArray(message.content) || message.content.length !== 1) throw invalid();
  const text = record(message.content[0]);
  if (text.type !== "text" || text.text !== teamKnowledgeText(details) || Object.keys(text).some(key => key !== "type" && key !== "text")) throw invalid();
  const items = search ? details.items : [details.reference];
  if (!Array.isArray(items) || search && (items.length > 5 || details.count !== items.length)) throw invalid();
  const seen = new Set<string>();
  return items.map((item: unknown): { reference: TeamKnowledgeReference; document?: string } => {
    if (!isTeamKnowledgeReference(item)) throw invalid();
    const value = record(item);
    if (Object.keys(value).some(key => !["scope", "assetId", "contentRevision", ...(search ? ["score"] : [])].includes(key))
      || search && (typeof value.score !== "number" || !Number.isFinite(value.score))) throw invalid();
    const key = JSON.stringify([item.scope, item.assetId]);
    if (seen.has(key)) throw invalid(); seen.add(key);
    return { reference: { scope: item.scope, assetId: item.assetId, contentRevision: item.contentRevision },
      ...(search ? {} : { document: documentIdentity(details.document) }) };
  });
}
export function documentIdentity(value: unknown): string {
  const doc = record(value);
  if (Object.keys(doc).length !== 4 || (doc.kind !== "experience" && doc.kind !== "sop")
    || typeof doc.title !== "string" || typeof doc.summary !== "string" || typeof doc.body !== "string") throw invalid();
  return JSON.stringify([doc.kind, doc.title, doc.summary, doc.body] satisfies Array<TeamKnowledgeDocument[keyof TeamKnowledgeDocument]>);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function invalid() { return new Error("Team history contains unverified canonical knowledge provenance."); }
