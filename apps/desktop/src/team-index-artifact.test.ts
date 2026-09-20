import { execFileSync } from "node:child_process";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { captureTeamIndexArtifact, TeamIndexWorkingCopyRetentionError } from "./team-index-artifact.js";

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "new-money-index-artifact-")); roots.push(parent);
  const directory = join(parent, "run-test"); await mkdir(directory, { mode: 0o700 });
  const root = join(directory, "index"), lifetime = new AbortController();
  await mkdir(root, { mode: 0o700 });
  const path = join(root, "vectors.db");
  await writeFile(path, "synthetic-index", { mode: 0o600 });
  const assertCurrent = vi.fn(async () => undefined);
  const capture = () => captureTeamIndexArtifact({ directory, signal: lifetime.signal, assertCurrent });
  return { parent, directory, root, path, lifetime, assertCurrent, capture };
}

it("captures only immutable Main metadata and rehashes a stable nested artifact", async () => {
  const f = await fixture(); await mkdir(join(f.root, "内容"), { mode: 0o700 });
  await writeFile(join(f.root, "内容", "asset.md"), "合成内容", { mode: 0o600 });
  await mkdir(join(f.root, "empty"), { mode: 0o700 });
  const artifact = await f.capture();
  expect(artifact.fingerprint).toEqual({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    files: 2, directories: 3, bytes: Buffer.byteLength("synthetic-index合成内容") });
  expect(Object.isFrozen(artifact)).toBe(true); expect(Object.isFrozen(artifact.fingerprint)).toBe(true);
  expect(JSON.stringify(artifact)).not.toContain(f.directory);
  expect(JSON.stringify(artifact)).not.toContain("合成内容");
  await artifact.assertUnchanged(); await artifact.assertUnchanged();
});

it("uses deterministic content identity independently of creation order and inode", async () => {
  const a = await fixture(), b = await fixture();
  for (const [f, names] of [[a, ["b", "a"]], [b, ["a", "b"]]] as const) {
    for (const name of names) await writeFile(join(f.root, name), name, { mode: 0o600 });
  }
  expect((await a.capture()).fingerprint).toEqual((await b.capture()).fingerprint);
});

it.each(["missing", "empty", "zero-only", "regular-root"])("rejects %s output", async mode => {
  const f = await fixture();
  await rm(f.path);
  if (mode === "missing" || mode === "regular-root") await rm(f.root, { recursive: true });
  if (mode === "regular-root") await writeFile(f.root, "not a directory", { mode: 0o600 });
  if (mode === "zero-only") await writeFile(f.path, "", { mode: 0o600 });
  await expect(f.capture()).rejects.toThrow();
});

it.skipIf(process.platform === "win32").each(["symlink-file", "symlink-directory", "symlink-root", "hardlink", "fifo"])(
  "rejects %s without accepting outside data or blocking", async mode => {
    const f = await fixture(), outside = join(f.directory, "outside");
    await mkdir(outside, { mode: 0o700 });
    const source = join(outside, "source"); await writeFile(source, "retain", { mode: 0o600 });
    if (mode === "symlink-file") await symlink(source, join(f.root, "link"));
    if (mode === "symlink-directory") await symlink(outside, join(f.root, "link"));
    if (mode === "symlink-root") { await rename(f.root, join(f.directory, "original")); await symlink(outside, f.root); }
    if (mode === "hardlink") await link(source, join(f.root, "link"));
    if (mode === "fifo") execFileSync("mkfifo", [join(f.root, "pipe")], { timeout: 2000, stdio: "ignore" });
    await expect(f.capture()).rejects.toThrow(/Unsafe/u);
    expect(await readFile(source, "utf8")).toBe("retain");
  }
);

it.skipIf(process.platform === "win32").each(["public-file", "public-directory", "executable"])("rejects %s modes", async mode => {
  const f = await fixture();
  await chmod(mode === "public-directory" ? f.root : f.path, mode === "executable" ? 0o700 : mode === "public-directory" ? 0o755 : 0o644);
  await expect(f.capture()).rejects.toThrow(/Unsafe/u);
});

it.each(["bytes", "file-replacement", "directory-replacement", "added", "removed", "renamed", "empty-directory"])(
  "rejects %s after capture instead of trusting an old fingerprint", async mode => {
    const f = await fixture(), artifact = await f.capture();
    if (mode === "bytes") await writeFile(f.path, "different-index");
    if (mode === "file-replacement") {
      await rename(f.path, join(f.directory, "original-file"));
      await writeFile(f.path, "synthetic-index", { mode: 0o600 });
    }
    if (mode === "directory-replacement") {
      await rename(f.root, join(f.directory, "original-index")); await mkdir(f.root, { mode: 0o700 });
      await writeFile(f.path, "synthetic-index", { mode: 0o600 });
    }
    if (mode === "added") await writeFile(join(f.root, "new"), "new", { mode: 0o600 });
    if (mode === "removed") await rm(f.path);
    if (mode === "renamed") await rename(f.path, join(f.root, "renamed"));
    if (mode === "empty-directory") await mkdir(join(f.root, "empty"), { mode: 0o700 });
    await expect(artifact.assertUnchanged()).rejects.toThrow();
  }
);

it.each(["cancel-before", "cancel-after", "anchor-denied", "deadline"])("cannot outlive %s", async mode => {
  const f = await fixture();
  if (mode === "cancel-before") { f.lifetime.abort(); await expect(f.capture()).rejects.toThrow(); return; }
  const artifact = await f.capture();
  if (mode === "cancel-after") f.lifetime.abort();
  if (mode === "anchor-denied") f.assertCurrent.mockRejectedValue(new Error("retired storage"));
  if (mode === "deadline") {
    // Node's AbortSignal.timeout is not driven by Vitest's fake clock. Supply an
    // already-expired timeout signal without waiting a minute or touching IO.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    try { await expect(artifact.assertUnchanged()).rejects.toThrow(); } finally { timeout.mockRestore(); }
    return;
  }
  await expect(artifact.assertUnchanged()).rejects.toThrow();
});

it("refuses a sparse oversized file before reading its contents", async () => {
  const f = await fixture(), file = await open(f.path, "r+");
  try { await file.truncate(256 * 1024 * 1024 + 1); } finally { await file.close(); }
  await expect(f.capture()).rejects.toThrow(/byte budget/u);
});

it("bounds traversal depth", async () => {
  const f = await fixture(); let directory = f.root;
  for (let depth = 0; depth < 33; depth += 1) { directory = join(directory, "d"); await mkdir(directory, { mode: 0o700 }); }
  await expect(f.capture()).rejects.toThrow(/depth/u);
});

it("bounds streamed directory entries before allocating an unbounded listing", async () => {
  const f = await fixture();
  for (let start = 0; start < 4096; start += 64) {
    await Promise.all(Array.from({ length: 64 }, (_, i) => writeFile(join(f.root, String(start + i)), "", { mode: 0o600 })));
  }
  await expect(f.capture()).rejects.toThrow(/entry budget/u);
});

it.skipIf(process.platform === "win32")("copies nested bytes without sharing inodes and cleans mutable working data", async () => {
  const f = await fixture(); await mkdir(join(f.root, "嵌套"), { mode: 0o700 });
  await writeFile(join(f.root, "嵌套", "large"), Buffer.alloc(150_000, 7), { mode: 0o600 });
  const artifact = await f.capture(); let copyPath = "";
  expect(await artifact.withWorkingCopy(async directory => {
    copyPath = directory;
    expect((await captureTeamIndexArtifact({ directory, signal: f.lifetime.signal, assertCurrent: f.assertCurrent })).fingerprint).toEqual(artifact.fingerprint);
    const path = join(directory, "index", "vectors.db");
    expect((await lstat(path)).ino).not.toBe((await lstat(f.path)).ino);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    await writeFile(path, "SDK metadata mutation"); return "queried";
  }, f.lifetime.signal)).toBe("queried");
  await expect(lstat(copyPath)).rejects.toMatchObject({ code: "ENOENT" });
  await artifact.assertUnchanged(); expect(await readdir(f.parent)).toEqual(["run-test"]);
});

it.skipIf(process.platform === "win32").each(["cancel-before", "cancel-copy", "changed-source", "oversized-source", "query-failure", "cancel-query"])(
  "rejects %s and cleans only its own working directory", async mode => {
    const f = await fixture();
    if (mode === "cancel-copy") await mkdir(join(f.root, "z"), { mode: 0o700 });
    const artifact = await f.capture(), caller = new AbortController();
    const operation = vi.fn(async (_directory: string, signal: AbortSignal) => {
      if (mode === "query-failure") throw new Error("Synthetic query failure");
      if (mode === "cancel-query") { caller.abort(); expect(signal.aborted).toBe(true); }
    });
    if (mode === "cancel-before") caller.abort();
    if (mode === "changed-source") await writeFile(f.path, "changed");
    if (mode === "oversized-source") {
      const file = await open(f.path, "r+");
      try { await file.truncate(256 * 1024 * 1024 + 1); } finally { await file.close(); }
    }
    if (mode === "cancel-copy") f.assertCurrent.mockImplementation(async () => {
      const copy = (await readdir(f.parent)).find(name => name.startsWith("query-"));
      if (copy && (await readdir(join(f.parent, copy, "index")).catch((): string[] => [])).includes("vectors.db")) caller.abort();
    });
    await expect(artifact.withWorkingCopy(operation, caller.signal)).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(mode === "query-failure" || mode === "cancel-query" ? 1 : 0);
    expect(await readdir(f.parent)).toEqual(["run-test"]);
  }
);

it.skipIf(process.platform === "win32")("refuses to delete a replaced working directory", async () => {
  const f = await fixture(), artifact = await f.capture(); let replaced = "";
  await expect(artifact.withWorkingCopy(async directory => {
    replaced = directory; await rename(directory, join(f.parent, "retained"));
    await mkdir(directory, { mode: 0o700 }); await writeFile(join(directory, "keep"), "unrelated", { mode: 0o600 });
  }, f.lifetime.signal)).rejects.toThrow("cleanup requires recovery");
  expect(await readFile(join(replaced, "keep"), "utf8")).toBe("unrelated");
  await artifact.assertUnchanged();
});
it.skipIf(process.platform === "win32")("retains the exact working copy on unconfirmed physical exit", async () => {
  const f = await fixture(), artifact = await f.capture(); let retained = "";
  await expect(artifact.withWorkingCopy(async directory => {
    retained = directory; throw new TeamIndexWorkingCopyRetentionError();
  }, f.lifetime.signal)).rejects.toThrow("retain its working copy");
  expect(await readdir(retained)).toEqual(["index"]); await artifact.assertUnchanged();
});
