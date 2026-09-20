import assert from "node:assert/strict";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";
import { applyQueryEmbeddingPatch } from "./openviking-query-patch.mts";

// Native opt-in probe only: exact wheel bytes supplied by a validated source tree.
export async function verifyQueryPatchGuards(source, fixture) {
  const files = ["openviking/retrieve/context_assembler/gather.py", "openviking/retrieve/hierarchical_retriever.py",
    "openviking/models/embedder/base.py", "openviking/models/embedder/openai_embedders.py", "openviking-0.4.16.dist-info/RECORD"];
  for (const failure of ["source", "dependency", "record", "duplicate-record", "link"]) {
    const root = join(fixture, `guard-${failure}`);
    const packages = join(root, "lib/python3.12/site-packages");
    for (const file of files) {
      const target = join(packages, file);
      await mkdir(dirname(target), { recursive: true });
      if (failure === "link" && file === files[0]) await symlink(join(source, "lib/python3.12/site-packages", file), target);
      else await cp(join(source, "lib/python3.12/site-packages", file), target);
    }
    if (failure === "link") {
      await assert.rejects(applyQueryEmbeddingPatch(root), /source link/u);
      continue;
    }
    const target = join(packages, files[failure === "source" ? 0 : failure === "dependency" ? 2 : 4]);
    const content = await readFile(target, "utf8");
    const duplicate = content.split("\n").find(line => line.startsWith(`${files[0]},`));
    await writeFile(target, failure === "duplicate-record" ? `${content}\n${duplicate}\n` : `${content}DRIFT`);
    // For RECORD drift, mutate the actual affected entry rather than unrelated bytes.
    if (failure === "record") await writeFile(target, content.replace(duplicate, `${files[0]},sha256=invalid,1`));
    const before = await runtimeTreeIdentity(root);
    await assert.rejects(applyQueryEmbeddingPatch(root), /pinned|dependency drift|RECORD mismatch/u);
    assert.equal((await runtimeTreeIdentity(root)).sha256, before.sha256);
  }
  return "PASS";
}
