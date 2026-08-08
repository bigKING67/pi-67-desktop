export type ConversationFindScope = "current" | "workspace";

const listeners = new Set<(scope: ConversationFindScope) => void>();
const dismissListeners = new Set<() => void>();

export function requestConversationFind(scope: ConversationFindScope): void {
  for (const listener of listeners) listener(scope);
}

export function subscribeConversationFind(
  listener: (scope: ConversationFindScope) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissConversationFind(): void {
  for (const listener of dismissListeners) listener();
}

export function subscribeConversationFindDismiss(listener: () => void): () => void {
  dismissListeners.add(listener);
  return () => dismissListeners.delete(listener);
}
