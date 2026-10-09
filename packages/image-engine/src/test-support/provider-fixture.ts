import * as fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { createProject, type PublishedRevision } from "../project.js";
import type { ImageObject, JsonRecord } from "../document.js";
import type { ImageGenerationCall, ImageGenerationOutcome, ImageGenerator } from "../provider-generator.js";
import type { ProviderSpec } from "../provider-prepare.js";
import { demoInput } from "./fixtures.js";
import { tempDirectory } from "./harness.js";

export const secretMarker = "test-only-private-credential";
export type Handler = (call: ImageGenerationCall, signal: AbortSignal, proposed: Buffer, root: string) => Promise<ImageGenerationOutcome> | ImageGenerationOutcome;

const goldenJob = (JSON.parse(readFileSync(new URL("./contract-fixtures.json", import.meta.url), "utf8")) as Record<string, { job: JsonRecord }>)["ready-generate"]?.job;

export interface ProviderFixture {
  directory: string; root: string; created: PublishedRevision; proposed: Buffer; calls: ImageGenerationCall[];
  job: JsonRecord & { canvas: JsonRecord; prompt: JsonRecord }; jobPath: string; spec: ProviderSpec & JsonRecord;
  generator: ImageGenerator; saveJob: () => Promise<void>;
}

// A 1024² project whose injected generator records every call it receives.
export async function providerFixture(handler?: Handler): Promise<ProviderFixture> {
  const directory = await tempDirectory("image-engine-provider-");
  const input = await demoInput(path.join(directory, "inputs"));
  const background = input.assets.find((asset) => asset.id === "background");
  if (!background) throw new Error("fixture background missing");
  const resized = await sharp(background.source).resize(1024, 1024).png().toBuffer();
  background.source = path.join(directory, "background.png"); await fs.writeFile(background.source, resized);
  input.canvas.width = 1024; input.canvas.height = 1024;
  Object.assign(input.objects.find((object) => object.id === "background") as ImageObject, { width: 1024, height: 1024 });
  const root = path.join(directory, "project"); const created = await createProject(root, input);
  const proposed = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#cce4e0" } }).png().toBuffer();
  const calls: ImageGenerationCall[] = [];
  const generator: ImageGenerator = async (call, signal) => {
    calls.push(call);
    if (handler) return handler(call, signal, proposed, root);
    return { images: [proposed], usage: { input_tokens: 12, output_tokens: 24, extra: secretMarker }, requestId: "request-test-123", httpStatus: 200 };
  };
  const job = structuredClone(goldenJob) as ProviderFixture["job"];
  Object.assign(job, { job_id: "background-job" });
  const jobPath = path.join(directory, "job.json");
  const saveJob = (): Promise<void> => fs.writeFile(jobPath, JSON.stringify(job, null, 2));
  await saveJob();
  const spec = { job: jobPath, candidate_id: "generated-background", base_revision: 1, target_id: "background", references: [] } as ProviderSpec & JsonRecord;
  return { directory, root, created, proposed, calls, job, jobPath, spec, generator, saveJob };
}

/** Resolves when the signal aborts, rejecting with its reason, like a real in-flight request. */
export const untilAborted = (signal: AbortSignal): Promise<never> => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason as Error);
  signal.addEventListener("abort", () => reject(signal.reason as Error), { once: true });
});

export async function writeMasks(directory: string, spec: ProviderSpec & JsonRecord, masks: Record<"generation_mask" | "protection_mask" | "blend_mask", Buffer>): Promise<void> {
  const edit: JsonRecord = { context: { x: 0, y: 0, width: 1024, height: 1024 } };
  for (const [name, data] of Object.entries(masks)) {
    const file = path.join(directory, `${name}.png`);
    await sharp(data, { raw: { width: 1024, height: 1024, channels: 1 } }).toColourspace("b-w").png().toFile(file);
    edit[name] = file;
  }
  spec.edit = edit as unknown as NonNullable<ProviderSpec["edit"]>;
}

export async function transparentPNG(size = 1024): Promise<Buffer> {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (y * size + x) * 4;
    data[at] = 220; data[at + 1] = 100; data[at + 2] = 60;
    data[at + 3] = x < size / 2 ? 0 : x === size / 2 ? 128 : 255;
  }
  return sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

export const respondImage = (image: Buffer): Handler => () => ({ images: [image], httpStatus: 200 });
