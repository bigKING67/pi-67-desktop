import type { WorkspaceChangeView } from "@pi67/domain";
import { create } from "zustand";

const MAX_READ_SESSIONS = 256;
const MAX_READ_CHANGES_PER_SESSION = 400;

interface SessionChangesReadState {
  fingerprints: Record<string, string>;
  reviewedFingerprints: Record<string, string>;
  touchedAt: number;
}

interface ChangesReadState {
  sessions: Record<string, SessionChangesReadState>;
  markViewed: (sessionKey: string, change: WorkspaceChangeView) => void;
  markReviewed: (sessionKey: string, change: WorkspaceChangeView) => void;
  reset: () => void;
}

export const useChangesReadStore = create<ChangesReadState>((set) => ({
  sessions: {},
  markViewed(sessionKey, change) {
    if (!sessionKey) return;
    const fingerprint = workspaceChangeFingerprint(change);
    set((state) => {
      const current = state.sessions[sessionKey];
      if (current?.fingerprints[change.toolCallId] === fingerprint) return state;
      const fingerprints = {
        ...current?.fingerprints,
        [change.toolCallId]: fingerprint
      };
      const changeIds = Object.keys(fingerprints);
      for (const staleId of changeIds.slice(0, Math.max(0, changeIds.length - MAX_READ_CHANGES_PER_SESSION))) {
        delete fingerprints[staleId];
      }
      const sessions = {
        ...state.sessions,
        [sessionKey]: {
          fingerprints,
          reviewedFingerprints: current?.reviewedFingerprints ?? {},
          touchedAt: Date.now()
        }
      };
      const sessionKeys = Object.keys(sessions);
      if (sessionKeys.length > MAX_READ_SESSIONS) {
        sessionKeys.sort((left, right) => sessions[left]!.touchedAt - sessions[right]!.touchedAt);
        for (const staleKey of sessionKeys.slice(0, sessionKeys.length - MAX_READ_SESSIONS)) {
          delete sessions[staleKey];
        }
      }
      return { sessions };
    });
  },
  markReviewed(sessionKey, change) {
    if (!sessionKey) return;
    const fingerprint = workspaceChangeFingerprint(change);
    set((state) => {
      const current = state.sessions[sessionKey];
      if (current?.reviewedFingerprints[change.toolCallId] === fingerprint) return state;
      const reviewedFingerprints = {
        ...current?.reviewedFingerprints,
        [change.toolCallId]: fingerprint
      };
      const changeIds = Object.keys(reviewedFingerprints);
      for (const staleId of changeIds.slice(0, Math.max(0, changeIds.length - MAX_READ_CHANGES_PER_SESSION))) {
        delete reviewedFingerprints[staleId];
      }
      const sessions = {
        ...state.sessions,
        [sessionKey]: {
          fingerprints: current?.fingerprints ?? {},
          reviewedFingerprints,
          touchedAt: Date.now()
        }
      };
      const sessionKeys = Object.keys(sessions);
      if (sessionKeys.length > MAX_READ_SESSIONS) {
        sessionKeys.sort((left, right) => sessions[left]!.touchedAt - sessions[right]!.touchedAt);
        for (const staleKey of sessionKeys.slice(0, sessionKeys.length - MAX_READ_SESSIONS)) {
          delete sessions[staleKey];
        }
      }
      return { sessions };
    });
  },
  reset() { set({ sessions: {} }); }
}));

export function changesReadSessionKey(
  workspaceId: string | undefined,
  sessionFileIdentity: string | undefined
): string | undefined {
  return workspaceId && sessionFileIdentity
    ? `${workspaceId}\u0000${sessionFileIdentity}`
    : undefined;
}

export function workspaceChangeViewed(
  fingerprints: Readonly<Record<string, string>> | undefined,
  change: WorkspaceChangeView
): boolean {
  return fingerprints?.[change.toolCallId] === workspaceChangeFingerprint(change);
}

export function workspaceChangeReviewed(
  fingerprints: Readonly<Record<string, string>> | undefined,
  change: WorkspaceChangeView
): boolean {
  return fingerprints?.[change.toolCallId] === workspaceChangeFingerprint(change);
}

export function workspaceChangeFingerprint(change: WorkspaceChangeView): string {
  const details = change.kind === "edit"
    ? `${change.patchTruncated}:${change.additions ?? ""}:${change.deletions ?? ""}:${change.firstChangedLine ?? ""}:${hashText(change.patch ?? "")}`
    : `${change.metricsTruncated}:${change.writtenBytes ?? ""}:${change.writtenLines ?? ""}`;
  return `${change.kind}:${change.status}:${change.path}:${change.pathTruncated}:${details}`;
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}
