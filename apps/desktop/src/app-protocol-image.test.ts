import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { isImagePreviewUrl, parseImagePreviewUrl, readImagePreview, trustedWorkspaceRoot } from "./app-protocol-image.js";
import { createNativeWorkspaceDescriptor } from "./workspace-identity.js";
import type { WorkbenchStateStore } from "./workbench-state.js";

const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const digest = createHash("sha256").update(png).digest("hex");
const url = (rest: string): string => `app://pi67/image/${rest}`;

async function workspace(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "image-preview-")));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  const previews = path.join(root, ".newmoney/image-work/poster/previews");
  await fs.mkdir(previews, { recursive: true });
  await fs.writeFile(path.join(previews, `${digest}.png`), png);
  return root;
}

describe("app:// image previews", () => {
  it("recognises only the image route and strict references", () => {
    expect(isImagePreviewUrl(url(`w1/poster/${digest}.png`))).toBe(true);
    expect(isImagePreviewUrl("app://pi67/index.html")).toBe(false);
    expect(isImagePreviewUrl("not a url")).toBe(false);
    expect(parseImagePreviewUrl(url(`w1/poster/${digest}.png`))).toEqual({ workspaceId: "w1", projectId: "poster", pngSha256: digest });
    for (const bad of [
      url(`w1/poster/${digest}.png?x=1`), url(`w1/poster/${digest}.png#a`), url(`w1/poster/${digest}.jpg`), url(`w1/poster/${digest.toUpperCase()}.png`),
      url(`w1/../poster/${digest}.png`), url(`w1/poster/previews/${digest}.png`), url(`w%2F1/poster/${digest}.png`), url(`w1/1poster/${digest}.png`),
      `app://other/image/w1/poster/${digest}.png`, `app://user@pi67/image/w1/poster/${digest}.png`, `file:///image/w1/poster/${digest}.png`, "::"
    ]) expect(parseImagePreviewUrl(bad), bad).toBeUndefined();
  });

  it("serves a preview whose bytes match its digest from a trusted Workspace", async () => {
    const root = await workspace();
    const response = await readImagePreview(url(`w1/poster/${digest}.png`), (id) => Promise.resolve(id === "w1" ? root : undefined));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });

  it("answers 404 for unknown Workspaces, missing files, tampered bytes, symlinks and directories", async () => {
    const root = await workspace();
    const resolver = (): Promise<string> => Promise.resolve(root);
    expect((await readImagePreview(url(`w2/poster/${digest}.png`), () => Promise.resolve(undefined))).status).toBe(404);
    expect((await readImagePreview(url(`w1/poster/${"b".repeat(64)}.png`), resolver)).status).toBe(404);
    expect((await readImagePreview(url("w1/poster/not-a-digest.png"), resolver)).status).toBe(404);
    const previews = path.join(root, ".newmoney/image-work/poster/previews");
    const other = "c".repeat(64);
    await fs.writeFile(path.join(previews, `${other}.png`), png);
    expect((await readImagePreview(url(`w1/poster/${other}.png`), resolver)).status).toBe(404);
    const outside = path.join(root, "..", `${path.basename(root)}-outside.png`);
    await fs.writeFile(outside, png); onTestFinished(() => fs.rm(outside, { force: true }));
    await fs.mkdir(path.join(root, ".newmoney/image-work/linked/previews"), { recursive: true });
    await fs.symlink(outside, path.join(root, `.newmoney/image-work/linked/previews/${digest}.png`));
    expect((await readImagePreview(url(`w1/linked/${digest}.png`), resolver)).status).toBe(404);
    await fs.mkdir(path.join(root, `.newmoney/image-work/folder/previews/${digest}.png`), { recursive: true });
    expect((await readImagePreview(url(`w1/folder/${digest}.png`), resolver)).status).toBe(404);
    expect((await readImagePreview(url(`w1/poster/${digest}.png`), () => Promise.reject(new Error("store unavailable")))).status).toBe(404);
  });

  it("resolves only persisted, available and trusted Workspaces", async () => {
    const root = await workspace();
    const trusted = await createNativeWorkspaceDescriptor(root, { createId: () => "w1" });
    const store = (workspaces: unknown[]) => () => ({ load: () => Promise.resolve({ state: { workspaces } }) }) as unknown as Pick<WorkbenchStateStore, "load">;
    expect(await trustedWorkspaceRoot(store([trusted]))("w1")).toBe(root);
    expect(await trustedWorkspaceRoot(store([trusted]))("w2")).toBeUndefined();
    expect(await trustedWorkspaceRoot(store([{ ...trusted, trust: "untrusted" }]))("w1")).toBeUndefined();
    expect(await trustedWorkspaceRoot(() => undefined)("w1")).toBeUndefined();
    await fs.rm(root, { recursive: true, force: true });
    expect(await trustedWorkspaceRoot(store([trusted]))("w1")).toBeUndefined();
  });
});
