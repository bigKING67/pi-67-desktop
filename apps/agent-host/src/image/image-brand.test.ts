import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, onTestFinished } from "vitest";
import { IMAGE_LIBRARY_MARKER } from "@pi67/domain";
import type { AgentCommand } from "@pi67/protocol";
import { ImageEngineHost } from "./image-engine-host.js";
import { ImageProjectWatcher } from "./image-project-watcher.js";
import type { ImageCommandType } from "./image-command-router.js";

// P5 checkpoint 3: the library's brand kit through the Host, from staged files.

const FONT = path.join(import.meta.dirname, "../../../../packages/image-engine/src/test-support/fonts/KaTeX_SansSerif-Regular.ttf");

describe("image brand kit", { timeout: 60_000 }, () => {
  it("adds staged fonts and logos, edits colours and specs on the version read, and is never listed as a project", async () => {
    const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "image-brand-")));
    onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
    await fs.writeFile(path.join(cwd, IMAGE_LIBRARY_MARKER), "{}");
    const logo = await sharp({ create: { width: 90, height: 30, channels: 3, background: "#b5452f" } }).png().toBuffer();
    const host = new ImageEngineHost({ workspaceRoot: () => cwd, emit: () => undefined, watcher: new ImageProjectWatcher({ emit: () => undefined, maxWorkspaces: 0 }),
      readStagedImage: () => Promise.resolve({ mimeType: "image/png", bytes: logo }),
      readStagedFile: async (id) => id === "font" ? { name: "Brand.ttf", bytes: await fs.readFile(FONT) } : { name: "brand.woff", bytes: Buffer.from("x") } });
    const run = <T extends ImageCommandType>(type: T, payload: AgentCommand<T>["payload"]) => host.execute("w1", { type, payload } as AgentCommand<T>);
    expect(await run("image.brand.read", {})).toMatchObject({ revision: 0, colors: [] });
    expect((await run("image.brand.addFont", { baseRevision: 0, attachmentId: "font" })).fonts).toEqual([expect.objectContaining({ id: "font-1", family: "KaTeX_SansSerif" })]);
    await expect(run("image.brand.addFont", { baseRevision: 1, attachmentId: "woff" })).rejects.toThrow(/TTF 或 OTF/u);
    expect((await run("image.brand.addLogo", { baseRevision: 1, name: "主 Logo", attachmentId: "logo" })).logos).toEqual([expect.objectContaining({ name: "主 Logo", width: 90, height: 30 })]);
    const edited = await run("image.brand.edit", { baseRevision: 2, operations: [{ type: "set_color", color: { id: "red", name: "品牌红", value: "#b5452f" } },
      { type: "set_spec", spec: { id: "square", name: "方图", width: 800, height: 800, max_bytes: 3_000_000, background: "white" } }] });
    expect(edited).toMatchObject({ revision: 3, colors: [{ id: "red" }], specs: [{ id: "square" }] });
    await expect(run("image.brand.edit", { baseRevision: 2, operations: [{ type: "remove_color", id: "red" }] })).rejects.toThrow(/conflict/iu);
    expect((await run("image.project.list", {})).projects).toEqual([]);
  });
});
