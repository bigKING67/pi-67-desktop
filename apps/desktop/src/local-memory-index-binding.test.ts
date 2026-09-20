import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindLocalMemoryIndex } from "./local-memory-index-binding.mjs";

const directories: string[] = [];
const embedding = { protocol: "openai-compatible" as const, endpoint: "https://example.test/v1", model: "synthetic", dimension: 8 };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-index-binding-"));
  directories.push(root);
  return root;
}
afterEach(async () => { for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("persistent local embedding identity", () => {
  it("converges concurrent identical initialization and does not persist or bind credentials", async () => {
    const root = await fixture();
    const configured = { ...embedding, apiKey: "synthetic-secret" };
    await Promise.all(Array.from({ length: 8 }, () => bindLocalMemoryIndex(root, configured)));
    const bytes = await readFile(join(root, "embedding.json"), "utf8");
    expect(bytes).not.toContain("synthetic");
    expect(bytes).not.toContain("example.test");
    expect(Object.keys(JSON.parse(bytes) as object).sort()).toEqual(["identitySha256", "version"]);
    configured.apiKey = "rotated-secret";
    await bindLocalMemoryIndex(root, configured);
    expect(await readFile(join(root, "embedding.json"), "utf8")).toBe(bytes);
    expect(await readdir(root)).toEqual(["embedding.json"]);
  });

  it.each([{ dimension: 16 }, { model: "another-model" }, { endpoint: "https://other.test/v1" }])(
    "blocks an incompatible configuration without changing its binding or content: %j", async (changed) => {
      const root = await fixture();
      await bindLocalMemoryIndex(root, embedding);
      const before = await readFile(join(root, "embedding.json"), "utf8");
      await mkdir(join(root, "data"));
      await writeFile(join(root, "data/memory"), "preserved");
      await expect(bindLocalMemoryIndex(root, { ...embedding, ...changed })).rejects.toThrow(/rebuild/u);
      expect(await readFile(join(root, "embedding.json"), "utf8")).toBe(before);
      expect(await readFile(join(root, "data/memory"), "utf8")).toBe("preserved");
    }
  );

  it("allows only one configuration to win concurrent initialization", async () => {
    const root = await fixture();
    const results = await Promise.allSettled([bindLocalMemoryIndex(root, embedding),
      bindLocalMemoryIndex(root, { ...embedding, dimension: 16 })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await readdir(root)).toEqual(["embedding.json"]);
  });

  it("requires explicit recovery for pre-existing unbound data and corrupt bindings", async () => {
    const root = await fixture();
    await mkdir(join(root, "data"));
    await writeFile(join(root, "data/memory"), "preserved");
    await expect(bindLocalMemoryIndex(root, embedding)).rejects.toThrow(/recovery/u);
    expect(await readdir(root)).toEqual(["data"]);
    await writeFile(join(root, "embedding.json"), "broken");
    await expect(bindLocalMemoryIndex(root, embedding)).rejects.toThrow(/Invalid/u);
    expect(await readFile(join(root, "embedding.json"), "utf8")).toBe("broken");
  });

  it.skipIf(process.platform === "win32")("rejects symlinked binding and unbound data", async () => {
    const root = await fixture();
    const other = await fixture();
    await bindLocalMemoryIndex(other, embedding);
    await symlink(join(other, "embedding.json"), join(root, "embedding.json"));
    await expect(bindLocalMemoryIndex(root, embedding)).rejects.toThrow(/Invalid/u);
    const unbound = await fixture();
    await symlink(other, join(unbound, "data"));
    await expect(bindLocalMemoryIndex(unbound, embedding)).rejects.toThrow(/recovery/u);
  });
});
