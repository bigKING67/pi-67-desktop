import {
  MAX_WORKSPACE_CHANGES,
  type WorkspaceChangesProjection,
  type WorkspaceChangeView
} from "@pi67/domain";

export function upsertWorkspaceChange(
  projection: WorkspaceChangesProjection | undefined,
  sessionId: string,
  change: WorkspaceChangeView
): WorkspaceChangesProjection {
  if (!projection || projection.sessionId !== sessionId) {
    return { sessionId, items: [change], truncated: false, total: 1 };
  }
  const existingIndex = projection.items.findIndex((item) => item.toolCallId === change.toolCallId);
  if (existingIndex >= 0) {
    const items = projection.items.slice();
    items[existingIndex] = change;
    return { ...projection, items };
  }
  const nextItems = [...projection.items, change];
  const overflow = Math.max(0, nextItems.length - MAX_WORKSPACE_CHANGES);
  return {
    ...projection,
    items: overflow === 0 ? nextItems : nextItems.slice(overflow),
    total: projection.total + 1,
    truncated: projection.truncated || overflow > 0
  };
}

export interface WorkspaceChangeTurnGroup {
  key: string;
  currentOperation: boolean;
  items: WorkspaceChangeView[];
}

/** Groups Pi edit/write facts by the user turn that caused them; live facts lack a turn id yet. */
export function groupWorkspaceChangesByTurn(
  items: readonly WorkspaceChangeView[]
): WorkspaceChangeTurnGroup[] {
  const groups: WorkspaceChangeTurnGroup[] = [];
  const byKey = new Map<string, WorkspaceChangeTurnGroup>();
  for (const change of items) {
    const key = change.turnId ?? "current-operation";
    let group = byKey.get(key);
    if (!group) {
      group = { key, currentOperation: change.turnId === undefined, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(change);
  }
  return groups;
}

export interface TurnChangedFile {
  path: string;
  relativePath: string | undefined;
  written: boolean;
  additions: number | undefined;
  deletions: number | undefined;
  /** The newest completed fact for this file, used to focus it in the Inspector. */
  toolCallId: string;
}

export interface TurnChangedFiles {
  files: TurnChangedFile[];
  unfinishedCount: number;
}

/**
 * Files one turn changed, newest first and one row per path. Only completed facts are listed;
 * failed or interrupted ones are counted because the process group already explains them.
 */
export function selectTurnChangedFiles(
  items: readonly WorkspaceChangeView[],
  turnId: string,
  workspaceRoot: string | undefined
): TurnChangedFiles {
  const turn = items.filter((change) => change.turnId === turnId);
  const byPath = new Map<string, TurnChangedFile>();
  let unfinishedCount = 0;
  for (const change of turn.toReversed()) {
    if (change.status !== "completed") {
      if (change.status === "failed" || change.status === "interrupted") unfinishedCount += 1;
      continue;
    }
    const existing = byPath.get(change.path);
    const edit = change.kind === "edit" ? change : undefined;
    if (!existing) {
      byPath.set(change.path, {
        path: change.path,
        relativePath: change.pathTruncated ? undefined : workspaceRelativeChangePath(change.path, workspaceRoot),
        written: change.kind === "write",
        additions: edit?.additions,
        deletions: edit?.deletions,
        toolCallId: change.toolCallId
      });
      continue;
    }
    existing.written ||= change.kind === "write";
    existing.additions = sumMetric(existing.additions, edit?.additions);
    existing.deletions = sumMetric(existing.deletions, edit?.deletions);
  }
  return { files: [...byPath.values()], unfinishedCount };
}

/**
 * Maps a Pi Tool path to a Workspace-relative path for opening. Main re-validates containment;
 * this only decides whether to offer the action.
 */
export function workspaceRelativeChangePath(path: string, workspaceRoot: string | undefined): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  const absolute = normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized);
  let relative = normalized;
  if (absolute) {
    if (!workspaceRoot) return undefined;
    const root = workspaceRoot.replaceAll("\\", "/").replace(/\/+$/u, "");
    const windows = /^[A-Za-z]:\//u.test(root);
    const prefix = `${root}/`;
    const matches = windows
      ? normalized.toLowerCase().startsWith(prefix.toLowerCase())
      : normalized.startsWith(prefix);
    if (!matches) return undefined;
    relative = normalized.slice(prefix.length);
  }
  const segments = relative.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) return undefined;
  return segments.join("/");
}

function sumMetric(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

