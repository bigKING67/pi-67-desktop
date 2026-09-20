import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";

const handles = vi.hoisted(() => ({ active: 0, peak: 0, fail: false }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args);
    handles.active++; handles.peak = Math.max(handles.peak, handles.active);
    let reads = 0;
    return {
      stat: async () => { if (++reads === 2 && handles.fail) throw new Error("Synthetic metadata failure"); return handle.stat(); },
      createReadStream: (options: Parameters<typeof handle.createReadStream>[0]) => handle.createReadStream(options),
      close: async () => { try { await handle.close(); } finally { handles.active--; } }
    };
  } };
});
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-tree-")); roots.push(root);
  await mkdir(join(root, "05-nested"));
  for (let i = 0; i < 32; i++) {
    await writeFile(join(root, `${String(i).padStart(2, "0")}-文件`), Buffer.alloc(i * 8192, i));
    await writeFile(join(root, "05-nested", `${i}`), `nested-${i}`);
  }
  return root;
}
function serialIdentity(root: string) {
  const hash = createHash("sha256"); let files = 0; let bytes = 0;
  function visit(directory: string) {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry); const metadata = lstatSync(path);
      const name = relative(root, path).split(sep).join("/");
      if (metadata.isSymbolicLink()) hash.update(JSON.stringify(["link", name, readlinkSync(path)]));
      else if (metadata.isDirectory()) visit(path);
      else {
        const content = readFileSync(path); files++; bytes += content.length;
        hash.update(JSON.stringify(["file", name, metadata.mode & 0o777, createHash("sha256").update(content).digest("hex")]));
      }
    }
  }
  visit(root); return { sha256: hash.digest("hex"), files, bytes };
}
afterEach(async () => {
  expect(handles.active).toBe(0);
  handles.fail = false; handles.peak = 0;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe("bounded runtime tree hashing", () => {
  it("preserves serial order across directories with at most eight open files", async () => {
    const root = await fixture();
    expect(await runtimeTreeIdentity(root)).toEqual(serialIdentity(root));
    expect(handles.peak).toBeGreaterThan(1); expect(handles.peak).toBeLessThanOrEqual(8);
  });
  it.skipIf(process.platform === "win32")("preserves link ordering and executable modes and rejects escaping links", async () => {
    const root = await fixture();
    await symlink("00-文件", join(root, "03-link"));
    await chmod(join(root, "01-文件"), 0o700);
    expect(await runtimeTreeIdentity(root)).toEqual(serialIdentity(root));
    await symlink("..", join(root, "04-escape"));
    await expect(runtimeTreeIdentity(root)).rejects.toThrow(/escapes/u);
  });
  it("drains sibling handles before returning a file failure", async () => {
    const root = await fixture(); handles.fail = true;
    await expect(runtimeTreeIdentity(root)).rejects.toThrow(/Synthetic/u);
    expect(handles.active).toBe(0);
  });
  it.each([1, 2, 3, 4, 5])("cancels in-flight work and closes all handles (attempt %i)", async () => {
    const root = await fixture(); const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5);
    try { await expect(runtimeTreeIdentity(root, abort.signal)).rejects.toThrow(); }
    finally { clearTimeout(timer); }
    expect(handles.active).toBe(0);
  });
  it("rejects an already aborted request before opening files", async () => {
    const root = await fixture(); const abort = new AbortController(); abort.abort();
    await expect(runtimeTreeIdentity(root, abort.signal)).rejects.toThrow();
    expect(handles.peak).toBe(0);
  });
});
