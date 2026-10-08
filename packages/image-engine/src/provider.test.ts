import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { readProject, editBatch } from "./project.js";
import { executeProvider, checkProvider, recoverProvider, ProviderError, type ProviderReceipt } from "./provider.js";
import { canonicalContracts } from "./contracts.js";
import { inspectCandidate, acceptCandidate } from "./candidates.js";
import type { ImageObject, JsonRecord, TextObject } from "./document.js";
import { fakeKey, providerFixture, respondImage, writeMasks } from "./test-support/provider-fixture.js";
import { readJson } from "./test-support/harness.js";

type Executed = Extract<Awaited<ReturnType<typeof executeProvider>>, { status: "candidate" }>;
const run = async (...args: Parameters<typeof executeProvider>): Promise<Executed> => (await executeProvider(...args)) as Executed;
async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  try { await promise; } catch (error) { if (error instanceof ProviderError) return error; throw error; }
  throw new Error("expected a ProviderError");
}
const receiptOf = (error: ProviderError): ProviderReceipt => { if (!error.receipt) throw new Error("missing receipt"); return error.receipt; };

describe("image Provider adapter", { timeout: 120_000 }, () => {
  it("dry-run reads no credentials and writes nothing; check lists models without leaking the key", async () => {
    const f = await providerFixture();
    const before = await fs.readdir(f.root);
    const dry = await executeProvider(f.root, f.spec, { dryRun: true });
    expect(dry.status).toBe("dry_run");
    expect(await fs.readdir(f.root)).toEqual(before); expect(f.calls).toHaveLength(0);
    const check = await checkProvider({ credentials: f.credentials });
    expect((check.models as { advertised: boolean }[]).every((model) => model.advertised)).toBe(true);
    expect(check.credential_source).toBe("test resolver"); expect(check.generation_verified).toBe(false);
    expect(JSON.stringify(check)).not.toContain(fakeKey);
  });

  it("endpoint policy refuses missing credentials, remote HTTP, embedded credentials and header injection before claiming a job", async () => {
    const f = await providerFixture();
    const cases: [() => Promise<{ baseUrl: string; apiKey: string; headers?: Record<string, string> }>, RegExp][] = [
      [() => Promise.resolve({ baseUrl: "http://images.example/v1", apiKey: fakeKey }), /HTTPS or loopback/],
      [() => Promise.resolve({ baseUrl: "https://user:pw@images.example/v1", apiKey: fakeKey }), /embedded credentials/],
      [() => Promise.resolve({ baseUrl: "https://images.example/v1?key=1", apiKey: fakeKey }), /HTTPS or loopback/],
      [() => Promise.resolve({ baseUrl: "https://images.example/v1", apiKey: " " }), /API key/],
      [() => Promise.resolve({ baseUrl: "https://images.example/v1", apiKey: fakeKey, headers: { Authorization: "x" } }), /Invalid Provider header/],
      [() => Promise.reject(new Error(`leaked ${fakeKey}`)), /^Provider credentials unavailable$/]
    ];
    await expect(executeProvider(f.root, f.spec, {})).rejects.toThrow(/no image Provider is configured/);
    for (const [credentials, pattern] of cases) await expect(executeProvider(f.root, f.spec, { credentials })).rejects.toThrow(pattern);
    await expect(fs.lstat(path.join(f.root, "jobs/background-job"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.calls).toHaveLength(0);
  });

  it("real HTTP generation creates a receipt-bound candidate without accepting; credentials never persist", async () => {
    const f = await providerFixture();
    const result = await run(f.root, f.spec, { credentials: f.credentials });
    expect(result.receipt.outcome).toBe("succeeded"); expect(result.receipt.snapshot).toBeNull(); expect(result.receipt.host).toBe("newmoney.image-engine");
    expect(result.receipt.parameters.client_post_attempts).toBe(1); expect(result.receipt.parameters.usage).toEqual({ input_tokens: 12, output_tokens: 24 });
    expect((result.receipt.parameters.billing as JsonRecord).state).toBe("UNVERIFIED"); expect(result.receipt.provider_execution_id).toBe("request-test-123");
    expect((await readProject(f.root)).sha256).toBe(f.created.sha256); expect(result.candidate.status).toBe("ready");
    expect(f.calls).toHaveLength(1); expect(f.calls[0]?.headers.authorization).toBe(`Bearer ${fakeKey}`);
    const body = JSON.parse(f.calls[0]?.body.toString() ?? "{}") as JsonRecord;
    expect(body.model).toBe("gpt-image-2.5-sunburst"); expect(body.n).toBe(1); expect(String(body.prompt)).toContain("BACKGROUND / SCENE");
    for (const entry of await fs.readdir(result.job)) if (entry.endsWith(".json") || entry.endsWith(".md")) expect(await fs.readFile(path.join(result.job, entry), "utf8")).not.toContain(fakeKey);
    await acceptCandidate(f.root, { candidate_id: f.spec.candidate_id, base_revision: 1, author: "agent", summary: "Accept test output" });
    expect((await readProject(f.root)).document.revision).toBe(2);
    await fs.appendFile(path.join(result.job, "receipt.json"), "\n");
    await expect(inspectCandidate(f.root, f.spec.candidate_id)).rejects.toThrow(/Execution binding digest/);
  });

  it("Flare uses its explicit model ID; invalid formal jobs/references/stale revisions fail before POST", async () => {
    const f = await providerFixture();
    const opts = { credentials: f.credentials };
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

  it("HTTP error is redacted, does not retry, and the job claim prevents rerunning a failed request", async () => {
    const f = await providerFixture((_call, res) => { res.statusCode = 503; res.end(JSON.stringify({ error: { message: `${fakeKey} secret provider body` } })); });
    const error = await failure(executeProvider(f.root, f.spec, { credentials: f.credentials }));
    expect(receiptOf(error).outcome).toBe("failed"); expect(receiptOf(error).parameters.http_status).toBe(503); expect(JSON.stringify(error.receipt)).not.toContain(fakeKey);
    expect(f.calls).toHaveLength(1); expect((await readProject(f.root)).sha256).toBe(f.created.sha256);
    await expect(executeProvider(f.root, f.spec, { credentials: f.credentials })).rejects.toThrow(/EEXIST/); expect(f.calls).toHaveLength(1);
  });

  for (const mode of ["timeout", "cancel"] as const) {
    it(`${mode} has no accepted revision or success output and does not retry`, async () => {
      const controller = new AbortController();
      const f = await providerFixture(() => { if (mode === "cancel") controller.abort(); });
      const error = await failure(executeProvider(f.root, f.spec, { credentials: f.credentials, timeoutMs: 1000, signal: controller.signal }));
      const receipt = receiptOf(error);
      expect(receipt.outcome).toBe(mode === "cancel" ? "cancelled" : "failed");
      expect(receipt.provider_errors[0]?.code).toBe(mode === "cancel" ? "cancelled" : "timeout"); expect(receipt.provider_errors[0]?.upstream_execution_unknown).toBe(true);
      expect(receipt.outputs).toEqual([]); expect(f.calls).toHaveLength(1); expect((await readProject(f.root)).sha256).toBe(f.created.sha256);
    });
  }

  for (const mode of ["url", "invalid-base64", "wrong-size"] as const) {
    it(`${mode} output fails closed with a durable receipt`, async () => {
      const f = await providerFixture(async (_call, res) => {
        const image = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#ffffff" } }).png().toBuffer();
        res.end(JSON.stringify({ data: [mode === "url" ? { url: "https://invalid.example/image.png" } : { b64_json: mode === "wrong-size" ? image.toString("base64") : "!!not-base64" }] }));
      });
      await expect(executeProvider(f.root, f.spec, { credentials: f.credentials })).rejects.toThrow(/see bound receipt/);
      const receipt = await readJson(path.join(f.root, "jobs/background-job/receipt.json")) as ProviderReceipt;
      expect(receipt.outcome).toBe(mode === "wrong-size" ? "partial" : "failed");
      if (mode === "wrong-size") { expect(receipt.outputs).toHaveLength(1); expect((receipt.parameters.returned_image as JsonRecord).width).toBe(64); }
      else expect(receipt.outputs).toEqual([]);
      expect((await readProject(f.root)).sha256).toBe(f.created.sha256); expect(f.calls).toHaveLength(1);
    });
  }

  it("human edit during generation leaves successful Provider output in a stale candidate", async () => {
    const f = await providerFixture(async (_call, res, image, root) => {
      await editBatch(root, { base_revision: 1, author: "human", summary: "Human price edit", operations: [{ type: "update_object", id: "price", patch: { text: "¥149" } }] });
      res.end(JSON.stringify({ data: [{ b64_json: image.toString("base64") }] }));
    });
    const result = await run(f.root, f.spec, { credentials: f.credentials });
    expect(result.receipt.outcome).toBe("succeeded"); expect(result.candidate.status).toBe("stale");
    await expect(acceptCandidate(f.root, { candidate_id: f.spec.candidate_id, base_revision: 2, author: "agent", summary: "Must fail" })).rejects.toThrow(/Candidate base revision/);
    expect(((await readProject(f.root)).document.objects.find((o) => o.id === "price") as TextObject).text).toBe("¥149");
  });

  it("masked HTTP edit converts local polarity to Provider alpha and preserves protected/outside pixels", async () => {
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
    const result = await run(f.root, f.spec, { credentials: f.credentials });
    expect(f.calls[0]?.url).toBe("/v1/images/edits"); expect(f.calls[0]?.headers["content-type"]).toMatch(/^multipart\/form-data/);
    const alpha = await sharp(path.join(result.job, "provider-mask.png")).ensureAlpha().raw().toBuffer();
    expect(alpha[(820 * 1024 + 930) * 4 + 3]).toBe(255); expect(alpha[(820 * 1024 + 940) * 4 + 3]).toBe(0); expect(alpha[3]).toBe(255);
    expect(result.candidate.candidate.qa?.protected_changed_pixels).toBe(0); expect(result.candidate.candidate.qa?.outside_blend_changed_pixels).toBe(0);
    expect((await readProject(f.root)).sha256).toBe(f.created.sha256);
  });

  it("concurrent runs of the same job publish one claim and send exactly one client POST", async () => {
    const f = await providerFixture();
    const results = await Promise.allSettled([run(f.root, f.spec, { credentials: f.credentials }), run(f.root, f.spec, { credentials: f.credentials })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(f.calls).toHaveLength(1);
  });

  it("Provider success with unstageable output is retained and cannot trigger a second generation", async () => {
    const f = await providerFixture(async (_call, res, _image, root) => {
      const project = await readProject(root);
      const asset = project.document.assets.find((a) => a.id === (project.document.objects.find((o) => o.id === "background") as ImageObject).asset_id);
      res.end(JSON.stringify({ data: [{ b64_json: (await fs.readFile(path.join(root, asset?.render_file ?? ""))).toString("base64") }] }));
    });
    const error = await failure(executeProvider(f.root, f.spec, { credentials: f.credentials }));
    expect(receiptOf(error).outcome).toBe("succeeded"); expect(error.message).toMatch(/Output retained/);
    expect((await readJson(path.join(error.output ?? "", "result.json"))).status).toBe("candidate_failed");
    expect((await fs.stat(path.join(error.output ?? "", "output.png"))).size).toBeGreaterThan(0);
    await expect(executeProvider(f.root, f.spec, { credentials: f.credentials })).rejects.toThrow(/EEXIST/); expect(f.calls).toHaveLength(1);
  });

  it("explicit same-aspect normalization retains native output and binds the resized PNG", async () => {
    const f = await providerFixture(async (call, res, image) => respondImage(await sharp(image).resize(1254, 1254).png().toBuffer())(call, res));
    const result = await run(f.root, { ...f.spec, output_policy: "resize_to_target" }, { credentials: f.credentials });
    const normalization = result.receipt.parameters.output_normalization as JsonRecord;
    expect(normalization.source_size).toEqual([1254, 1254]); expect(normalization.target_size).toEqual([1024, 1024]); expect(normalization.crop).toBe(false);
    expect(result.receipt.outputs).toHaveLength(2); expect(result.candidate.candidate.source.width).toBe(1024); expect(f.calls).toHaveLength(1);
    await inspectCandidate(f.root, f.spec.candidate_id);
  });

  it("retained native-size output recovers offline without mutating the old receipt or repeating POST", async () => {
    const f = await providerFixture(async (call, res, image) => respondImage(await sharp(image).resize(1254, 1254).png().toBuffer())(call, res));
    await expect(executeProvider(f.root, f.spec, { credentials: f.credentials })).rejects.toThrow(/see bound receipt/);
    const before = await fs.readFile(path.join(f.root, "jobs/background-job/receipt.json"));
    const recovered = await recoverProvider(f.root, { job_id: "background-job", candidate_id: "recovered-native", output_policy: "resize_to_target" });
    expect(recovered.network_requests).toBe(0); expect(f.calls).toHaveLength(1); expect(recovered.candidate.status).toBe("ready");
    expect(await fs.readFile(path.join(f.root, "jobs/background-job/receipt.json"))).toEqual(before);
    await acceptCandidate(f.root, { candidate_id: "recovered-native", base_revision: 1, author: "agent", summary: "Accept resampled fixture" });
    await fs.appendFile(path.join(f.root, "jobs/background-job/received-output.png"), "tamper");
    await expect(inspectCandidate(f.root, "recovered-native")).rejects.toThrow(/Normalization source binding/);
  });

  it("normalization does not crop or stretch a different aspect ratio", async () => {
    const f = await providerFixture(async (call, res, image) => respondImage(await sharp(image).resize(1024, 1536).png().toBuffer())(call, res));
    await expect(executeProvider(f.root, { ...f.spec, output_policy: "resize_to_target" }, { credentials: f.credentials })).rejects.toThrow(/see bound receipt/);
    await expect(recoverProvider(f.root, { job_id: "background-job", candidate_id: "reject-distortion", output_policy: "resize_to_target" })).rejects.toThrow(/output_dimensions/);
    expect(f.calls).toHaveLength(1); expect((await readProject(f.root)).sha256).toBe(f.created.sha256);
  });

  it("receipt validation failure after POST retains an unvalidated receipt that recovery promotes without another request", async () => {
    const f = await providerFixture();
    const failingOnce = { ...canonicalContracts, validateReceipt: () => ({ valid: false, errors: ["simulated"], warnings: [] }) };
    await expect(executeProvider(f.root, f.spec, { credentials: f.credentials, contracts: failingOnce })).rejects.toThrow(/unvalidated receipt .* retained/);
    const job = path.join(f.root, "jobs/background-job");
    expect(await fs.readdir(job)).toContain("receipt.unvalidated.json"); expect(await fs.readdir(job)).not.toContain("receipt.json");
    const recovered = await recoverProvider(f.root, { job_id: "background-job", candidate_id: "promoted" });
    expect(recovered.network_requests).toBe(0); expect(f.calls).toHaveLength(1); expect(recovered.candidate.status).toBe("ready");
    expect(await fs.readFile(path.join(job, "receipt.json"))).toEqual(await fs.readFile(path.join(job, "receipt.unvalidated.json")));
    await expect(recoverProvider(f.root, { job_id: "background-job", candidate_id: "again" })).rejects.toThrow(/already recorded a result/);
  });

  it("a revision conflict found before the POST releases the job claim so the job can run later", async () => {
    const f = await providerFixture();
    // The credential resolver runs after preparation and before the claim/POST: edit the project there.
    const editing = async () => {
      await editBatch(f.root, { base_revision: 1, author: "human", summary: "Price edit during preparation", operations: [{ type: "update_object", id: "price", patch: { text: "¥88" } }] });
      return f.credentials();
    };
    await expect(executeProvider(f.root, f.spec, { credentials: editing })).rejects.toThrow(/No Provider request sent \(preflight_revision_conflict\)/);
    expect(f.calls).toHaveLength(0);
    await expect(fs.lstat(path.join(f.root, "jobs/background-job"))).rejects.toMatchObject({ code: "ENOENT" });
    const result = await run(f.root, { ...f.spec, base_revision: 2 }, { credentials: f.credentials });
    expect(result.receipt.outcome).toBe("succeeded"); expect(f.calls).toHaveLength(1);
  });
});
