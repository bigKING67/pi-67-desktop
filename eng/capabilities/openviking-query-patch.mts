/// <reference types="node" />
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const edits = [
  { path: "openviking/retrieve/context_assembler/gather.py",
    sha256: "a665dad27f252df8d3da35b41a4d63f0496e91c2b13a5891ddb8540525934d98",
    before: "async def gather_candidates(",
    after: "from openviking.retrieve.request_query_embedding import query_embedding_scope\n\n\n@query_embedding_scope\nasync def gather_candidates(" },
  { path: "openviking/retrieve/hierarchical_retriever.py",
    sha256: "224a2bb5b99f7cdde661c61e4e2d8a6e85c3ac919f015e68879fe260134a06cc",
    before: "result: EmbedResult = await embed_compat(\n                    self.embedder,\n                    embedding_input,\n                    is_query=True,\n                )",
    after: "result: EmbedResult = await embed_query_once(\n                    self.embedder,\n                    embedding_input,\n                    ctx=ctx,\n                )" }
];
const helperPath = "openviking/retrieve/request_query_embedding.py";
const dependencies = [
  { path: "openviking/models/embedder/base.py", sha256: "d10361b34da6449763ed3b55bf15864e15663783e3ce25772d83c2e57d81fa17" },
  { path: "openviking/models/embedder/openai_embedders.py", sha256: "b8e70a104e6f2e4337e3cf6df46c739f3b5b41524c0a92ba9a42ac2ee3575a5c" }
];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (path: string, value: string) => `${path},sha256=${createHash("sha256").update(value).digest("base64url")},${Buffer.byteLength(value)}`;

export function patchQueryEmbeddingSource(path: string, source: string): string {
  const edit = edits.find(item => item.path === path);
  if (!edit || digest(source) !== edit.sha256) throw new Error("Query patch requires exact pinned upstream source.");
  if (source.split(edit.before).length !== 2) throw new Error("Ambiguous query embedding patch.");
  source = source.replace(edit.before, edit.after);
  if (path.endsWith("hierarchical_retriever.py")) {
    source = source.replace("from openviking.models.embedder.base import EmbedResult, embed_compat",
      "from openviking.models.embedder.base import EmbedResult\nfrom openviking.retrieve.request_query_embedding import embed_query_once");
  }
  return source;
}

/** Fresh caller-owned staging only, before measuring/admitting/signing its tree.
 * All source/RECORD inputs are checked before writes. Never retry failed staging. */
export async function applyQueryEmbeddingPatch(stagingRoot: string) {
  const root = await realpath(stagingRoot);
  if (root !== resolve(stagingRoot)) throw new Error("Query patch staging root must be canonical.");
  const packages = join(root, "lib/python3.12/site-packages");
  const marker = join(root, "newmoney-query-embedding-patch.json");
  const helperTarget = join(packages, helperPath);
  for (const path of [marker, helperTarget]) {
    await lstat(path).then(() => { throw new Error("Query patch output already exists."); }, error => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  if (await realpath(join(packages, "openviking/retrieve")) !== join(packages, "openviking/retrieve")) throw new Error("Unexpected query patch directory link.");
  for (const dependency of dependencies) {
    const path = join(packages, dependency.path);
    if (await realpath(path) !== path || digest(await readFile(path, "utf8")) !== dependency.sha256) throw new Error("Query patch embedder dependency drift.");
  }
  const pending = await Promise.all(edits.map(async edit => {
    const path = join(packages, edit.path);
    if (await realpath(path) !== path) throw new Error("Unexpected query patch source link.");
    const before = await readFile(path, "utf8");
    return { path, relativePath: edit.path, before, content: patchQueryEmbeddingSource(edit.path, before) };
  }));
  const wheelPath = join(packages, "openviking-0.4.16.dist-info/RECORD");
  if (await realpath(wheelPath) !== wheelPath) throw new Error("Unexpected query patch RECORD link.");
  let wheel = await readFile(wheelPath, "utf8");
  if (wheel.split("\n").some(line => line.startsWith(`${helperPath},`))) throw new Error("Query helper RECORD already exists.");
  for (const file of pending) {
    const entries = wheel.split("\n").filter(line => line.startsWith(`${file.relativePath},`));
    if (entries.length !== 1 || entries[0] !== record(file.relativePath, file.before)) throw new Error("Query patch wheel RECORD mismatch.");
    wheel = wheel.replace(entries[0], record(file.relativePath, file.content));
  }
  const helper = await readFile(new URL("./openviking-runtime/request_query_embedding.py", import.meta.url), "utf8");
  wheel = `${wheel.trimEnd()}\n${record(helperPath, helper)}\n`;
  const receipt = { schema: "new-money.openviking-query-patch.v1", revision: "request-query-coalescing-v1", upstreamVersion: "0.4.16",
    recipeSha256: digest(JSON.stringify({ edits, dependencies })), helperSha256: digest(helper), dependencies, files: pending.map(file => ({
      path: file.relativePath, beforeSha256: digest(file.before), afterSha256: digest(file.content)
    })) };
  await writeFile(helperTarget, helper, { flag: "wx" });
  for (const file of pending) await writeFile(file.path, file.content);
  await writeFile(wheelPath, wheel);
  await writeFile(marker, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return receipt;
}
