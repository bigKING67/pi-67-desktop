import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createProject, readProject, editBatch, encode } from "./project.js";
import { demoInput, candidateFixtures, type CandidateFixtures, type DemoInput } from "./test-support/fixtures.js";
import { stageCandidate, listCandidates, inspectCandidate, acceptCandidate, discardCandidate, unlockCandidate, type CandidateInspection } from "./candidates.js";
import { compareCandidate } from "./candidate-compare.js";
import { renderProject } from "./render.js";
import { compositeRaster } from "./composite.js";
import type { ImageDocument, ImageObject, JsonRecord } from "./document.js";
import { batch, objectById, readJson, tempDirectory, tree } from "./test-support/harness.js";

async function fixture(): Promise<{ directory: string; root: string; input: DemoInput; sources: CandidateFixtures }> {
  const directory = await tempDirectory("image-engine-candidate-");
  const input = await demoInput(path.join(directory, "source"));
  const sources = await candidateFixtures(path.join(directory, "candidate-inputs"));
  const root = path.join(directory, "project");
  await createProject(root, input);
  return { directory, root, input, sources };
}
const stage = (sources: { backgrounds: string[] }, id = "pink", base_revision = 1): JsonRecord =>
  ({ id, base_revision, target_id: "background", source: sources.backgrounds[0], mode: "replace", summary: "Pink background candidate" });
const accept = (candidate_id = "pink", base_revision = 1): JsonRecord => ({ candidate_id, base_revision, author: "agent", summary: "Accept background" });
const edit = (base_revision: number, operations: JsonRecord[]): JsonRecord => batch(base_revision, operations, "human");
const patch = (id: string, value: JsonRecord): JsonRecord => ({ type: "update_object", id, patch: value });
const pixels = async (file: string): Promise<Buffer> => sharp(await fs.readFile(file)).ensureAlpha().raw().toBuffer();
const backgroundAsset = (doc: ImageDocument) => doc.assets.find((asset) => asset.id === (objectById(doc, "background") as ImageObject).asset_id);
const inspection = (value: unknown): CandidateInspection => value as CandidateInspection;

describe("image candidates", { timeout: 180_000 }, () => {
  it("three staged candidates preserve the accepted revision and survive source removal/moving the project", async () => {
    const { root, directory, sources } = await fixture();
    const before = await readProject(root);
    expect(await listCandidates(root)).toEqual([]);
    for (let index = 0; index < 3; index++) await stageCandidate(root, { ...stage(sources, `option-${index + 1}`), source: sources.backgrounds[index] });
    const after = await readProject(root);
    expect(after.sha256).toBe(before.sha256); expect(after.document.revision).toBe(1);
    await fs.rm(path.join(directory, "candidate-inputs"), { recursive: true });
    const moved = path.join(directory, "moved"); await fs.rename(root, moved);
    const candidates = await listCandidates(moved);
    expect(candidates).toHaveLength(3); expect(candidates.every((value) => value.status === "ready")).toBe(true);
    expect((await readProject(moved)).sha256).toBe(before.sha256);
  });

  it("acceptance dry-run is read-only; commit changes only target binding and journals one new revision", async () => {
    const { root, sources } = await fixture();
    const before = await readProject(root);
    const staged = await stageCandidate(root, stage(sources));
    const files = await tree(root);
    const planned = await acceptCandidate(root, accept(), { dryRun: true });
    expect(planned.dry_run).toBe(true); expect(await tree(root)).toEqual(files);
    const result = await acceptCandidate(root, accept());
    expect(result.document.revision).toBe(2);
    expect(result.document.change.candidate).toEqual({ id: "pink", sha256: staged.sha256 });
    for (const object of before.document.objects) {
      const now = result.document.objects.find((value) => value.id === object.id);
      expect(now).toEqual(object.id === "background" ? { ...object, asset_id: staged.candidate.output.id } : object);
    }
    expect(result.document.assets.slice(0, before.document.assets.length)).toEqual(before.document.assets);
    expect((await inspectCandidate(root, "pink")).status).toBe("accepted");
    await expect(acceptCandidate(root, accept("pink", 2))).rejects.toThrow(/already accepted/);
  });

  it("discard is terminal and does not change project; acceptance cannot be mixed with unrelated edits", async () => {
    const { root, sources } = await fixture();
    await stageCandidate(root, stage(sources));
    const before = (await readProject(root)).sha256;
    await expect(editBatch(root, edit(1, [{ type: "accept_candidate", candidate_id: "pink" }, patch("price", { text: "¥139" })]))).rejects.toThrow(/isolated/);
    await discardCandidate(root, { candidate_id: "pink", author: "human", summary: "Discard this direction" });
    expect((await inspectCandidate(root, "pink")).status).toBe("discarded");
    await expect(acceptCandidate(root, accept())).rejects.toThrow(/discarded/);
    await expect(discardCandidate(root, { candidate_id: "pink", author: "human", summary: "Again" })).rejects.toThrow(/already discarded/);
    expect((await readProject(root)).sha256).toBe(before);
  });

  it("discard with maximum JSON-escaped summary remains readable and releases its decision lock", async () => {
    const { root, sources } = await fixture();
    const candidateId = "x".repeat(64), summary = "\u0000".repeat(500);
    await stageCandidate(root, stage(sources, candidateId));
    const before = (await readProject(root)).sha256;
    const result = await discardCandidate(root, { candidate_id: candidateId, author: "system", summary });
    expect(result.status).toBe("discarded");
    expect((await inspectCandidate(root, candidateId)).status).toBe("discarded");
    expect((await listCandidates(root))[0]?.status).toBe("discarded");
    expect((await readJson(path.join(root, "candidates", candidateId, "discard.json"))).summary).toBe(summary);
    await expect(fs.stat(path.join(root, "candidates", candidateId, ".decision-lock"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readProject(root)).sha256).toBe(before);
  });

  it("human edits make candidates stale; supplying current revision cannot silently rebase them", async () => {
    const { root, sources } = await fixture();
    await stageCandidate(root, stage(sources));
    await editBatch(root, edit(1, [patch("price", { text: "¥149" })]));
    const before = (await readProject(root)).sha256;
    expect((await inspectCandidate(root, "pink")).status).toBe("stale");
    await expect(acceptCandidate(root, accept())).rejects.toThrow(/Revision conflict/);
    await expect(acceptCandidate(root, accept("pink", 2))).rejects.toThrow(/Candidate base revision conflict/);
    await editBatch(root, edit(2, [patch("background", { locked: true })]));
    await expect(stageCandidate(root, stage(sources, "locked", 3))).rejects.toThrow(/locked/);
    await expect(acceptCandidate(root, accept("pink", 3))).rejects.toThrow(/Candidate base revision conflict/);
    expect((await readProject(root)).sha256).not.toBe(before); // Only the explicit human lock changed it.
  });

  it("undo restores exact PNG while retaining consumed candidate history", async () => {
    const { root, sources, directory } = await fixture();
    const before = await renderProject(root, path.join(directory, "before"));
    await stageCandidate(root, stage(sources)); await acceptCandidate(root, accept());
    await editBatch(root, edit(2, [{ type: "revert_to", revision: 1 }]));
    const undo = await renderProject(root, path.join(directory, "undo"));
    expect(undo.receipt.outputs?.png.sha256).toBe(before.receipt.outputs?.png.sha256);
    const status = await inspectCandidate(root, "pink");
    expect(status.status).toBe("accepted"); expect(status.applied_in_current).toBe(false); expect(status.accepted_revision).toBe(2);
    await expect(acceptCandidate(root, accept("pink", 3))).rejects.toThrow(/already accepted/);
  });

  it("concurrent accept/discard cannot both win; competing candidates on one revision have one commit", async () => {
    const { root, sources } = await fixture();
    await stageCandidate(root, stage(sources));
    const results = await Promise.allSettled([acceptCandidate(root, accept()), discardCandidate(root, { candidate_id: "pink", author: "human", summary: "Discard" })]);
    expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((value) => value.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as Error).message).toMatch(/decision in progress|already accepted|discarded/);
    const state = await inspectCandidate(root, "pink"); expect(["accepted", "discarded"]).toContain(state.status); expect(state.decision_pending).toBe(false);
    const other = await fixture();
    await stageCandidate(other.root, stage(other.sources, "a"));
    await stageCandidate(other.root, { ...stage(other.sources, "b"), source: other.sources.backgrounds[1] });
    const commits = await Promise.allSettled([acceptCandidate(other.root, accept("a")), acceptCandidate(other.root, accept("b"))]);
    expect(commits.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    const lost = commits.find((value) => value.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as Error).message).toMatch(/Revision conflict/);
    expect((await readProject(other.root)).document.revision).toBe(2);
  });

  it("candidate IDs matching Object prototype names are ordinary IDs, not inherited decisions", async () => {
    const { root, sources } = await fixture();
    await stageCandidate(root, stage(sources, "constructor"));
    expect((await inspectCandidate(root, "constructor")).status).toBe("ready");
    await acceptCandidate(root, accept("constructor"));
    expect((await inspectCandidate(root, "constructor")).status).toBe("accepted");
  });

  it("candidate output/mask/accepted-manifest tampering and abandoned decision locks fail closed", async () => {
    for (const mode of ["output", "mask", "manifest", "lock"]) {
      const { root, sources } = await fixture();
      await stageCandidate(root, stage(sources));
      let entry = await inspectCandidate(root, "pink");
      if (mode === "mask") {
        await acceptCandidate(root, accept());
        await stageCandidate(root, { ...stage(sources, "clean", 2), source: sources.clean, mode: "masked", edit: sources.edit });
        entry = await inspectCandidate(root, "clean");
        await fs.writeFile(path.join(root, entry.candidate.edit?.blend_mask.file ?? ""), Buffer.from("bad mask"));
        await expect(acceptCandidate(root, accept("clean", 2))).rejects.toThrow(/digest mismatch/);
        expect((await readProject(root)).document.revision).toBe(2);
      } else if (mode === "manifest") {
        await acceptCandidate(root, accept());
        const file = path.join(root, "candidates/pink/candidate.json"); const value = await readJson(file); value.summary = "tampered"; await fs.writeFile(file, encode(value));
        await expect(readProject(root)).rejects.toThrow(/Accepted candidate digest mismatch/);
      } else if (mode === "lock") {
        await fs.writeFile(path.join(root, "candidates/pink/.decision-lock"), "{}");
        expect((await inspectCandidate(root, "pink")).status).toBe("decision_pending");
        await expect(acceptCandidate(root, accept())).rejects.toThrow(/decision in progress/);
        expect((await readProject(root)).document.revision).toBe(1);
      } else {
        await fs.writeFile(path.join(root, entry.candidate.output.file), Buffer.from("bad output"));
        await expect(acceptCandidate(root, accept())).rejects.toThrow(/digest mismatch/);
        expect((await readProject(root)).document.revision).toBe(1);
      }
    }
  });

  it("masked composite preserves protected/outside pixels even when proposal changes the whole image", async () => {
    const { root, sources, directory } = await fixture();
    await stageCandidate(root, stage(sources)); await acceptCandidate(root, accept());
    const original = await readProject(root);
    const asset = backgroundAsset(original.document);
    const altered = path.join(directory, "globally-changed.png");
    await fs.writeFile(altered, await sharp(sources.clean).modulate({ brightness: 0.6 }).png().toBuffer());
    const staged = await stageCandidate(root, { ...stage(sources, "clean", 2), source: altered, mode: "masked", edit: sources.edit });
    const before = await pixels(path.join(root, asset?.render_file ?? "")), after = await pixels(path.join(root, staged.candidate.output.file));
    const protection = await sharp(await fs.readFile(sources.edit.protection_mask)).toColourspace("b-w").raw().toBuffer();
    const blend = await sharp(await fs.readFile(sources.edit.blend_mask)).toColourspace("b-w").raw().toBuffer();
    let changed = 0;
    for (let pixel = 0; pixel < 1_000_000; pixel++) {
      const at = pixel * 4;
      if (!before.subarray(at, at + 4).equals(after.subarray(at, at + 4))) { changed++; expect(protection[pixel]).toBe(0); expect(blend[pixel]).toBeTruthy(); }
    }
    expect(changed).toBeGreaterThan(100); expect(changed).toBe(staged.candidate.qa?.changed_pixels);
    expect(staged.candidate.qa?.protected_changed_pixels).toBe(0); expect(staged.candidate.qa?.outside_blend_changed_pixels).toBe(0);
    const first = await renderProject(root, path.join(directory, "before-local"));
    await acceptCandidate(root, accept("clean", 2));
    const second = await renderProject(root, path.join(directory, "after-local"));
    const a = await pixels(path.join(first.output, "image.png")), b = await pixels(path.join(second.output, "image.png"));
    for (let pixel = 0; pixel < 1_000_000; pixel++) if (protection[pixel] || !blend[pixel]) {
      const at = pixel * 4; if (!a.subarray(at, at + 4).equals(b.subarray(at, at + 4))) throw new Error(`Unexpected canvas change at ${pixel}`);
    }
  });

  it("soft blend uses premultiplied alpha; protected transparent pixels retain all RGBA bytes", async () => {
    const beforeData = Buffer.from([123, 45, 67, 0, 10, 20, 30, 200, 255, 0, 0, 255]);
    const afterData = Buffer.from([0, 255, 0, 255, 200, 200, 200, 255, 0, 0, 255, 128]);
    const png = (data: Buffer): Promise<Buffer> => sharp(data, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const result = await compositeRaster(await png(beforeData), await png(afterData), { width: 3, height: 1, context: { x: 0, y: 0, width: 3, height: 1 },
      generation: Buffer.from([255, 255, 255]), protection: Buffer.from([255, 0, 0]), blend: Buffer.from([255, 0, 128]) });
    const output = await sharp(result.png).ensureAlpha().raw().toBuffer();
    expect([...output.subarray(0, 8)]).toEqual([...beforeData.subarray(0, 8)]);
    expect([...output.subarray(8)]).toEqual([169, 0, 86, 191]);
    expect(result.qa.protected_changed_pixels).toBe(0); expect(result.qa.outside_blend_changed_pixels).toBe(0);
  });

  it("misaligned/color/soft-protection masks, invalid context and blend scope reject without publishing a candidate", async () => {
    const { root, sources, directory } = await fixture();
    await stageCandidate(root, stage(sources)); await acceptCandidate(root, accept());
    const before = (await readProject(root)).sha256;
    const base = { ...stage(sources, "invalid", 2), source: sources.clean, mode: "masked", edit: sources.edit };
    const color = path.join(directory, "color.png"); await fs.writeFile(color, await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#888888" } }).png().toBuffer());
    const soft = path.join(directory, "soft.png"); await fs.writeFile(soft, await sharp(Buffer.alloc(1_000_000, 128), { raw: { width: 1000, height: 1000, channels: 1 } }).toColourspace("b-w").png().toBuffer());
    const zero = path.join(directory, "zero.png"); await fs.writeFile(zero, await sharp(Buffer.alloc(1_000_000), { raw: { width: 1000, height: 1000, channels: 1 } }).toColourspace("b-w").png().toBuffer());
    for (const editSpec of [
      { ...sources.edit, blend_mask: color }, { ...sources.edit, protection_mask: soft },
      { ...sources.edit, context: { x: 0, y: 0, width: 10, height: 10 } }, { ...sources.edit, generation_mask: zero },
      { ...sources.edit, blend_mask: zero }
    ]) await expect(stageCandidate(root, { ...base, edit: editSpec })).rejects.toThrow(/Mask must|binary|outside context|outside generation|No editable/);
    await expect(fs.stat(path.join(root, "candidates/invalid"))).rejects.toThrow(/ENOENT/);
    expect((await readProject(root)).sha256).toBe(before);
  });

  it("failed/cancelled staging does not touch accepted revision; immutable IDs cannot be reused", async () => {
    const { root, sources } = await fixture();
    const before = (await readProject(root)).sha256;
    const controller = new AbortController(); controller.abort();
    await expect(stageCandidate(root, stage(sources), { signal: controller.signal })).rejects.toThrow(/abort/i);
    expect((await readProject(root)).sha256).toBe(before);
    const staged = await stageCandidate(root, stage(sources));
    await expect(stageCandidate(root, { ...stage(sources), source: sources.backgrounds[1] })).rejects.toThrow(/already exists|EEXIST/);
    expect((await inspectCandidate(root, "pink")).sha256).toBe(staged.sha256);
    expect((await readProject(root)).sha256).toBe(before);
  });

  it("full poster comparison is read-only, labels stale basis, and its preview equals accepted render pixels", async () => {
    const { root, sources, directory } = await fixture();
    await stageCandidate(root, stage(sources));
    const files = await tree(root);
    const compared = await compareCandidate(root, "pink", path.join(directory, "compare"));
    expect(await tree(root)).toEqual(files);
    expect(compared.report.basis_revision).toBe(1); expect(compared.report.visual_quality).toBe("UNVERIFIED");
    const meta = await sharp(await fs.readFile(path.join(compared.output, "comparison.png"))).metadata();
    expect([meta.width, meta.height]).toEqual([1280, 640]);
    await acceptCandidate(root, accept());
    const accepted = await renderProject(root, path.join(directory, "accepted"), { previewMax: 640 });
    const previewReceipt = await readJson(path.join(compared.output, "after/receipt.json"));
    expect((previewReceipt.outputs as { png: { sha256: string } }).png.sha256).toBe(accepted.receipt.outputs?.png.sha256);
    expect((previewReceipt.candidate_preview as JsonRecord).status_at_check).toBe("ready");
    const other = await fixture(); await stageCandidate(other.root, stage(other.sources)); await editBatch(other.root, edit(1, [patch("price", { text: "¥159" })]));
    const stale = await compareCandidate(other.root, "pink", path.join(other.directory, "stale"));
    expect(stale.report.candidate_status_at_check).toBe("stale"); expect(stale.report.current_revision_at_check).toBe(2); expect(stale.report.basis_revision).toBe(1);
    const staleReceipt = await readJson(path.join(stale.output, "after/receipt.json"));
    expect((staleReceipt.candidate_preview as JsonRecord).status_at_check).toBe("stale");
  });

  async function observedPreview(root: string, directory: string, name: string, expected: JsonRecord): Promise<JsonRecord> {
    const before = await tree(root);
    const rendered = await renderProject(root, path.join(directory, name), { candidateId: "pink", previewMax: 640 });
    const receipt = await readJson(path.join(rendered.output, "receipt.json"));
    expect(receipt).toEqual(JSON.parse(JSON.stringify(rendered.receipt)));
    expect(receipt.status).toBe("completed"); expect(receipt.visual_quality).toBe("UNVERIFIED");
    expect(receipt.revision).toBe(1); // The image is still based on the immutable candidate basis.
    const preview = receipt.candidate_preview as JsonRecord;
    expect(preview.id).toBe("pink");
    expect(Number.isFinite(Date.parse(preview.checked_at as string))).toBe(true);
    for (const [key, value] of Object.entries(expected)) expect(preview[key], key).toBe(value);
    expect(await tree(root)).toEqual(before);
    return receipt;
  }
  const pngSha = (receipt: JsonRecord): string => (receipt.outputs as { png: { sha256: string } }).png.sha256;

  it("candidate render receipt preserves ready, stale and discarded state without changing preview pixels", async () => {
    const { root, directory, sources } = await fixture();
    await stageCandidate(root, stage(sources));
    const ready = await observedPreview(root, directory, "ready-receipt", { status_at_check: "ready", current_revision_at_check: 1, accepted_revision: null, applied_in_current: false, stale: false, decision_pending: false });
    await editBatch(root, edit(1, [patch("price", { text: "¥159" })]));
    const stale = await observedPreview(root, directory, "stale-receipt", { status_at_check: "stale", current_revision_at_check: 2, accepted_revision: null, applied_in_current: false, stale: true, decision_pending: false });
    await discardCandidate(root, { candidate_id: "pink", author: "agent", summary: "Rejected visual direction" });
    const discarded = await observedPreview(root, directory, "discarded-receipt", { status_at_check: "discarded", current_revision_at_check: 2, accepted_revision: null, applied_in_current: false, stale: true, decision_pending: false });
    expect(pngSha(ready)).toBe(pngSha(stale));
    expect(pngSha(ready)).toBe(pngSha(discarded));
    await expect(acceptCandidate(root, accept("pink", 2))).rejects.toThrow(/discarded/);
  });

  it("candidate render receipt separates pending decisions and accepted history from current application", async () => {
    const { root, directory, sources } = await fixture();
    await stageCandidate(root, stage(sources));
    const lock = path.join(root, "candidates", "pink", ".decision-lock");
    await fs.writeFile(lock, "{}");
    let pending: JsonRecord;
    try { pending = await observedPreview(root, directory, "pending-receipt", { status_at_check: "decision_pending", current_revision_at_check: 1, accepted_revision: null, applied_in_current: false, stale: false, decision_pending: true }); }
    finally { await fs.unlink(lock); }
    await acceptCandidate(root, accept());
    const accepted = await observedPreview(root, directory, "accepted-receipt", { status_at_check: "accepted", current_revision_at_check: 2, accepted_revision: 2, applied_in_current: true, stale: true, decision_pending: false });
    await editBatch(root, edit(2, [{ type: "revert_to", revision: 1 }]));
    const reverted = await observedPreview(root, directory, "reverted-receipt", { status_at_check: "accepted", current_revision_at_check: 3, accepted_revision: 2, applied_in_current: false, stale: true, decision_pending: false });
    expect(pngSha(pending)).toBe(pngSha(accepted));
    expect(pngSha(accepted)).toBe(pngSha(reverted));
    const current = await renderProject(root, path.join(directory, "ordinary-current"));
    expect(current.receipt.candidate_preview).toBeUndefined(); expect(current.receipt.visual_quality).toBe("UNVERIFIED");
  });

  it("candidate render fails closed when the decision record cannot be verified", async () => {
    const { root, directory, sources } = await fixture();
    await stageCandidate(root, stage(sources));
    await discardCandidate(root, { candidate_id: "pink", author: "agent", summary: "Rejected" });
    const file = path.join(root, "candidates", "pink", "discard.json");
    const decision = await readJson(file); decision.candidate_sha256 = "0".repeat(64);
    await fs.writeFile(file, encode(decision));
    const output = path.join(directory, "invalid-decision");
    await expect(renderProject(root, output, { candidateId: "pink" })).rejects.toThrow(/Discard decision binding mismatch/);
    expect((await readJson(path.join(output, "receipt.json"))).status).toBe("failed");
    await expect(fs.access(path.join(output, "image.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("candidate list reports stray and interrupted entries in place; stray files do not use candidate slots", async () => {
    const { root, sources } = await fixture();
    await stageCandidate(root, stage(sources));
    await fs.writeFile(path.join(root, "candidates", ".DS_Store"), "");
    await fs.mkdir(path.join(root, "candidates", "interrupted"));
    const listed = await listCandidates(root);
    expect(listed.map((item) => "candidate" in item ? item.candidate.id : item.candidate_id)).toEqual(["interrupted", "pink"]);
    expect(listed[0]?.status).toBe("incomplete"); expect(listed[1]?.status).toBe("ready");
    await expect(stageCandidate(root, stage(sources, "interrupted"))).rejects.toThrow(/already exists/);
    await stageCandidate(root, { ...stage(sources, "second"), source: sources.backgrounds[1] });
  });

  it("a stale decision lock is released only with an audit record and never while its holder runs", async () => {
    const { root, sources } = await fixture();
    await stageCandidate(root, stage(sources));
    const lock = path.join(root, "candidates", "pink", ".decision-lock");
    const unlock = { candidate_id: "pink", author: "human", summary: "Release lock left by killed process" };
    await fs.writeFile(lock, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
    await expect(unlockCandidate(root, unlock)).rejects.toThrow(/still running/);
    let dead = 999_999; while ((() => { try { process.kill(dead, 0); return true; } catch { return false; } })()) dead++;
    await fs.writeFile(lock, JSON.stringify({ pid: dead, created_at: new Date().toISOString() }));
    expect((await inspectCandidate(root, "pink")).decision_pending).toBe(true);
    await expect(discardCandidate(root, { candidate_id: "pink", author: "agent", summary: "Discard" })).rejects.toThrow(/decision in progress/);
    const result = await unlockCandidate(root, unlock);
    expect(result.status).toBe("unlocked"); expect(result.lock?.pid).toBe(dead); expect(inspection(result.candidate).decision_pending).toBe(false);
    expect((await fs.readdir(path.join(root, "candidates", "pink"))).some((name) => name.startsWith("lock-release-"))).toBe(true);
    await expect(unlockCandidate(root, unlock)).rejects.toThrow(/No decision lock/);
    expect((await discardCandidate(root, { candidate_id: "pink", author: "agent", summary: "Discard" })).status).toBe("discarded");
  });

  it("replacement that only changes PNG encoding is not a raster change", async () => {
    const { root, directory } = await fixture();
    const project = await readProject(root);
    const asset = backgroundAsset(project.document);
    const rendered = await fs.readFile(path.join(root, asset?.render_file ?? ""));
    const { data, info } = await sharp(rendered).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const reencoded = path.join(directory, "reencoded.png");
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 1 }).toFile(reencoded);
    await expect(stageCandidate(root, stage({ backgrounds: [reencoded] }))).rejects.toThrow(/no raster change/);
  });
});
