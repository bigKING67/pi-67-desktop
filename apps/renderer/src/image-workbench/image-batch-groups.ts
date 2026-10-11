import type { ImageProjectSummary } from "@pi67/protocol";

/** One batch in the library: its source, the revision it came from and its projects in table order. */
export interface BatchGroup { batchId: string; projectId: string; revision: number; members: ImageProjectSummary[] }

/**
 * The library's batches, in the order their first project appears (the library's own order),
 * each with its rows in table order. The one place batch rows are grouped and ordered: the
 * library card, its cover, the batch view, the project's batch list and the export all use it.
 */
export function batchGroups(projects: readonly ImageProjectSummary[]): BatchGroup[] {
  const groups = new Map<string, BatchGroup>();
  for (const project of projects) {
    if (!project.batch) continue;
    const group = groups.get(project.batch.batchId);
    if (group) group.members.push(project);
    else groups.set(project.batch.batchId, { batchId: project.batch.batchId, projectId: project.batch.projectId, revision: project.batch.revision, members: [project] });
  }
  for (const group of groups.values()) group.members.sort((a, b) => a.batch!.row - b.batch!.row);
  return [...groups.values()];
}
