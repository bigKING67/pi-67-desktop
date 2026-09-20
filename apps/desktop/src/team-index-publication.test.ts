import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureTeamIndexArtifact } from "./team-index-artifact.js";
import { createTeamIndexPublication } from "./team-index-publication.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const roots: string[] = [];
const epoch = "00000000-0000-4000-8000-000000000001", scopeKey = "a".repeat(64);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(async () => {
  vi.mocked(rename).mockImplementation(realFs.rename); vi.mocked(open).mockImplementation(realFs.open); vi.clearAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-publication-")); roots.push(root);
  const owner = join(root, scopeKey), staging = join(owner, "staging");
  await mkdir(staging, { recursive: true, mode: 0o700 });
  let next = 0;
  const candidate = async (cursor = "1", selectedEpoch = epoch) => {
    const directory = join(staging, `run-${++next}`), index = join(directory, "index"), lifetime = new AbortController();
    await mkdir(index, { recursive: true, mode: 0o700 });
    const path = join(index, "vectors.db"); await writeFile(path, "synthetic-index", { mode: 0o600 });
    const identity = await lstat(directory);
    const assertStorage = vi.fn(async () => {
      const current = await lstat(directory);
      if (identity.dev !== current.dev || identity.ino !== current.ino || current.isSymbolicLink()) throw new Error("retired storage");
    });
    const assertSnapshotCurrent = vi.fn(async () => { lifetime.signal.throwIfAborted(); });
    const artifact = await captureTeamIndexArtifact({ directory, signal: lifetime.signal, assertCurrent: assertStorage });
    const assertArtifactCurrent = vi.fn(async (flush?: boolean, signal?: AbortSignal) => artifact.assertUnchanged(flush, signal));
    const input = { directory, scopeKey, signal: lifetime.signal, snapshot: { epoch: selectedEpoch, cursor, receiptRecord: "b".repeat(64) },
      models: { embedding: { endpoint: "https://model.invalid/v1", model: "embed", dimension: 8 }, extraction: { endpoint: "https://model.invalid/v1", model: "extract" } },
      documents: [{ assetId: epoch, contentRevision: "c".repeat(64) }], artifact: artifact.fingerprint,
      assertStorage, assertSnapshotCurrent, assertArtifactCurrent };
    const publication = createTeamIndexPublication(input);
    const assertion = vi.fn(() => undefined);
    const revalidate = vi.fn<Parameters<typeof publication.publish>[0]>(async () => assertion);
    const publish = () => publication.publish(revalidate, lifetime.signal);
    return { input, directory, path, lifetime, assertion, revalidate, assertStorage, assertSnapshotCurrent, assertArtifactCurrent, publication, publish };
  };
  return { root, owner, staging, candidate, pointer: join(owner, "current-index.json") };
}

describe.skipIf(process.platform === "win32")("POSIX local index publication", () => {
it("flushes real index bytes and atomically publishes exact metadata, never a permission grant", async () => {
  const f = await fixture(), c = await f.candidate("9007199254740993");
  const result = await c.publish();
  expect(result.state).toBe("published-local"); expect(Object.isFrozen(result.pointer)).toBe(true);
  const pointer = JSON.parse(await readFile(f.pointer, "utf8")) as { manifest: string; generation: string; cursor: string };
  const record = await readFile(join(c.directory, "publication.json"), "utf8");
  expect(pointer.manifest).toBe(hash(record)); expect(pointer.cursor).toBe("9007199254740993");
  expect(JSON.parse(record)).toMatchObject({ scopeKey, generation: pointer.generation, snapshot: c.input.snapshot,
    documents: c.input.documents, models: c.input.models, artifact: c.input.artifact });
  expect(record).not.toContain(f.root); expect(record).not.toContain("synthetic-index");
  expect(c.assertArtifactCurrent).toHaveBeenNthCalledWith(1, true, expect.any(AbortSignal));
  expect(c.assertArtifactCurrent).toHaveBeenNthCalledWith(2, false, expect.any(AbortSignal));
  expect(c.revalidate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ scopeKey, snapshot: c.input.snapshot, models: c.input.models }), expect.any(AbortSignal));
  expect(c.assertion).toHaveBeenCalledTimes(3);
  expect((await readdir(f.owner)).sort()).toEqual(["current-index.json", "staging"]);
  if (process.platform !== "win32") expect((await lstat(f.pointer)).mode & 0o777).toBe(0o600);
  await expect(c.publish()).rejects.toMatchObject({ outcome: "not-published" });
});

it.each(["1", "2"])("rebuilds at cursor %s while preserving the previous generation and model identity", async cursor => {
  const f = await fixture(), first = await f.candidate(); await first.publish();
  const original = await readFile(join(first.directory, "publication.json"), "utf8");
  const second = await f.candidate(cursor); await second.publish();
  expect(JSON.parse(await readFile(f.pointer, "utf8"))).toMatchObject({ generation: "run-2", cursor });
  expect(await readFile(join(first.directory, "publication.json"), "utf8")).toBe(original);
  expect(await readFile(first.path, "utf8")).toBe("synthetic-index");
});

it("captures metadata before caller mutation and does not serialize extra secrets", async () => {
  const f = await fixture(), c = await f.candidate();
  c.input.models.embedding.model = "mutated"; c.input.snapshot.cursor = "9";
  Object.assign(c.input.models.embedding, { apiKey: "synthetic-secret" });
  c.input.documents[0]!.contentRevision = "d".repeat(64);
  await c.publish();
  const text = await readFile(join(c.directory, "publication.json"), "utf8");
  expect(text).not.toContain("mutated"); expect(text).not.toContain("synthetic-secret");
  expect(JSON.parse(text)).toMatchObject({ snapshot: { cursor: "1" }, documents: [{ contentRevision: "c".repeat(64) }] });
});

it.each(["cancelled", "denied", "snapshot", "artifact", "storage", "expired-before-commit", "during-revalidation", "manifest-tamper"])(
  "preserves the exact previous pointer on precommit %s", async mode => {
    const f = await fixture(), old = await f.candidate(); await old.publish();
    const previous = await readFile(f.pointer, "utf8"), c = await f.candidate("2");
    if (mode === "cancelled") c.lifetime.abort();
    if (mode === "denied") c.revalidate.mockRejectedValueOnce(new Error("synthetic secret failure"));
    if (mode === "snapshot") c.assertSnapshotCurrent.mockRejectedValueOnce(new Error("changed snapshot"));
    if (mode === "artifact") await writeFile(c.path, "changed");
    if (mode === "storage") c.assertStorage.mockRejectedValueOnce(new Error("changed directory"));
    if (mode === "expired-before-commit") c.assertion.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error("expired"); });
    if (mode === "during-revalidation") c.revalidate.mockImplementationOnce(async () => { c.lifetime.abort(); return c.assertion; });
    if (mode === "manifest-tamper") c.revalidate.mockImplementationOnce(async () => {
      await writeFile(join(c.directory, "publication.json"), "changed"); return c.assertion;
    });
    await expect(c.publish()).rejects.toMatchObject({ message: "Team index publication not-published.", outcome: "not-published" });
    expect(await readFile(f.pointer, "utf8")).toBe(previous);
    expect(await readFile(old.path, "utf8")).toBe("synthetic-index");
  }
);

it.each(["regression", "epoch-reset"])("does not silently activate a %s", async mode => {
  const f = await fixture(), old = await f.candidate("2"); await old.publish();
  const previous = await readFile(f.pointer, "utf8");
  const c = await f.candidate(mode === "regression" ? "1" : "3", mode === "epoch-reset" ? "00000000-0000-4000-8000-000000000002" : epoch);
  await expect(c.publish()).rejects.toMatchObject({ outcome: "not-published" });
  expect(await readFile(f.pointer, "utf8")).toBe(previous); expect(c.revalidate).not.toHaveBeenCalled();
});

it.each(["bad-pointer", "bad-manifest", "missing-manifest", "pointer-race"])("refuses %s without repairing or overwriting it", async mode => {
  const f = await fixture(), old = await f.candidate(); await old.publish();
  if (mode === "bad-pointer") await writeFile(f.pointer, "invalid");
  if (mode === "bad-manifest") await writeFile(join(old.directory, "publication.json"), "invalid");
  if (mode === "missing-manifest") await rm(join(old.directory, "publication.json"));
  const c = await f.candidate("2");
  if (mode === "pointer-race") c.revalidate.mockImplementationOnce(async () => { await writeFile(f.pointer, "external-change"); return c.assertion; });
  const before = await readFile(f.pointer, "utf8");
  await expect(c.publish()).rejects.toMatchObject({ outcome: "not-published" });
  expect(await readFile(f.pointer, "utf8")).toBe(mode === "pointer-race" ? "external-change" : before);
});

it.skipIf(process.platform === "win32").each(["symlink", "public-mode"])("refuses %s pointer targets", async mode => {
  const f = await fixture(), old = await f.candidate(); await old.publish();
  const previous = await readFile(f.pointer, "utf8");
  if (mode === "symlink") { await realFs.rename(f.pointer, join(f.root, "retained")); await symlink(join(f.root, "retained"), f.pointer); }
  else await chmod(f.pointer, 0o644);
  const c = await f.candidate("2"); await expect(c.publish()).rejects.toMatchObject({ outcome: "not-published" });
  expect(await readFile(f.pointer, "utf8")).toBe(previous);
});

it.each(["rename-rejection", "cancel-after-rename", "expired-after-rename", "directory-fsync"])("reports indeterminate on %s, never false rollback", async mode => {
  const f = await fixture(), c = await f.candidate();
  if (mode === "rename-rejection") vi.mocked(rename).mockRejectedValueOnce(new Error("synthetic IO failure"));
  if (mode === "cancel-after-rename") vi.mocked(rename).mockImplementationOnce(async (from, to) => { await realFs.rename(from, to); c.lifetime.abort(); });
  if (mode === "directory-fsync") vi.mocked(open).mockImplementation(async (...args) => {
    const file = await realFs.open(...args);
    if (args[0] === f.owner) file.sync = async () => { throw new Error("Synthetic directory fsync failure"); };
    return file;
  });
  if (mode === "expired-after-rename") c.assertion.mockImplementationOnce(() => undefined).mockImplementationOnce(() => undefined)
    .mockImplementationOnce(() => { throw new Error("expired"); });
  await expect(c.publish()).rejects.toMatchObject({ outcome: "indeterminate" });
  if (mode !== "rename-rejection") expect(JSON.parse(await readFile(f.pointer, "utf8"))).toMatchObject({ generation: "run-1" });
  await expect(c.publish()).rejects.toMatchObject({ outcome: "not-published" });
});

it("rejects concurrent same-owner publication and retains the slot through cancelled callback IO", async () => {
  const f = await fixture(), a = await f.candidate(), b = await f.candidate();
  let finish!: (check: () => void) => void;
  a.revalidate.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = a.publish(); const rejected = expect(pending).rejects.toMatchObject({ outcome: "not-published" });
  await vi.waitFor(() => expect(a.revalidate).toHaveBeenCalledOnce());
  a.lifetime.abort();
  await expect(b.publish()).rejects.toMatchObject({ outcome: "not-published" });
  finish(a.assertion); await rejected;
  await expect(b.publish()).resolves.toMatchObject({ state: "published-local" });
});

it("caps distinct-owner publications at four without queuing", async () => {
  const held: { finish: (check: () => void) => void; pending: Promise<unknown> }[] = [];
  try {
    for (let i = 0; i < 4; i += 1) {
      const f = await fixture(), c = await f.candidate(); let finish!: (check: () => void) => void;
      c.revalidate.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
      const pending = c.publish(); held.push({ finish, pending });
      await vi.waitFor(() => expect(c.revalidate).toHaveBeenCalledOnce());
    }
    const f = await fixture(), c = await f.candidate();
    await expect(c.publish()).rejects.toMatchObject({ outcome: "not-published" }); expect(c.revalidate).not.toHaveBeenCalled();
  } finally {
    for (const entry of held) entry.finish(() => undefined);
    await Promise.all(held.map(entry => entry.pending));
  }
});
});
