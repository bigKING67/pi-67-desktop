import * as fs from "node:fs/promises";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { readProject, candidateDocument } from "./project.js";
import { TEXT_BACKGROUND_EDGE } from "./document.js";
import { compose, type TextMeasurement } from "./render-compose.js";
import { errorMessage } from "./content-store.js";

export interface RenderWorkerData {
  root: string; revision: number; expected: string; output: string; previewMax: number; candidateId?: string; candidateSha?: string;
  /**
   * Also write `text-background.png`: the picture with every text hidden, at most 1024px on its
   * long edge — the keyed-text contrast check only needs what lies behind each text's box.
   */
  textBackground?: boolean;
}
export interface RenderWorkerResult { width: number; height: number; text_measurements: Record<string, TextMeasurement> }
export type RenderWorkerReply = { ok: true; result: RenderWorkerResult } | { ok: false; error: string };

export async function renderToDirectory(data: RenderWorkerData): Promise<RenderWorkerResult> {
  const project = await readProject(data.root, { revision: data.revision });
  if (project.sha256 !== data.expected) throw new Error("Revision changed before rendering");
  if (data.candidateId) {
    const prepared = await candidateDocument(data.root, project, data.candidateId);
    if (prepared.entry.sha256 !== data.candidateSha) throw new Error("Candidate changed before rendering");
    project.document = prepared.document;
  }
  const { svg, text_measurements } = await compose(project);
  let png = Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
  if (data.previewMax !== 0) png = await sharp(png).resize({ width: data.previewMax, height: data.previewMax, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  const metadata = await sharp(png).metadata();
  await fs.writeFile(path.join(data.output, "image.svg"), svg, { flag: "wx" });
  await fs.writeFile(path.join(data.output, "image.png"), png, { flag: "wx" });
  if (data.textBackground) {
    const hidden = { ...project, document: { ...project.document, objects: project.document.objects.map((object) => object.kind === "text" ? { ...object, visible: false } : object) } };
    const { width, height } = project.document.canvas, scale = Math.min(1, TEXT_BACKGROUND_EDGE / Math.max(width, height));
    const background = new Resvg((await compose(hidden)).svg, { font: { loadSystemFonts: false }, fitTo: { mode: "zoom", value: scale } }).render().asPng();
    await fs.writeFile(path.join(data.output, "text-background.png"), background, { flag: "wx" });
  }
  return { width: metadata.width ?? 0, height: metadata.height ?? 0, text_measurements };
}

if (parentPort && workerData) {
  const port = parentPort;
  renderToDirectory(workerData as RenderWorkerData)
    .then((result) => port.postMessage({ ok: true, result } satisfies RenderWorkerReply))
    .catch((error: unknown) => port.postMessage({ ok: false, error: errorMessage(error) } satisfies RenderWorkerReply));
}
