import * as fs from "node:fs/promises";
import path from "node:path";
import { IMAGE_SIZE_PRESETS, isImageId, type ImageSizePreset } from "@pi67/domain";
import type { ImageProjectSummary } from "@pi67/protocol";
import type { ImageEngine } from "./image-host-support.js";

// The library listing and the lineage a project's first revision records: a derived size, a
// batch row or a project made from a template names its source in that revision's summary.

/** Every readable project under the Workspace's image folder; unreadable folders are skipped. */
export async function listProjects(engine: ImageEngine, cwd: string): Promise<ImageProjectSummary[]> {
  const { listCandidates, projectRoot, projectsDirectory, readProject } = engine;
  let entries: string[];
  try { entries = (await fs.readdir(projectsDirectory(cwd), { withFileTypes: true })).filter((entry) => entry.isDirectory() && isImageId(entry.name)).map((entry) => entry.name).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const projects: ImageProjectSummary[] = [];
  for (const projectId of entries) {
    const root = projectRoot(cwd, projectId);
    try { await fs.access(path.join(root, "revisions")); } catch { continue; }
    try {
      const project = await readProject(root);
      const latest = path.join(root, "revisions", `${String(project.latest_revision).padStart(6, "0")}.json`);
      const candidates = await listCandidates(root);
      const first = await firstSummary(root, project.latest_revision === 1 ? project.document.change.summary : undefined);
      const derivedFrom = derivation(first), batch = batchOf(first), fromTemplate = templateOf(first);
      projects.push({ projectId, title: project.document.title, revision: project.document.revision, canvas: project.document.canvas,
        updatedAt: Math.floor((await fs.stat(latest)).mtimeMs), readyCandidates: candidates.filter((item) => item.status === "ready").length,
        ...(derivedFrom ? { derivedFrom } : {}), ...(batch ? { batch } : {}), ...(fromTemplate ? { fromTemplate } : {}), ...(project.document.template ? { template: true as const } : {}) });
    } catch { /* A damaged project stays on disk for inspection; it is not listed. */ }
  }
  return projects;
}

const isImageSizePreset = (value: string): value is ImageSizePreset => (IMAGE_SIZE_PRESETS as readonly string[]).includes(value);
const DERIVED = /^Derived from ([a-zA-Z][a-zA-Z0-9_-]{0,63}) revision (\d{1,4}) (?:for (\d+):(\d+)|at \d+x\d+)$/u;

/** Revision 1's summary, where a derived size or a batch row names its source (engine). */
export async function firstSummary(root: string, known: string | undefined): Promise<string | undefined> {
  if (known !== undefined) return known;
  // `readProject` has already validated the whole chain, so one small read suffices.
  try { return (JSON.parse(await fs.readFile(path.join(root, "revisions", "000001.json"), "utf8")) as { change?: { summary?: unknown } }).change?.summary as string | undefined; }
  catch { return undefined; }
}

function derivation(summary: string | undefined): ImageProjectSummary["derivedFrom"] {
  const match = typeof summary === "string" ? DERIVED.exec(summary) : null;
  if (!match) return undefined;
  const lineage = { projectId: match[1]!, revision: Number(match[2]) };
  // An exact size (a brand spec) has no ratio; a ratio must be one of the presets.
  if (match[3] === undefined) return lineage;
  const preset = `${match[3]}x${match[4]}`;
  return isImageSizePreset(preset) ? { ...lineage, preset } : undefined;
}

const FROM_TEMPLATE = /^From template ([a-zA-Z][a-zA-Z0-9_-]{0,63}) revision (\d{1,4})$/u;
function templateOf(summary: string | undefined): ImageProjectSummary["fromTemplate"] {
  const match = typeof summary === "string" ? FROM_TEMPLATE.exec(summary) : null;
  return match ? { projectId: match[1]!, revision: Number(match[2]) } : undefined;
}

const BATCH = /^Batch ([a-zA-Z][a-zA-Z0-9_-]{0,63}) row (\d{1,3}) from ([a-zA-Z][a-zA-Z0-9_-]{0,63}) revision (\d{1,4})$/u;
export function batchOf(summary: string | undefined): ImageProjectSummary["batch"] {
  const match = typeof summary === "string" ? BATCH.exec(summary) : null;
  return match ? { batchId: match[1]!, row: Number(match[2]), projectId: match[3]!, revision: Number(match[4]) } : undefined;
}

