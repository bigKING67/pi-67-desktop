/** Shortcut requests for the Chat search field: all conversations, or the one in view. */
export type TeamChatSearchScope = "all" | "current";

const listeners = new Set<(scope: TeamChatSearchScope) => void>();

export function requestTeamChatSearch(scope: TeamChatSearchScope): void {
  for (const listener of listeners) listener(scope);
}

export function subscribeTeamChatSearch(listener: (scope: TeamChatSearchScope) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
