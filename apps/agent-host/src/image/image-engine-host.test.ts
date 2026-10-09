import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, onTestFinished } from "vitest";
import { IMAGE_LIBRARY_MARKER } from "@pi67/domain";
import { createProject, previewCachePath, projectRoot, readProject, sha256, stageCandidate } from "@pi67/image-engine";
import type { AgentCommand, AgentEvent } from "@pi67/protocol";
import { ImageEngineHost } from "./image-engine-host.js";
import { ImageProjectWatcher } from "./image-project-watcher.js";
import { ImageWorkQueue } from "./image-work-queue.js";
import { imageEngineError } from "./image-engine-errors.js";
import { HostCommandError } from "../protocol-error.js";
import type { ImageCommandType } from "./image-command-router.js";

async function workspace(library = false): Promise<string> {
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "image-host-")));
  onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
  if (library) await fs.writeFile(path.join(cwd, IMAGE_LIBRARY_MARKER), "{}");
  return cwd;
}
async function project(cwd: string, projectId = "poster"): Promise<string> {
  const source = path.join(cwd, `${projectId}-bg.png`);
  await sharp({ create: { width: 256, height: 256, channels: 3, background: "#e4e8dc" } }).png().toFile(source);
  const root = projectRoot(cwd, projectId);
  await fs.mkdir(path.dirname(root), { recursive: true });
  await createProject(root, { project_id: projectId, title: "春日海报", canvas: { width: 256, height: 256, background: "#ffffff" }, assets: [{ id: "background", source }],
    objects: [
      { id: "background", kind: "image", locked: false, visible: true, x: 0, y: 0, width: 256, height: 256, opacity: 1, asset_id: "background", fit: "cover" },
      { id: "headline", kind: "text", locked: false, visible: true, x: 16, y: 16, width: 224, height: 60, opacity: 1, text: "春日", font_size: 32, color: "#263d30", align: "left", line_height: 1.25 }
    ] });
  return root;
}
function host(cwd: string, queue?: ImageWorkQueue, readStagedImage?: (id: string) => Promise<{ mimeType: string; bytes: Buffer }>) {
  const events: AgentEvent[] = [];
  // macOS may replay file events from just before a watch starts; these tests cover the
  // Host's own events, so its watcher never watches (image-project-watcher.test.ts covers it).
  const watcher = new ImageProjectWatcher({ emit: () => undefined, maxWorkspaces: 0 });
  const engine = new ImageEngineHost({ workspaceRoot: () => cwd, emit: (workspaceId, event) => { expect(workspaceId).toBe("w1"); events.push(event); }, watcher, ...(queue ? { queue } : {}), ...(readStagedImage ? { readStagedImage } : {}) });
  const run = <T extends ImageCommandType>(type: T, payload: AgentCommand<T>["payload"], signal?: AbortSignal) =>
    engine.execute("w1", { type, payload } as AgentCommand<T>, signal);
  return { run, events };
}

const lastState = (events: AgentEvent[]): string | undefined => (events.at(-1)?.payload as { state?: string } | undefined)?.state;

describe("image engine host", { timeout: 120_000 }, () => {
  it("creates a project from a staged photo and leaves no work folder", async () => {
    const cwd = await workspace();
    const photo = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#d8c8b0" } }).jpeg().toBuffer();
    const staged = new Map([["photo-1", { mimeType: "image/jpeg", bytes: photo }], ["doc-1", { mimeType: "application/pdf", bytes: Buffer.from("%PDF") }]]);
    const { run, events } = host(cwd, undefined, (id) => { const item = staged.get(id); return item ? Promise.resolve(item) : Promise.reject(new Error("missing")); });
    const created = await run("image.project.createFromPhoto", { projectId: "spring", attachmentId: "photo-1", headline: "春日新品", title: "春日海报" });
    expect(created).toMatchObject({ projectId: "spring", revision: 1, dryRun: false });
    expect(events).toEqual([{ type: "image.project.changed", payload: { projectId: "spring", revision: 1, sha256: created.sha256, author: "human" } }]);
    const read = await readProject(projectRoot(cwd, "spring"));
    expect(read.document.title).toBe("春日海报");
    expect(read.document.objects.some((object) => object.kind === "text" && object.text === "春日新品")).toBe(true);
    expect(await fs.readdir(path.join(cwd, ".newmoney/image-work/spring"))).toEqual([]);
    await expect(run("image.project.createFromPhoto", { projectId: "doc", attachmentId: "doc-1", headline: "x" })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(run("image.project.createFromPhoto", { projectId: "spring", attachmentId: "photo-1", headline: "x" })).rejects.toThrow();
    await expect(host(cwd).run("image.project.createFromPhoto", { projectId: "other", attachmentId: "photo-1", headline: "x" })).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("lists, reads and edits workspace projects as human revisions with change events", async () => {
    const cwd = await workspace();
    await project(cwd, "poster"); await project(cwd, "banner");
    await fs.mkdir(path.join(cwd, ".newmoney/images/not-a-project"));
    await fs.mkdir(path.join(cwd, ".newmoney/images/bad name"));
    const { run, events } = host(cwd);
    const listed = await run("image.project.list", {});
    expect(listed.projects.map((item) => [item.projectId, item.revision, item.readyCandidates])).toEqual([["banner", 1, 0], ["poster", 1, 0]]);
    expect(listed.projects[0]?.updatedAt).toBeGreaterThan(0);
    const read = await run("image.project.read", { projectId: "poster" });
    expect(read).toMatchObject({ projectId: "poster", revision: 1, latestRevision: 1 });
    const dry = await run("image.project.edit", { projectId: "poster", baseRevision: 1, summary: "试排", operations: [{ type: "update_object", id: "headline", patch: { y: 20 } }], dryRun: true });
    expect(dry).toMatchObject({ revision: 2, dryRun: true }); expect(events).toEqual([]);
    const edited = await run("image.project.edit", { projectId: "poster", baseRevision: 1, summary: "改标题", operations: [{ type: "update_object", id: "headline", patch: { text: "自在" } }] });
    expect(edited).toMatchObject({ projectId: "poster", revision: 2, dryRun: false });
    expect(events).toEqual([{ type: "image.project.changed", payload: { projectId: "poster", revision: 2, sha256: edited.sha256, author: "human" } }]);
    expect((await readProject(projectRoot(cwd, "poster"))).document.change.author).toBe("human");
  });

  it("maps engine refusals to typed recoverable protocol errors", async () => {
    const cwd = await workspace();
    await project(cwd);
    const { run } = host(cwd);
    await expect(run("image.project.edit", { projectId: "poster", baseRevision: 5, summary: "过期", operations: [{ type: "update_object", id: "headline", patch: { y: 1 } }] }))
      .rejects.toMatchObject({ code: "RESOURCE_CHANGED_EXTERNALLY", recoverable: true, details: { imageReason: "revision_conflict" } });
    await expect(run("image.project.edit", { projectId: "poster", baseRevision: 1, summary: "太长", operations: [{ type: "update_object", id: "headline", patch: { text: "长".repeat(400) } }] }))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD", details: { imageReason: "text_overflow" } });
    await expect(run("image.project.read", { projectId: "missing" })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND", details: { imageReason: "not_found" } });
    const passthrough = new HostCommandError("BUSY", "x");
    expect(imageEngineError(passthrough)).toBe(passthrough);
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(imageEngineError(abort)).toBe(abort);
    expect(imageEngineError("plain")).toMatchObject({ code: "INVALID_PAYLOAD", details: { imageReason: "invalid" } });
  });

  it("serializes concurrent edits on one base: exactly one wins, the other reports a conflict", async () => {
    const cwd = await workspace();
    await project(cwd);
    const { run } = host(cwd);
    const results = await Promise.allSettled(["一", "二"].map((text) => run("image.project.edit", { projectId: "poster", baseRevision: 1, summary: text, operations: [{ type: "update_object", id: "headline", patch: { text } }] })));
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("renders into the content-addressed preview cache with job events and no leftover work folder", async () => {
    const cwd = await workspace();
    await project(cwd);
    const { run, events } = host(cwd);
    const rendered = await run("image.project.render", { projectId: "poster", previewMax: 128 });
    expect(rendered).toMatchObject({ projectId: "poster", revision: 1, width: 128, height: 128 });
    const cached = await fs.readFile(previewCachePath(cwd, "poster", rendered.pngSha256));
    expect(sha256(cached)).toBe(rendered.pngSha256);
    const work = await fs.readdir(path.join(cwd, ".newmoney/image-work/poster"));
    expect(work).toEqual(["previews"]);
    expect(events.map((event) => (event.payload as { state: string }).state)).toEqual(["queued", "running", "completed"]);
    const again = await run("image.project.render", { projectId: "poster", previewMax: 128 });
    expect(again.pngSha256).toBe(rendered.pngSha256);
  });

  it("reports failed and cancelled renders", async () => {
    const cwd = await workspace();
    await project(cwd);
    const { run, events } = host(cwd);
    await expect(run("image.project.render", { projectId: "poster", revision: 9 })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(lastState(events)).toBe("failed");
    const controller = new AbortController(); controller.abort();
    await expect(run("image.project.render", { projectId: "poster" }, controller.signal)).rejects.toThrow();
    expect(lastState(events)).toBe("cancelled");
  });

  it("lists, accepts and discards candidates with events, recording human decisions", async () => {
    const cwd = await workspace(true);
    const root = await project(cwd);
    expect(root).toBe(path.join(cwd, "poster"));
    for (const [id, color] of [["warm", "#edd9ce"], ["cool", "#d9e3ee"]] as const) {
      const source = path.join(cwd, `${id}.png`);
      await sharp({ create: { width: 256, height: 256, channels: 3, background: color } }).png().toFile(source);
      await stageCandidate(root, { id, base_revision: 1, target_id: "background", source, mode: "replace", summary: `${id} background` });
    }
    const { run, events } = host(cwd);
    expect((await run("image.project.list", {})).projects).toEqual([expect.objectContaining({ projectId: "poster", readyCandidates: 2 })]);
    const listed = await run("image.candidate.list", { projectId: "poster" });
    expect(listed.candidates).toEqual([
      expect.objectContaining({ candidateId: "cool", status: "ready", targetId: "background", mode: "replace", baseRevision: 1, generated: false }),
      expect.objectContaining({ candidateId: "warm", status: "ready" })
    ]);
    expect(await run("image.candidate.discard", { projectId: "poster", candidateId: "cool", summary: "不要冷色" })).toEqual({ projectId: "poster", candidateId: "cool", status: "discarded" });
    const accepted = await run("image.candidate.accept", { projectId: "poster", candidateId: "warm", baseRevision: 1, summary: "采用暖色" });
    expect(accepted).toMatchObject({ revision: 2, dryRun: false });
    expect(events.map((event) => event.type)).toEqual(["image.candidate.changed", "image.project.changed", "image.candidate.changed"]);
    expect((await readProject(root)).document.change).toMatchObject({ author: "human", operations: ["accept_candidate"] });
    await expect(run("image.candidate.accept", { projectId: "poster", candidateId: "cool", baseRevision: 2, summary: "再试" }))
      .rejects.toMatchObject({ details: { imageReason: "candidate_decided" } });
  });

  it("loads the engine lazily and reports an unavailable engine without breaking later retries", async () => {
    const cwd = await workspace();
    let attempts = 0;
    const engine = new ImageEngineHost({ workspaceRoot: () => cwd, emit: () => undefined, loadEngine: async () => {
      attempts++;
      if (attempts === 1) throw new Error("Cannot find module 'sharp'");
      return import("@pi67/image-engine");
    } });
    const list = { type: "image.project.list", payload: {} } as AgentCommand<"image.project.list">;
    expect(attempts).toBe(0);
    await expect(engine.execute("w1", list)).rejects.toMatchObject({ code: "UNSUPPORTED", recoverable: true, details: { imageReason: "engine_unavailable" } });
    expect((await engine.execute("w1", list)).projects).toEqual([]);
    await engine.execute("w1", list);
    expect(attempts).toBe(2);
  });

  it("returns an empty list when the Workspace has no image folder", async () => {
    expect((await host(await workspace()).run("image.project.list", {})).projects).toEqual([]);
  });
});
