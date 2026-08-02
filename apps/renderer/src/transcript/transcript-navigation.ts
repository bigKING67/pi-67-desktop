import type { LocatedMessageWindow } from "@pi67/domain";

export interface TranscriptMessageTarget {
  id: string;
  window?: LocatedMessageWindow;
}

const listeners = new Set<(target: TranscriptMessageTarget) => void>();

export function requestTranscriptMessageJump(target: TranscriptMessageTarget): void {
  for (const listener of listeners) listener(target);
}

export function subscribeTranscriptMessageJump(
  listener: (target: TranscriptMessageTarget) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
