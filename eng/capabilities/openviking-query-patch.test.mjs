import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { applyQueryEmbeddingPatch, patchQueryEmbeddingSource } from "./openviking-query-patch.mts";

it("rejects unknown or drifted source rather than applying a best-effort query patch", () => {
  for (const path of ["unknown.py", "openviking/retrieve/context_assembler/gather.py", "openviking/retrieve/hierarchical_retriever.py"]) {
    expect(() => patchQueryEmbeddingSource(path, "async def gather_candidates(")).toThrow("exact pinned upstream");
  }
});

it("rejects an existing receipt without touching any staging content", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "query-patch-guard-"));
  try {
    const root = await realpath(temporary);
    await writeFile(join(root, "newmoney-query-embedding-patch.json"), "existing");
    await expect(applyQueryEmbeddingPatch(root)).rejects.toThrow("already exists");
    expect(await readdir(root)).toEqual(["newmoney-query-embedding-patch.json"]);
    expect(await readFile(join(root, "newmoney-query-embedding-patch.json"), "utf8")).toBe("existing");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
