import { parseConversationScopeChoice, type WorkspaceConversationDefault } from "@pi67/protocol";

export function parseWorkspaceConversationDefaults(value: unknown, workspaceIds: Set<string>): WorkspaceConversationDefault[] | undefined {
  if (!Array.isArray(value) || value.length > 100) return undefined;
  const result: WorkspaceConversationDefault[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 2
      || typeof item.workspaceId !== "string" || !workspaceIds.has(item.workspaceId) || seen.has(item.workspaceId)) return undefined;
    const choice = parseConversationScopeChoice(item.choice);
    if (!choice) return undefined;
    seen.add(item.workspaceId);
    result.push({ workspaceId: item.workspaceId, choice });
  }
  return result;
}
