import * as fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { onTestFinished } from "vitest";
import { createProject, type PublishedRevision } from "../project.js";
import type { ImageObject, JsonRecord } from "../document.js";
import type { ProviderEndpoint } from "../provider-endpoint.js";
import type { ProviderSpec } from "../provider-prepare.js";
import { demoInput } from "./fixtures.js";
import { tempDirectory } from "./harness.js";

export const fakeKey = "test-only-private-credential";
export interface RecordedCall { url: string; headers: http.IncomingHttpHeaders; body: Buffer }
export type Handler = (call: RecordedCall, res: http.ServerResponse, proposed: Buffer, root: string) => Promise<void> | void;

const goldenJob = (JSON.parse(readFileSync(new URL("./contract-fixtures.json", import.meta.url), "utf8")) as Record<string, { job: JsonRecord }>)["ready-generate"]?.job;

export interface ProviderFixture {
  directory: string; root: string; created: PublishedRevision; proposed: Buffer; calls: RecordedCall[];
  job: JsonRecord & { canvas: JsonRecord; prompt: JsonRecord }; jobPath: string; spec: ProviderSpec & JsonRecord;
  credentials: () => Promise<ProviderEndpoint>; saveJob: () => Promise<void>;
}

// A 1024² project served by a loopback gateway that records every request.
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
  const calls: RecordedCall[] = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer);
        const call = { url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) }; calls.push(call);
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/v1/models") res.end(JSON.stringify({ data: [{ id: "gpt-image-2.5-sunburst" }, { id: "gpt-image-2.5-flare" }] }));
        else if (handler) await handler(call, res, proposed, root);
        else { res.setHeader("x-request-id", "request-test-123"); res.end(JSON.stringify({ data: [{ b64_json: proposed.toString("base64") }], usage: { input_tokens: 12, output_tokens: 24, extra: fakeKey } })); }
      } catch { res.destroy(); }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const credentials = (): Promise<ProviderEndpoint> => Promise.resolve({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: fakeKey, source: "test resolver" });
  const job = structuredClone(goldenJob) as ProviderFixture["job"];
  Object.assign(job, { job_id: "background-job" });
  const jobPath = path.join(directory, "job.json");
  const saveJob = (): Promise<void> => fs.writeFile(jobPath, JSON.stringify(job, null, 2));
  await saveJob();
  const spec = { job: jobPath, candidate_id: "generated-background", base_revision: 1, target_id: "background", references: [] } as ProviderSpec & JsonRecord;
  return { directory, root, created, proposed, calls, job, jobPath, spec, credentials, saveJob };
}

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

export const respondImage = (image: Buffer) => (_call: RecordedCall, res: http.ServerResponse): void => { res.end(JSON.stringify({ data: [{ b64_json: image.toString("base64") }] })); };
