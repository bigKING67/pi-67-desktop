import type { ComposerWorkspaceFileRef, WorkspaceFileEntry } from "@pi67/domain";

const WORKSPACE_FILE_DRAG_MIME = "application/x-pi67-workspace-file-ref+json";

const dragEntries = new Map<string, ComposerWorkspaceFileRef>();

export function writeWorkspaceFileDragData(
  transfer: DataTransfer,
  workspaceId: string,
  entry: WorkspaceFileEntry
): void {
  if (entry.kind !== "file") return;
  const reference = { id: entry.id, revision: entry.revision, relativePath: entry.relativePath };
  dragEntries.set(dragKey(workspaceId, entry.id), reference);
  transfer.effectAllowed = "copy";
  transfer.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify({ id: entry.id, revision: entry.revision }));
}

export function readWorkspaceFileDragData(
  transfer: DataTransfer,
  workspaceId: string
): ComposerWorkspaceFileRef | undefined {
  const raw = transfer.getData(WORKSPACE_FILE_DRAG_MIME);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as { id?: unknown; revision?: unknown };
    if (typeof value.id !== "string" || typeof value.revision !== "string") return undefined;
    const remembered = dragEntries.get(dragKey(workspaceId, value.id));
    return remembered?.revision === value.revision ? { ...remembered } : undefined;
  } catch {
    return undefined;
  }
}

export function transferContainsWorkspaceFile(transfer: DataTransfer): boolean {
  return [...transfer.types].includes(WORKSPACE_FILE_DRAG_MIME);
}

function dragKey(workspaceId: string, id: string): string {
  return `${workspaceId}\0${id}`;
}
