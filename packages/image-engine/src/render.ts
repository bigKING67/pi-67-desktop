import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Worker } from "node:worker_threads";
import sharp from "sharp";
import { encodeJson, errorMessage, sha256, writeOnce } from "./content-store.js";
import { readProject, regularPath, encode, candidateDocument } from "./project.js";
import { assertOutsideProject } from "./raster.js";
import { readCandidateEntry } from "./candidate-store.js";
import { inspectCandidate } from "./candidates.js";
import { number, type Canvas, type FontBinding, type JsonRecord } from "./document.js";
import type { RenderWorkerData, RenderWorkerReply, RenderWorkerResult } from "./render-worker.js";

export const RENDER_SCHEMA = "newmoney.image-render.v1";

const require = createRequire(import.meta.url);
// Packages that hide package.json behind `exports` are located from their entry file instead.
function installedVersion(name: string): string {
  let directory = path.dirname(require.resolve(name));
  for (;;) {
    const manifest = path.join(directory, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; version?: string };
      if (parsed.name === name && typeof parsed.version === "string") return parsed.version;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Installed version unknown: ${name}`);
    directory = parent;
  }
}
const engineVersions: Record<string, string> = Object.fromEntries(["sharp", "satori", "@resvg/resvg-js"].map((name) => [name, installedVersion(name)]));

export interface RenderReceipt extends JsonRecord {
  schema: typeof RENDER_SCHEMA; status: "running" | "completed" | "failed" | "cancelled"; mode: "preview" | "export";
  project_id: string; revision: number; project_sha256: string; document_sha256: string; engines: Record<string, string>; font: FontBinding;
  assets: { id: string; sha256: string; render_sha256: string }[]; canvas: Canvas; visual_quality: "UNVERIFIED"; started_at: string;
  candidate_preview?: JsonRecord; outputs?: { png: { file: string; sha256: string; width: number; height: number }; svg: { file: string; sha256: string } };
  qa?: JsonRecord; error?: string; finished_at?: string;
}
export interface RenderOptions { revision?: number | undefined; candidateId?: string | undefined; previewMax?: number; signal?: AbortSignal | undefined; timeoutMs?: number }
export class RenderError extends Error {
  constructor(message: string, readonly receipt: RenderReceipt, readonly output: string) { super(message); }
}

// Source tests build this entry first; the bundled runtime resolves its sibling entry.
const workerEntry = new URL(import.meta.url.endsWith(".ts") ? "../dist/render-worker.mjs" : "./render-worker.mjs", import.meta.url);

function runWorker(data: RenderWorkerData, { signal, timeoutMs }: { signal?: AbortSignal | undefined; timeoutMs: number }): Promise<RenderWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerEntry, { workerData: data, stdout: true, stderr: true });
    worker.stdout.resume(); worker.stderr.resume();
    let failure: string | undefined, reply: RenderWorkerReply | undefined;
    const stop = (reason: string) => { failure ??= reason; void worker.terminate(); };
    const abort = () => stop("Render cancelled");
    const timer = setTimeout(() => stop("Render timed out"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    worker.on("message", (message: RenderWorkerReply) => { reply = message; });
    worker.on("error", (error) => { failure ??= errorMessage(error); });
    // Wait for the actual worker exit before cleaning this invocation's files.
    worker.on("exit", () => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (failure) reject(new Error(failure));
      else if (!reply) reject(new Error("Invalid render worker response"));
      else if (reply.ok) resolve(reply.result);
      else reject(new Error(reply.error));
    });
  });
}

export async function renderProject(root: string, outputPath: string, { revision, candidateId, previewMax = 0, signal, timeoutMs = 60000 }: RenderOptions = {}): Promise<{ output: string; receipt: RenderReceipt }> {
  number(previewMax, "previewMax", 0, 8192, true); number(timeoutMs, "timeoutMs", 1, 60000, true);
  if (previewMax !== 0 && previewMax < 64) throw new Error("Preview must be at least 64 pixels");
  let selectedRevision = revision;
  if (candidateId !== undefined) {
    const entry = await readCandidateEntry(root, candidateId);
    if (revision !== undefined && revision !== entry.candidate.base_revision) throw new Error("Candidate preview revision mismatch");
    selectedRevision = entry.candidate.base_revision;
  }
  const project = await readProject(root, { revision: selectedRevision });
  let renderDocument = project.document, candidate: { id: string; sha256: string } | undefined;
  if (candidateId !== undefined) {
    const prepared = await candidateDocument(root, project, candidateId);
    renderDocument = prepared.document; candidate = { id: candidateId, sha256: prepared.entry.sha256 };
  }
  const documentSha = sha256(encode(renderDocument));
  const output = path.resolve(outputPath);
  await regularPath(path.dirname(output), { directory: true });
  await assertOutsideProject(project.root, output);
  // Render artifacts never replace another run, including a failed run.
  await fs.mkdir(output);
  const receipt: RenderReceipt = { schema: RENDER_SCHEMA, status: "running", mode: previewMax ? "preview" : "export",
    project_id: project.document.project_id, revision: project.document.revision, project_sha256: project.sha256, document_sha256: documentSha,
    engines: { node: process.version, ...engineVersions }, font: project.document.font,
    assets: renderDocument.assets.map((asset) => ({ id: asset.id, sha256: asset.sha256, render_sha256: asset.render_sha256 })),
    canvas: project.document.canvas, visual_quality: "UNVERIFIED", started_at: new Date().toISOString() };
  if (candidate) receipt.candidate_preview = { ...candidate };
  try {
    const data: RenderWorkerData = { root: project.root, revision: project.document.revision, expected: project.sha256, output, previewMax };
    if (candidate) { data.candidateId = candidate.id; data.candidateSha = candidate.sha256; }
    const result = await runWorker(data, { signal, timeoutMs });
    if (signal?.aborted) throw new Error("Render cancelled");
    // Recheck source bindings and history before claiming a successful output.
    const final = await readProject(root, { revision: project.document.revision });
    if (final.sha256 !== project.sha256) throw new Error("Revision changed during rendering");
    if (candidate) {
      const checked = await candidateDocument(root, final, candidate.id);
      if (checked.entry.sha256 !== candidate.sha256 || sha256(encode(checked.document)) !== documentSha) throw new Error("Candidate changed during rendering");
      // A standalone preview must retain its decision context. This is an
      // observation, not permission to accept or a claim of visual approval.
      const observed = await inspectCandidate(root, candidate.id);
      if (observed.sha256 !== candidate.sha256) throw new Error("Candidate changed during rendering");
      Object.assign(receipt.candidate_preview ?? {}, { checked_at: new Date().toISOString(),
        status_at_check: observed.status, current_revision_at_check: observed.current_revision,
        accepted_revision: observed.accepted_revision, applied_in_current: observed.applied_in_current,
        stale: observed.stale, decision_pending: observed.decision_pending });
    }
    const png = await fs.readFile(await regularPath(path.join(output, "image.png")));
    const svg = await fs.readFile(await regularPath(path.join(output, "image.svg")));
    const metadata = await sharp(png).metadata();
    await sharp(png).raw().toBuffer(); // Full decode, not only a header check.
    const canvas = project.document.canvas;
    const scale = previewMax ? Math.min(1, previewMax / Math.max(canvas.width, canvas.height)) : 1;
    const expectedWidth = Math.round(canvas.width * scale), expectedHeight = Math.round(canvas.height * scale);
    if (metadata.format !== "png" || metadata.width !== expectedWidth || metadata.height !== expectedHeight || result.width !== expectedWidth || result.height !== expectedHeight) throw new Error("Rendered dimensions mismatch");
    if (signal?.aborted) throw new Error("Render cancelled");
    await writeOnce(path.join(output, "document.json"), { bytes: encode(renderDocument) }, { expected: documentSha });
    receipt.status = "completed";
    receipt.outputs = { png: { file: "image.png", sha256: sha256(png), width: metadata.width, height: metadata.height }, svg: { file: "image.svg", sha256: sha256(svg) } };
    receipt.qa = { source_bindings: "PASS", png_decode: "PASS", dimensions: "PASS", object_bounds: "PASS", font_glyphs: "PASS", text_fit: "PASS",
      // Width is the declared box: wrapping keeps lines inside it, and a per-glyph advance check rejects glyphs wider than it.
      text_fit_basis: { height: "measured layout height", width: "wrapped to declared box; per-glyph advance checked" }, text_measurements: result.text_measurements };
  } catch (error) {
    const message = errorMessage(error);
    receipt.status = message === "Render cancelled" ? "cancelled" : "failed"; receipt.error = message;
    for (const name of ["image.png", "image.svg", "document.json"]) await fs.rm(path.join(output, name), { force: true });
    receipt.finished_at = new Date().toISOString();
    await writeOnce(path.join(output, "receipt.json"), { bytes: encodeJson(receipt) });
    throw new RenderError(message, receipt, output);
  }
  receipt.finished_at = new Date().toISOString();
  await writeOnce(path.join(output, "receipt.json"), { bytes: encodeJson(receipt) });
  return { output, receipt };
}
