import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, onTestFinished } from "vitest";
import { createProject, projectRoot, readProject } from "@pi67/image-engine";
import type { AgentCommand } from "@pi67/protocol";
import { ImageEngineHost } from "./image-engine-host.js";
import { ImageProjectWatcher } from "./image-project-watcher.js";
import type { ImageCommandType } from "./image-command-router.js";

// P5 checkpoint 2: templates through the Host — copy, list, and a new project with a staged picture.

describe("image templates", { timeout: 120_000 }, () => {
  it("copies a template, lists it as one, and makes a project from it with new words and a staged picture", async () => {
    const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "image-template-")));
    onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
    const photo = path.join(cwd, "photo.png");
    await sharp({ create: { width: 400, height: 300, channels: 3, background: "#d8c8b0" } }).png().toFile(photo);
    const root = projectRoot(cwd, "poster");
    await fs.mkdir(path.dirname(root), { recursive: true });
    await createProject(root, { project_id: "poster", title: "春日茶礼", canvas: { width: 400, height: 300, background: "#ffffff" }, assets: [{ id: "photo", source: photo }],
      objects: [{ id: "photo", kind: "image", locked: true, visible: true, x: 0, y: 0, width: 400, height: 300, opacity: 1, asset_id: "photo", fit: "cover" },
        { id: "title", kind: "text", locked: false, visible: true, x: 20, y: 20, width: 300, height: 60, opacity: 1, text: "春日茶礼", font_size: 40, color: "#222222", align: "left", line_height: 1.2 }] });
    const picture = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#204060" } }).png().toBuffer();
    const host = new ImageEngineHost({ workspaceRoot: () => cwd, emit: () => undefined, watcher: new ImageProjectWatcher({ emit: () => undefined, maxWorkspaces: 0 }),
      readStagedImage: (id) => id === "pic" ? Promise.resolve({ mimeType: "image/png", bytes: picture }) : Promise.resolve({ mimeType: "image/gif", bytes: Buffer.from("GIF89a") }) });
    const run = <T extends ImageCommandType>(type: T, payload: AgentCommand<T>["payload"]) => host.execute("w1", { type, payload } as AgentCommand<T>);

    expect(await run("image.template.create", { projectId: "poster", revision: 1 })).toEqual({ projectId: "poster-template", title: "春日茶礼 · 模板", slots: ["photo", "title"] });
    const made = await run("image.template.instantiate", { templateId: "poster-template", projectId: "summer", title: "夏日冷萃",
      texts: [{ layer: "title", text: "夏日冷萃" }], images: [{ layer: "photo", attachmentId: "pic" }] });
    expect(made).toEqual({ status: "created", projectId: "summer" });
    const summer = (await readProject(projectRoot(cwd, "summer"))).document;
    expect(summer.objects.find((object) => object.id === "photo")).toMatchObject({ asset_id: "photo-image", locked: false });
    expect(await run("image.template.instantiate", { templateId: "poster-template", projectId: "gif", title: "x", texts: [], images: [{ layer: "photo", attachmentId: "gif" }] }))
      .toEqual({ status: "refused", reason: "只支持 PNG、JPEG 或 WebP 图片。" });
    const { projects } = await run("image.project.list", {});
    expect(projects.find((project) => project.projectId === "poster-template")).toMatchObject({ template: true });
    expect(projects.find((project) => project.projectId === "summer")).toMatchObject({ fromTemplate: { projectId: "poster-template", revision: 1 } });
    expect(projects.find((project) => project.projectId === "summer")).not.toHaveProperty("template");
    // A work folder for the picture never stays behind.
    expect(await fs.readdir(path.join(cwd, ".newmoney", "image-work", "gif")).catch(() => [])).toEqual([]);
  });
});
