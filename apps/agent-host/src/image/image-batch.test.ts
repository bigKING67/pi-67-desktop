import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createProject, projectRoot } from "@pi67/image-engine";
import type { AgentCommand } from "@pi67/protocol";
import { ImageEngineHost } from "./image-engine-host.js";
import { ImageProjectWatcher } from "./image-project-watcher.js";
import type { ImageCommandType } from "./image-command-router.js";

// P5 checkpoint 1: a table of rows becomes a batch of projects beside the source, listed
// as a batch and removed as one.

const text = (id: string, words: string, y: number, width: number) =>
  ({ id, kind: "text", locked: false, visible: true, x: 20, y, width, height: 60, opacity: 1, text: words, font_size: 40, color: "#222222", align: "left", line_height: 1.2 });

async function setup() {
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "image-batch-")));
  onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
  const root = projectRoot(cwd, "poster");
  await fs.mkdir(path.dirname(root), { recursive: true });
  await createProject(root, { project_id: "poster", title: "春日茶礼", canvas: { width: 400, height: 300, background: "#ffffff" }, assets: [],
    objects: [text("title", "春日茶礼", 20, 300), text("price", "¥199", 120, 200)] });
  const host = new ImageEngineHost({ workspaceRoot: () => cwd, emit: () => undefined, watcher: new ImageProjectWatcher({ emit: () => undefined, maxWorkspaces: 0 }) });
  const run = <T extends ImageCommandType>(type: T, payload: AgentCommand<T>["payload"]) => host.execute("w1", { type, payload } as AgentCommand<T>);
  return { run };
}

describe("image batches", { timeout: 180_000 }, () => {
  it("writes one project per row, reports refused rows, lists them as a batch and removes them as one", async () => {
    const { run } = await setup();
    const created = await run("image.batch.create", { projectId: "poster", revision: 1, rows: [
      { texts: [{ layer: "price", text: "¥299" }] },
      { texts: [{ layer: "price", text: "¥399" }, { layer: "subtitle", text: "x" }] },
      { texts: [{ layer: "price", text: "¥1" }, { layer: "price", text: "¥2" }] }] });
    expect(created.results.map((result) => result.status)).toEqual(["created", "refused", "refused"]);
    expect(created.results[1]).toMatchObject({ reason: "没有叫「subtitle」的文字图层" });
    expect(created.results[2]).toMatchObject({ reason: "同一个文字图层出现了两次" });
    expect(created.results[0]).toMatchObject({ projectId: `poster-${created.batchId}-1`, title: "春日茶礼 · ¥299" });
    const { projects } = await run("image.project.list", {});
    expect(projects.find((project) => project.projectId === `poster-${created.batchId}-1`)?.batch).toEqual({ batchId: created.batchId, row: 1, projectId: "poster", revision: 1 });
    expect(projects.find((project) => project.projectId === "poster")).not.toHaveProperty("batch");
    expect(await run("image.batch.remove", { batchId: created.batchId })).toEqual({ batchId: created.batchId, removed: [`poster-${created.batchId}-1`] });
    expect((await run("image.project.list", {})).projects.map((project) => project.projectId)).toEqual(["poster"]);
  });

  it("changes the price on 50 SKUs and removes them again, timed", async () => {
    const { run } = await setup();
    const rows = Array.from({ length: 50 }, (_, index) => ({ texts: [{ layer: "title", text: `SKU ${index + 1}` }, { layer: "price", text: `¥${100 + index}` }] }));
    const started = performance.now();
    const created = await run("image.batch.create", { projectId: "poster", revision: 1, rows });
    const createdMs = performance.now() - started;
    expect(created.results.filter((result) => result.status === "created")).toHaveLength(50);
    const removing = performance.now();
    expect((await run("image.batch.remove", { batchId: created.batchId })).removed).toHaveLength(50);
    console.info(`50-SKU batch: created in ${Math.round(createdMs)} ms, removed in ${Math.round(performance.now() - removing)} ms`);
  });
});
