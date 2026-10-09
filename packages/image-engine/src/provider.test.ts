import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { readProject, editBatch } from "./project.js";
import { executeProvider, recoverProvider, ProviderError, type ProviderReceipt } from "./provider.js";
import { ImageGenerationError } from "./provider-generator.js";
import { canonicalContracts } from "./contracts.js";
import { inspectCandidate, acceptCandidate } from "./candidates.js";
import type { ImageObject, JsonRecord, TextObject } from "./document.js";
import { providerFixture, secretMarker, untilAborted, writeMasks } from "./test-support/provider-fixture.js";
import { readJson } from "./test-support/harness.js";

type Executed = Extract<Awaited<ReturnType<typeof executeProvider>>, { status: "candidate" }>;
const run = async (...args: Parameters<typeof executeProvider>): Promise<Executed> => (await executeProvider(...args)) as Executed;
async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  try { await promise; } catch (error) { if (error instanceof ProviderError) return error; throw error; }
  throw new Error("expected a ProviderError");
}
const receiptOf = (error: ProviderError): ProviderReceipt => { if (!error.receipt) throw new Error("missing receipt"); return error.receipt; };
const resized = (width: number, height: number) => async (_call: unknown, _signal: AbortSignal, image: Buffer) => ({ images: [await sharp(image).resize(width, height).png().toBuffer()] });

describe("image Provider execution through an injected generator", { timeout: 120_000 }, () => {
  it("dry-run needs no generator and writes nothing", async () => {
    const f = await providerFixture();
    const before = await fs.readdir(f.root);
    const dry = await executeProvider(f.root, f.spec, { dryRun: true });
    expect(dry.status).toBe("dry_run");
    expect(await fs.readdir(f.root)).toEqual(before); expect(f.calls).toHaveLength(0);
  });

  it("refuses before claiming a job when no Pi image model is configured", async () => {
    const f = await providerFixture();
    await expect(executeProvider(f.root, f.spec, {})).rejects.toThrow(/no Pi image model is configured/);
    await expect(fs.lstat(path.join(f.root, "jobs"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("an unsent request (Provider not configured in Pi) releases the claim instead of recording an attempt", async () => {
    const f = await providerFixture(() => { throw new ImageGenerationError("provider_unavailable", undefined, false); });
    await expect(executeProvider(f.root, f.spec, { generator: f.generator })).rejects.toThrow(/No Provider request sent \(provider_unavailable\)/);
    await expect(fs.lstat(path.join(f.root, "jobs/background-job"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.calls).toHaveLength(1);
  });

  it("generation creates a receipt-bound candidate without accepting; unknown usage fields never persist", async () => {
    const f = await providerFixture();
    const result = await run(f.root, f.spec, { generator: f.generator });
    expect(result.receipt.outcome).toBe("succeeded"); expect(result.receipt.snapshot).toBeNull(); expect(result.receipt.host).toBe("newmoney.image-engine");
    expect(result.receipt.parameters.client_post_attempts).toBe(1); expect(result.receipt.parameters.usage).toEqual({ input_tokens: 12, output_tokens: 24 });
    expect(result.receipt.parameters.http_status).toBe(200);
    expect((result.receipt.parameters.billing as JsonRecord).state).toBe("UNVERIFIED"); expect(result.receipt.provider_execution_id).toBe("request-test-123");
    expect((await readProject(f.root)).sha256).toBe(f.created.sha256); expect(result.candidate.status).toBe("ready");
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0];
    expect(call?.endpoint).toBe("images/generations"); expect(call?.parameters).toEqual({ model: "gpt-image-2.5-sunburst", size: "1024x1024", quality: "low", background: "opaque", output_format: "png", n: 1 });
    expect(call?.prompt).toContain("BACKGROUND / SCENE"); expect(call?.references).toEqual([]); expect(call?.mask).toBeUndefined();
    for (const entry of await fs.readdir(result.job)) if (entry.endsWith(".json") || entry.endsWith(".md")) expect(await fs.readFile(path.join(result.job, entry), "utf8")).not.toContain(secretMarker);
    await acceptCandidate(f.root, { candidate_id: f.spec.candidate_id, base_revision: 1, author: "agent", summary: "Accept test output" });
    expect((await readProject(f.root)).document.revision).toBe(2);
    await fs.appendFile(path.join(result.job, "receipt.json"), "\n");
    await expect(inspectCandidate(f.root, f.spec.candidate_id)).rejects.toThrow(/Execution binding digest/);
  });

  it("drops request identifiers that are not plain tokens", async () => {
    const f = await providerFixture((_call, _signal, image) => ({ images: [image], requestId: "id with spaces\nand newline" }));
    expect((await run(f.root, f.spec, { generator: f.generator })).receipt.provider_execution_id).toBeNull();
  });

  it("Flare uses its explicit model ID; invalid formal jobs/references/stale revisions fail before generation", async () => {
    const f = await providerFixture();
    const opts = { generator: f.generator };
    f.job.canvas.variants = 2; await f.saveJob(); await expect(executeProvider(f.root, f.spec, opts)).rejects.toThrow(/one PNG/);
    f.job.canvas.variants = 1; f.job.canvas.size = "1000x1000"; await f.saveJob(); await expect(executeProvider(f.root, f.spec, opts)).rejects.toThrow(/Canonical contract.*multiples of 16px/);
    f.job.canvas.size = "1024x1024"; f.job.provider_profile = "openai.gpt-image-2.5-flare.2026-09-08"; await f.saveJob();
    await expect(executeProvider(f.root, { ...f.spec, references: [{ asset_id: "unbound", source: f.jobPath }] }, opts)).rejects.toThrow(/Reference inputs/);
    await expect(executeProvider(f.root, { ...f.spec, base_revision: 2 }, opts)).rejects.toThrow(/base revision/);
    f.job.prompt.scene = "Studio\n```\nignored"; await f.saveJob(); await expect(executeProvider(f.root, f.spec, opts)).rejects.toThrow(/code fences/);
    f.job.prompt.scene = "Warm studio background"; await f.saveJob();
    expect(f.calls).toHaveLength(0);
    expect((await run(f.root, f.spec, opts)).receipt.model).toBe("gpt-image-2.5-flare");
  });

  it("an HTTP error is recorded with its status, does not retry, and the claim prevents rerunning", async () => {
    const f = await providerFixture(() => { throw new ImageGenerationError("http_error", 503); });
    const error = await failure(executeProvider(f.root, f.spec, { generator: f.generator }));
    expect(receiptOf(error).outcome).toBe("failed"); expect(receiptOf(error).parameters.http_status).toBe(503);
    expect(receiptOf(error).provider_errors[0]).toEqual({ code: "http_error", upstream_execution_unknown: true });
    expect((await readProject(f.root)).sha256).toBe(f.created.sha256);
    await expect(executeProvider(f.root, f.spec, { generator: f.generator })).rejects.toThrow(/EEXIST/); expect(f.calls).toHaveLength(1);
  });

  for (const mode of ["timeout", "cancel"] as const) {
    it(`${mode} has no accepted revision or success output and does not retry`, async () => {
      const controller = new AbortController();
      const f = await providerFixture((_call, signal) => { if (mode === "cancel") controller.abort(); return untilAborted(signal); });
      const error = await failure(executeProvider(f.root, f.spec, { generator: f.generator, timeoutMs: 200, signal: controller.signal }));
      const receipt = receiptOf(error);
      expect(receipt.outcome).toBe(mode === "cancel" ? "cancelled" : "failed");
      expect(receipt.provider_errors[0]?.code).toBe(mode === "cancel" ? "cancelled" : "timeout"); expect(receipt.provider_errors[0]?.upstream_execution_unknown).toBe(true);
      expect(receipt.outputs).toEqual([]); expect(f.calls).toHaveLength(1); expect((await readProject(f.root)).sha256).toBe(f.created.sha256);
    });
  }

  for (const mode of ["no-image", "two-images", "not-an-image", "wrong-size"] as const) {
    it(`${mode} output fails closed with a durable receipt`, async () => {
      const small = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#ffffff" } }).png().toBuffer();
      const images = { "no-image": [], "two-images": [small, small], "not-an-image": [Buffer.from("not a png")], "wrong-size": [small] }[mode];
      const f = await providerFixture(() => ({ images }));
      await expect(executeProvider(f.root, f.spec, { generator: f.generator })).rejects.toThrow(/see bound receipt/);
      const receipt = await readJson(path.join(f.root, "jobs/background-job/receipt.json")) as ProviderReceipt;
      expect(receipt.outcome).toBe(mode === "wrong-size" ? "partial" : "failed");
      if (mode === "wrong-size") { expect(receipt.outputs).toHaveLength(1); expect((receipt.parameters.returned_image as JsonRecord).width).toBe(64); }
      else expect(receipt.outputs).toEqual([]);
      if (mode === "no-image" || mode === "two-images") expect(receipt.provider_errors[0]?.code).toBe("invalid_image_response");
      expect((await readProject(f.root)).sha256).toBe(f.created.sha256); expect(f.calls).toHaveLength(1);
    });
  }

  it("human edit during generation leaves successful Provider output in a stale candidate", async () => {
    const f = await providerFixture(async (_call, _signal, image, root) => {
      await editBatch(root, { base_revision: 1, author: "human", summary: "Human price edit", operations: [{ type: "update_object", id: "price", patch: { text: "¥149" } }] });
      return { images: [image] };
    });
    const result = await run(f.root, f.spec, { generator: f.generator });
    expect(result.receipt.outcome).toBe("succeeded"); expect(result.candidate.status).toBe("stale");
    await expect(acceptCandidate(f.root, { candidate_id: f.spec.candidate_id, base_revision: 2, author: "agent", summary: "Must fail" })).rejects.toThrow(/Candidate base revision/);
    expect(((await readProject(f.root)).document.objects.find((o) => o.id === "price") as TextObject).text).toBe("¥149");
  });

  it("masked edit sends the target and a Provider-polarity mask and preserves protected/outside pixels", async () => {
    const f = await providerFixture();
    const asset = f.created.document.assets.find((a) => a.id === "background");
    if (!asset) throw new Error("missing asset");
    Object.assign(f.job, { task_type: "edit", asset_refs: [asset.id] });
    Object.assign(f.job.prompt, { references: [{ asset_id: asset.id, role: "edit source", preserve: ["outside selection"] }], change: ["Replace local background patch"], preserve: ["Product and logo"] });
    await f.saveJob();
    f.spec.references = [{ asset_id: asset.id, source: path.join(f.root, asset.render_file) }];
    const pixels = 1024 * 1024, generation = Buffer.alloc(pixels), protection = Buffer.alloc(pixels), blend = Buffer.alloc(pixels);
    for (let y = 810; y < 850; y++) for (let x = 920; x < 960; x++) generation[y * 1024 + x] = blend[y * 1024 + x] = 255;
    protection[820 * 1024 + 930] = 255;
    await writeMasks(f.directory, f.spec, { generation_mask: generation, protection_mask: protection, blend_mask: blend });
    const result = await run(f.root, f.spec, { generator: f.generator });
    const call = f.calls[0];
    expect(call?.endpoint).toBe("images/edits"); expect(call?.references.map((ref) => ref.id)).toEqual([asset.id]);
    const alpha = await sharp(call?.mask).ensureAlpha().raw().toBuffer();
    expect(alpha[(820 * 1024 + 930) * 4 + 3]).toBe(255); expect(alpha[(820 * 1024 + 940) * 4 + 3]).toBe(0); expect(alpha[3]).toBe(255);
    expect(await fs.readFile(path.join(result.job, "provider-mask.png"))).toEqual(call?.mask);
    expect(result.candidate.candidate.qa?.protected_changed_pixels).toBe(0); expect(result.candidate.candidate.qa?.outside_blend_changed_pixels).toBe(0);
    expect((await readProject(f.root)).sha256).toBe(f.created.sha256);
  });

  it("concurrent runs of the same job publish one claim and generate exactly once", async () => {
    const f = await providerFixture();
    const results = await Promise.allSettled([run(f.root, f.spec, { generator: f.generator }), run(f.root, f.spec, { generator: f.generator })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(f.calls).toHaveLength(1);
  });

  it("Provider success with unstageable output is retained and cannot trigger a second generation", async () => {
    const f = await providerFixture(async (_call, _signal, _image, root) => {
      const project = await readProject(root);
      const asset = project.document.assets.find((a) => a.id === (project.document.objects.find((o) => o.id === "background") as ImageObject).asset_id);
      return { images: [await fs.readFile(path.join(root, asset?.render_file ?? ""))] };
    });
    const error = await failure(executeProvider(f.root, f.spec, { generator: f.generator }));
    expect(receiptOf(error).outcome).toBe("succeeded"); expect(error.message).toMatch(/Output retained/);
    expect((await readJson(path.join(error.output ?? "", "result.json"))).status).toBe("candidate_failed");
    await expect(executeProvider(f.root, f.spec, { generator: f.generator })).rejects.toThrow(/EEXIST/); expect(f.calls).toHaveLength(1);
  });

  it("explicit same-aspect normalization retains native output and binds the resized PNG", async () => {
    const f = await providerFixture(resized(1254, 1254));
    const result = await run(f.root, { ...f.spec, output_policy: "resize_to_target" }, { generator: f.generator });
    const normalization = result.receipt.parameters.output_normalization as JsonRecord;
    expect(normalization.source_size).toEqual([1254, 1254]); expect(normalization.target_size).toEqual([1024, 1024]); expect(normalization.crop).toBe(false);
    expect(result.receipt.outputs).toHaveLength(2); expect(result.candidate.candidate.source.width).toBe(1024);
    await inspectCandidate(f.root, f.spec.candidate_id);
  });

  it("retained native-size output recovers offline without mutating the old receipt or generating again", async () => {
    const f = await providerFixture(resized(1254, 1254));
    await expect(executeProvider(f.root, f.spec, { generator: f.generator })).rejects.toThrow(/see bound receipt/);
    const before = await fs.readFile(path.join(f.root, "jobs/background-job/receipt.json"));
    const recovered = await recoverProvider(f.root, { job_id: "background-job", candidate_id: "recovered-native", output_policy: "resize_to_target" });
    expect(recovered.network_requests).toBe(0); expect(f.calls).toHaveLength(1); expect(recovered.candidate.status).toBe("ready");
    expect(await fs.readFile(path.join(f.root, "jobs/background-job/receipt.json"))).toEqual(before);
    await acceptCandidate(f.root, { candidate_id: "recovered-native", base_revision: 1, author: "agent", summary: "Accept resampled fixture" });
    await fs.appendFile(path.join(f.root, "jobs/background-job/received-output.png"), "tamper");
    await expect(inspectCandidate(f.root, "recovered-native")).rejects.toThrow(/Normalization source binding/);
  });

  it("normalization does not crop or stretch a different aspect ratio", async () => {
    const f = await providerFixture(resized(1024, 1536));
    await expect(executeProvider(f.root, { ...f.spec, output_policy: "resize_to_target" }, { generator: f.generator })).rejects.toThrow(/see bound receipt/);
    await expect(recoverProvider(f.root, { job_id: "background-job", candidate_id: "reject-distortion", output_policy: "resize_to_target" })).rejects.toThrow(/output_dimensions/);
    expect(f.calls).toHaveLength(1); expect((await readProject(f.root)).sha256).toBe(f.created.sha256);
  });

  it("receipt validation failure after generation retains an unvalidated receipt that recovery promotes", async () => {
    const f = await providerFixture();
    const failing = { ...canonicalContracts, validateReceipt: () => ({ valid: false, errors: ["simulated"], warnings: [] }) };
    await expect(executeProvider(f.root, f.spec, { generator: f.generator, contracts: failing })).rejects.toThrow(/unvalidated receipt .* retained/);
    const job = path.join(f.root, "jobs/background-job");
    expect(await fs.readdir(job)).toContain("receipt.unvalidated.json"); expect(await fs.readdir(job)).not.toContain("receipt.json");
    const recovered = await recoverProvider(f.root, { job_id: "background-job", candidate_id: "promoted" });
    expect(recovered.network_requests).toBe(0); expect(f.calls).toHaveLength(1); expect(recovered.candidate.status).toBe("ready");
    expect(await fs.readFile(path.join(job, "receipt.json"))).toEqual(await fs.readFile(path.join(job, "receipt.unvalidated.json")));
    await expect(recoverProvider(f.root, { job_id: "background-job", candidate_id: "again" })).rejects.toThrow(/already recorded a result/);
  });
});
