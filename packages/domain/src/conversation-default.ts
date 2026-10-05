/** Explicit UI preference only; Host authorization remains authoritative. */
export type ConversationScopeChoice = { kind: "private" } | {
  kind: "team";
  teamId: string;
  projectId: string;
  teamName: string;
  projectName: string;
  userId: string;
  serviceEndpoint: string;
};
export interface WorkspaceConversationDefault {
  workspaceId: string;
  choice: ConversationScopeChoice;
}

export function parseConversationScopeChoice(value: unknown): ConversationScopeChoice | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind === "private" && Object.keys(v).length === 1) return { kind: "private" };
  const keys = ["kind", "teamId", "projectId", "teamName", "projectName", "userId", "serviceEndpoint"];
  if (v.kind !== "team" || Object.keys(v).length !== keys.length || !keys.every(k => Object.hasOwn(v, k))) return undefined;
  for (const key of keys.slice(1)) {
    if (typeof v[key] !== "string" || !v[key].trim() || v[key].length > (key === "serviceEndpoint" ? 2048 : 256)
      || /[\p{Cc}]/u.test(v[key])) return undefined;
  }
  if ([v.teamId, v.projectId].some(id => (id as string).length > 128 || /\s/u.test(id as string))) return undefined;
  try {
    const url = new URL(v.serviceEndpoint as string);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
  } catch { return undefined; }
  return { kind: "team", teamId: v.teamId as string, projectId: v.projectId as string,
    teamName: v.teamName as string, projectName: v.projectName as string,
    userId: v.userId as string, serviceEndpoint: v.serviceEndpoint as string };
}
