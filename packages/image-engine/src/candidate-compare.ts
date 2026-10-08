import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { errorMessage, sha256, writeOnce } from "./content-store.js";
import { regularPath, assertOutsideProject } from "./raster.js";
import { candidateBytes } from "./candidate-store.js";
import type { CompositeQa } from "./composite.js";
import { inspectCandidate, type CandidateStatus } from "./candidates.js";
import { renderProject } from "./render.js";

export interface ComparisonReport {
  status: "completed"; candidate_id: string; candidate_sha256: string; basis_revision: number; current_revision_at_check: number;
  candidate_status_at_check: CandidateStatus; panels: { left: string; right: string }; image_sha256: string; protection_qa: CompositeQa | null; visual_quality: "UNVERIFIED";
}

export async function compareCandidate(root: string, candidateId: string, outputPath: string): Promise<{ output: string; report: ComparisonReport }> {
  const inspected = await inspectCandidate(root, candidateId);
  const output = path.resolve(outputPath);
  await regularPath(path.dirname(output), { directory: true });
  await assertOutsideProject(root, output);
  await fs.mkdir(output);
  try {
    const before = await renderProject(root, path.join(output, "before"), { revision: inspected.candidate.base_revision, previewMax: 640 });
    const after = await renderProject(root, path.join(output, "after"), { candidateId, previewMax: 640 });
    const a = await fs.readFile(path.join(before.output, "image.png")), b = await fs.readFile(path.join(after.output, "image.png"));
    const width = before.receipt.outputs?.png.width ?? 0, height = before.receipt.outputs?.png.height ?? 0;
    const png = await sharp({ create: { width: width * 2, height, channels: 4, background: "#ffffff" } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: width, top: 0 }]).png().toBuffer();
    await writeOnce(path.join(output, "comparison.png"), { bytes: png });
    const report: ComparisonReport = { status: "completed", candidate_id: candidateId, candidate_sha256: inspected.sha256, basis_revision: inspected.candidate.base_revision,
      current_revision_at_check: inspected.current_revision, candidate_status_at_check: inspected.status, panels: { left: "before/image.png", right: "after/image.png" },
      image_sha256: sha256(png), protection_qa: inspected.candidate.qa, visual_quality: "UNVERIFIED" };
    await writeOnce(path.join(output, "comparison.json"), { bytes: candidateBytes(report) });
    return { output, report };
  } catch (error) {
    await writeOnce(path.join(output, "comparison.json"), { bytes: candidateBytes({ status: "failed", error: errorMessage(error), visual_quality: "UNVERIFIED" }) });
    throw error;
  }
}
