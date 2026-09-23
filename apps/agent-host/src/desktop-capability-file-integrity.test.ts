import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { capabilityTreeSha256 } from "./desktop-capability-file-integrity.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-integrity-batch-"));
  roots.push(root);
  return root;
}

describe("capability tree hash batching", () => {
  it("preserves ordered digest across count, byte, directory and oversized-file boundaries", async () => {
    const root = await fixture();
    const files = [
      ...Array.from({ length: 19 }, (_, index) => ({
        path: `a${String(index).padStart(2, "0")}.txt`, content: Buffer.alloc(170_000, index)
      })),
      { path: "b/nested.txt", content: Buffer.from("nested\0content") },
      { path: "c.txt", content: Buffer.alloc(2 * 1024 * 1024 + 1, 99) },
      { path: "d.txt", content: Buffer.from("tail") }
    ];
    await mkdir(join(root, "b"));
    const expected = createHash("sha256");
    for (const file of files) {
      await writeFile(join(root, file.path), file.content);
      expected.update(`f\0${file.path}\0`).update(file.content).update("\0");
    }
    await expect(capabilityTreeSha256(root)).resolves.toBe(expected.digest("hex"));
  });

  it("keeps ignored files and optional node_modules out of the default digest", async () => {
    const root = await fixture();
    await mkdir(join(root, "node_modules", "fixture"), { recursive: true });
    await writeFile(join(root, ".DS_Store"), "ignored");
    await writeFile(join(root, "node_modules", "fixture", "index.js"), "module");
    await expect(capabilityTreeSha256(root)).resolves.toBe(createHash("sha256").digest("hex"));
    const expected = createHash("sha256").update("f\0node_modules/fixture/index.js\0module\0").digest("hex");
    await expect(capabilityTreeSha256(root, true)).resolves.toBe(expected);
  });

  it("rejects symlinks before returning an integrity digest", async () => {
    const root = await fixture();
    await mkdir(join(root, "a"));
    await writeFile(join(root, "a", "file.txt"), "regular");
    await symlink(join(root, "a"), join(root, "b"), "junction");
    await expect(capabilityTreeSha256(root)).rejects.toThrow("cannot contain symlinks");
  });
});
