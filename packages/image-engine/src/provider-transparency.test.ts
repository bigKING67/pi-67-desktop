import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { readProject } from "./project.js";
import { executeProvider, recoverProvider, ProviderError, type ProviderReceipt } from "./provider.js";
import { inspectCandidate, acceptCandidate } from "./candidates.js";
import { inspectAlpha, requireAlpha, type AlphaEvidence } from "./provider-alpha.js";
import { readExecution, type ExecutionBinding } from "./provider-store.js";
import { sha256 } from "./content-store.js";
import { providerFixture, respondImage, transparentPNG, writeMasks } from "./test-support/provider-fixture.js";
import { readJson } from "./test-support/harness.js";

type Executed = Extract<Awaited<ReturnType<typeof executeProvider>>, { status: "candidate" }>;
const run = async (...args: Parameters<typeof executeProvider>): Promise<Executed> => (await executeProvider(...args)) as Executed;
async function failure(promise: Promise<unknown>): Promise<ProviderError & { receipt: ProviderReceipt }> {
  try { await promise; } catch (error) { if (error instanceof ProviderError && error.receipt) return error as ProviderError & { receipt: ProviderReceipt }; throw error; }
  throw new Error("expected a ProviderError with a receipt");
}
const transparency = (receipt: ProviderReceipt): { received: AlphaEvidence; output: AlphaEvidence } => receipt.parameters.transparency as { received: AlphaEvidence; output: AlphaEvidence };

describe("transparent Provider outputs", { timeout: 120_000 }, () => {
  for (const model of ["sunburst", "flare"]) {
    it(`${model} transparent PNG binds actual alpha and remains unaccepted`, async () => {
      const image = await transparentPNG();
      const f = await providerFixture(respondImage(image));
      f.job.provider_profile = `openai.gpt-image-2.5-${model}.2026-09-08`; f.job.canvas.background = "transparent"; await f.saveJob();
      const dry = await executeProvider(f.root, f.spec, { dryRun: true });
      expect(dry.status === "dry_run" && dry.request.parameters.background).toBe("transparent"); expect(f.calls).toHaveLength(0);
      const result = await run(f.root, f.spec, { generator: f.generator });
      const checks = transparency(result.receipt);
      expect(f.calls[0]?.parameters.background).toBe("transparent");
      expect(checks.received.zero_pixels).toBe(512 * 1024); expect(checks.received.partial_pixels).toBe(1024);
      expect(checks.output).toEqual(checks.received); expect(checks.output.sha256).toBe(sha256(image));
      expect((await inspectCandidate(f.root, f.spec.candidate_id)).status).toBe("ready");
      expect((await readProject(f.root)).sha256).toBe(f.created.sha256); expect(f.calls).toHaveLength(1);
    });
  }

  for (const [mode, color, channels, code] of [
    ["no-alpha", "#eeeeee", 3, "output_missing_alpha"], ["opaque-rgba", "#eeeeee", 4, "output_no_clear_background"],
    ["partial-only", "#ffffff80", 4, "output_no_clear_background"], ["empty", "#ff00ff00", 4, "output_empty_foreground"]
  ] as const) {
    it(`${mode} output retains a specific failure without retry`, async () => {
      const image = await sharp({ create: { width: 1024, height: 1024, channels, background: color } }).png().toBuffer();
      const f = await providerFixture(respondImage(image));
      f.job.canvas.background = "transparent"; await f.saveJob();
      const error = await failure(executeProvider(f.root, f.spec, { generator: f.generator }));
      expect(error.receipt.outcome).toBe("partial"); expect(error.receipt.provider_errors[0]?.code).toBe(code);
      expect(transparency(error.receipt).received.sha256).toBe(sha256(image));
      expect(await fs.readFile(path.join(error.output ?? "", "received-output.png"))).toEqual(image);
      await expect(fs.stat(path.join(error.output ?? "", "output.png"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(inspectCandidate(f.root, f.spec.candidate_id)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(recoverProvider(f.root, { job_id: "background-job", candidate_id: "invalid-recovery", output_policy: "resize_to_target" })).rejects.toThrow(/partial size-mismatch/);
      await expect(executeProvider(f.root, f.spec, { generator: f.generator })).rejects.toThrow(/EEXIST/);
      expect(f.calls).toHaveLength(1); expect((await readProject(f.root)).sha256).toBe(f.created.sha256);
    });
  }

  for (const background of ["opaque", "auto"]) {
    it(`ordinary ${background} receipts reopen without alpha evidence`, async () => {
      const f = await providerFixture(); f.job.canvas.background = background; await f.saveJob();
      const result = await run(f.root, f.spec, { generator: f.generator });
      expect(result.receipt.parameters.transparency).toBeUndefined();
      await acceptCandidate(f.root, { candidate_id: f.spec.candidate_id, base_revision: 1, author: "agent", summary: "Ordinary compatibility" });
      expect((await inspectCandidate(f.root, f.spec.candidate_id)).status).toBe("accepted");
    });
  }

  for (const hideAllClearPixels of [false, true, "recovery"] as const) {
    it(`transparent edit protects original RGBA (${String(hideAllClearPixels)})`, async () => {
      const image = await transparentPNG(hideAllClearPixels === "recovery" ? 1254 : 1024);
      const f = await providerFixture(respondImage(image));
      const asset = f.created.document.assets.find((a) => a.id === "background");
      if (!asset) throw new Error("missing asset");
      Object.assign(f.job, { task_type: "edit", asset_refs: [asset.id] }); f.job.canvas.background = "transparent";
      Object.assign(f.job.prompt, { references: [{ asset_id: asset.id, role: "edit source", preserve: ["protected pixels"] }], change: ["Transparent background"], preserve: ["Protected pixels"] });
      await f.saveJob();
      f.spec.references = [{ asset_id: asset.id, source: path.join(f.root, asset.render_file) }];
      const full = Buffer.alloc(1024 * 1024, 255), protection = Buffer.alloc(full.length);
      for (let y = 0; y < 1024; y++) for (let x = 0; x < 512; x++) if (hideAllClearPixels || (x < 8 && y < 8)) protection[y * 1024 + x] = 255;
      await writeMasks(f.directory, f.spec, { generation_mask: full, protection_mask: protection, blend_mask: full });
      if (hideAllClearPixels) {
        if (hideAllClearPixels === "recovery") {
          await expect(executeProvider(f.root, f.spec, { generator: f.generator })).rejects.toThrow(/the receipt is kept in the project/);
          const error = await failure(recoverProvider(f.root, { job_id: "background-job", candidate_id: f.spec.candidate_id, output_policy: "resize_to_target" }));
          expect(error.message).toMatch(/candidate staging failed/); expect(error.receipt.outcome).toBe("succeeded");
          expect(await fs.stat(path.join(error.output ?? "", "output.png"))).toBeTruthy();
        } else await expect(executeProvider(f.root, f.spec, { generator: f.generator })).rejects.toThrow(/candidate staging failed/);
        const status = await readJson(path.join(f.root, "jobs/background-job/result.json"));
        expect(status.reason_code).toBe("output_no_clear_background"); expect(status.provider_outcome).toBe("succeeded");
        await expect(inspectCandidate(f.root, f.spec.candidate_id)).rejects.toMatchObject({ code: "ENOENT" });
      } else {
        const result = await run(f.root, f.spec, { generator: f.generator });
        expect(f.calls[0]?.parameters.background).toBe("transparent"); expect(f.calls[0]?.endpoint).toBe("images/edits");
        expect(result.candidate.candidate.qa?.protected_pixels).toBe(64); expect(result.candidate.candidate.qa?.protected_changed_pixels).toBe(0);
        expect(requireAlpha(await inspectAlpha(await fs.readFile(path.join(f.root, result.candidate.candidate.output.file)))).zero_pixels).toBeGreaterThan(0);
        await acceptCandidate(f.root, { candidate_id: f.spec.candidate_id, base_revision: 1, author: "agent", summary: "Technical protected alpha fixture" });
        expect((await inspectCandidate(f.root, f.spec.candidate_id)).status).toBe("accepted");
      }
      expect(f.calls).toHaveLength(1);
    });
  }

  it("transparent size recovery binds raw and normalized alpha without another POST", async () => {
    const f = await providerFixture(respondImage(await transparentPNG(1254)));
    f.job.canvas.background = "transparent"; await f.saveJob();
    await expect(executeProvider(f.root, f.spec, { generator: f.generator })).rejects.toThrow(/the receipt is kept in the project/);
    const old = await fs.readFile(path.join(f.root, "jobs/background-job/receipt.json"));
    const recovered = await recoverProvider(f.root, { job_id: "background-job", candidate_id: "transparent-recovery", output_policy: "resize_to_target" });
    const checks = transparency(recovered.receipt);
    expect(checks.received.width).toBe(1254); expect(checks.output.width).toBe(1024); expect(checks.received.sha256).not.toBe(checks.output.sha256);
    expect(recovered.network_requests).toBe(0); expect(f.calls).toHaveLength(1);
    expect(await fs.readFile(path.join(f.root, "jobs/background-job/receipt.json"))).toEqual(old);
    expect((await inspectCandidate(f.root, "transparent-recovery")).status).toBe("ready");
  });

  it("transparent readback rejects fabricated or missing alpha evidence even with updated receipt digest", async () => {
    const f = await providerFixture(respondImage(await transparentPNG()));
    f.job.canvas.background = "transparent"; await f.saveJob();
    const result = await run(f.root, f.spec, { generator: f.generator });
    const candidate = result.candidate.candidate, binding = { ...candidate.execution } as ExecutionBinding;
    for (const mutation of ["wrong-count", "missing", "wrong-background"]) {
      const receipt = structuredClone(result.receipt);
      if (mutation === "wrong-count") transparency(receipt).output.zero_pixels--;
      if (mutation === "missing") delete receipt.parameters.transparency;
      if (mutation === "wrong-background") receipt.parameters.background = "auto";
      const bytes = Buffer.from(JSON.stringify(receipt)); binding.receipt_sha256 = sha256(bytes);
      await fs.writeFile(path.join(f.root, binding.receipt_file), bytes);
      await expect(readExecution(f.root, binding, candidate.source)).rejects.toThrow(/Transparency/);
    }
  });

  for (const clearRegion of ["half", "one-pixel"]) {
    it(`explicit transparent resampling checks the final alpha (${clearRegion})`, async () => {
      let image: Buffer;
      if (clearRegion === "half") image = await transparentPNG(1254);
      else {
        const pixels = Buffer.alloc(2048 * 2048 * 4, 255); pixels[(1000 * 2048 + 1000) * 4 + 3] = 0;
        image = await sharp(pixels, { raw: { width: 2048, height: 2048, channels: 4 } }).png().toBuffer();
      }
      const f = await providerFixture(respondImage(image));
      f.job.canvas.background = "transparent"; await f.saveJob();
      const spec = { ...f.spec, output_policy: "resize_to_target" };
      if (clearRegion === "half") {
        const result = await run(f.root, spec, { generator: f.generator });
        expect(transparency(result.receipt).output.width).toBe(1024); expect(result.receipt.outputs).toHaveLength(2);
        await inspectCandidate(f.root, f.spec.candidate_id);
      } else {
        const error = await failure(executeProvider(f.root, spec, { generator: f.generator }));
        expect(error.receipt.outcome).toBe("partial"); expect(error.receipt.provider_errors[0]?.code).toBe("output_no_clear_background");
        expect(transparency(error.receipt).received.zero_pixels).toBe(1); expect(transparency(error.receipt).output.zero_pixels).toBe(0);
        expect((await readProject(f.root)).sha256).toBe(f.created.sha256);
      }
      expect(f.calls).toHaveLength(1);
    });
  }

  it("grayscale alpha is measured as RGBA rather than reading channel pairs as pixels", async () => {
    const image = await sharp(await transparentPNG(16)).toColourspace("b-w").png().toBuffer();
    const check = requireAlpha(await inspectAlpha(image));
    expect([check.pixels, check.zero_pixels, check.partial_pixels, check.opaque_pixels]).toEqual([256, 128, 16, 112]);
  });
});
