import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SharedKnowledgeReceiptRequest } from "@pi67/protocol";
import type { captureTeamIndexArtifact } from "./team-index-artifact.js";

type Models = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-index-prepare" }>["models"];
type Fingerprint = Awaited<ReturnType<typeof captureTeamIndexArtifact>>["fingerprint"];
interface Snapshot { epoch: string | null; cursor: string; receiptRecord: string | null }
interface Pointer { schema: "newmoney.team-index-pointer.v1"; scopeKey: string; generation: string; manifest: string; epoch: string; cursor: string }
const HASH = /^[a-f0-9]{64}$/u, RUN = /^run-[a-zA-Z0-9_-]{1,64}$/u;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const busy = new Set<string>();

/** A rename may have committed even if its promise or later durability/access
 * verification fails. Do not silently retry, roll back, or report non-publication. */
class TeamIndexPublicationError extends Error {
  constructor(readonly outcome: "not-published" | "indeterminate") {
    super(`Team index publication ${outcome}.`);
  }
}

/** Created only by Main's verified job closure. No filesystem work until publish.
 * revalidate must freshly compose Main's independent read grant and Host's exact
 * scope/model/head observation, returning a synchronous final validity check.
 * This callback is NOT a Host-supplied grant. The private Host flow invokes it.
 * Same-process coordination only; canonical owned directories are a prerequisite. */
export function createTeamIndexPublication(input: {
  directory: string; scopeKey: string; snapshot: Snapshot; models: Models;
  documents: readonly Readonly<{ assetId: string; contentRevision: string }>[];
  artifact: Fingerprint; signal: AbortSignal;
  assertStorage(this: void): Promise<void>;
  assertSnapshotCurrent(this: void): Promise<void>;
  assertArtifactCurrent(this: void, flush?: boolean, signal?: AbortSignal): Promise<void>;
}) {
  const { directory, scopeKey, signal: lifetime, assertStorage, assertSnapshotCurrent, assertArtifactCurrent } = input;
  const generation = basename(directory), staging = dirname(directory), owner = dirname(staging);
  if (!HASH.test(scopeKey) || basename(owner) !== scopeKey || basename(staging) !== "staging" || !RUN.test(generation)
    || input.snapshot.epoch === null || input.snapshot.receiptRecord === null) throw new Error("Invalid team publication owner.");
  const snapshot = Object.freeze({ epoch: input.snapshot.epoch, cursor: input.snapshot.cursor, receiptRecord: input.snapshot.receiptRecord });
  const models = Object.freeze({ embedding: Object.freeze({ endpoint: input.models.embedding.endpoint,
    model: input.models.embedding.model, dimension: input.models.embedding.dimension }),
    extraction: Object.freeze({ endpoint: input.models.extraction.endpoint, model: input.models.extraction.model }) });
  const artifact = Object.freeze({ ...input.artifact });
  const documents = Object.freeze(input.documents.map(item => Object.freeze({ assetId: item.assetId, contentRevision: item.contentRevision })));
  const record = JSON.stringify({ schema: "newmoney.team-index-publication.v1", scopeKey, generation, snapshot, models, artifact, documents });
  if (Buffer.byteLength(record) > 64 * 1024) throw new Error("Team index publication metadata budget exceeded.");
  const pointer: Readonly<Pointer> = Object.freeze({ schema: "newmoney.team-index-pointer.v1", scopeKey, generation,
    manifest: hash(record), epoch: snapshot.epoch, cursor: snapshot.cursor });
  const expected = Object.freeze({ scopeKey, snapshot, models, artifact });
  let attempted = false;
  return Object.freeze({
    async publish(revalidate: (observation: typeof expected, signal: AbortSignal) => Promise<() => void>, callerSignal: AbortSignal) {
      if (process.platform === "win32" || attempted || busy.has(owner) || busy.size >= 4) throw new TeamIndexPublicationError("not-published");
      attempted = true; busy.add(owner);
      const signal = AbortSignal.any([lifetime, callerSignal, AbortSignal.timeout(90_000)]);
      let renameStarted = false;
      const check = async () => { signal.throwIfAborted(); await assertStorage(); await assertSnapshotCurrent(); signal.throwIfAborted(); };
      try {
        await check();
        const previous = await readPointer(owner, scopeKey);
        if (previous && (previous.value.epoch !== snapshot.epoch || BigInt(previous.value.cursor) > BigInt(snapshot.cursor))) {
          throw new Error("Team index pointer cannot regress or change epoch implicitly.");
        }
        // Flush every file and directory bottom-up while rehashing the exact tree.
        await assertArtifactCurrent(true, signal); await check();
        await writeExclusive(join(directory, "publication.json"), record);
        await syncDirectory(directory); await syncDirectory(staging);
        const temporary = join(owner, `.index-${randomUUID()}.tmp`);
        const pointerText = JSON.stringify(pointer);
        await writeExclusive(temporary, pointerText);
        // Heavy file work comes before fresh final authorization/head observation.
        signal.throwIfAborted();
        const assertObservation = await revalidate(expected, signal);
        await check(); assertObservation();
        if ((await readPointer(owner, scopeKey))?.identity !== previous?.identity) throw new Error("Team index pointer changed.");
        // An authorization callback may yield; verify the manifest and exact input
        // again rather than trusting a previously computed digest or a file path.
        if ((await readFile(join(directory, "publication.json"), 64 * 1024)).text !== record
          || (await readFile(temporary, 2048)).text !== pointerText) throw new Error("Team index publication changed.");
        await assertArtifactCurrent(false, signal); await check();
        if ((await readPointer(owner, scopeKey))?.identity !== previous?.identity) throw new Error("Team index pointer changed.");
        assertObservation();
        signal.throwIfAborted();
        renameStarted = true;
        await rename(temporary, join(owner, "current-index.json"));
        await syncDirectory(owner);
        const current = await readPointer(owner, scopeKey);
        if (current?.text !== pointerText) throw new Error("Team index publication readback failed.");
        await check(); assertObservation();
        return Object.freeze({ state: "published-local" as const, pointer });
      } catch {
        // Retain exact orphan metadata/temp files for future owned recovery. Never
        // delete generations or rewrite the old pointer after a possible commit.
        throw new TeamIndexPublicationError(renameStarted ? "indeterminate" : "not-published");
      } finally { busy.delete(owner); }
    }
  });
}

export async function readTeamIndexPublication(owner: string, scopeKey: string) {
  let stored: Awaited<ReturnType<typeof readFile>>;
  try { stored = await readFile(join(owner, "current-index.json"), 2048); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined; throw error; }
  const value: unknown = JSON.parse(stored.text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid team index pointer.");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 6 || item.schema !== "newmoney.team-index-pointer.v1" || item.scopeKey !== scopeKey
    || typeof item.generation !== "string" || !RUN.test(item.generation) || typeof item.manifest !== "string" || !HASH.test(item.manifest)
    || typeof item.epoch !== "string" || !UUID.test(item.epoch) || typeof item.cursor !== "string" || !/^[1-9][0-9]{0,18}$/u.test(item.cursor)
    || BigInt(item.cursor) > 9223372036854775807n) throw new Error("Invalid team index pointer.");
  const generation = join(owner, "staging", item.generation);
  const anchor = await lstat(generation, { bigint: true }); validate(anchor, true);
  const record = await readFile(join(generation, "publication.json"), 64 * 1024);
  if (hash(record.text) !== item.manifest || stamp(anchor) !== stamp(await lstat(generation, { bigint: true }))) {
    throw new Error("Team index manifest mismatch.");
  }
  return { ...stored, value: item as unknown as Pointer, manifest: record.text, manifestIdentity: record.identity };
}

const readPointer = readTeamIndexPublication;

async function readFile(path: string, maximum: number) {
  const metadata = await lstat(path, { bigint: true }); validate(metadata, false);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true }); validate(before, false);
    if (stamp(before) !== stamp(metadata) || before.size > BigInt(maximum)) throw new Error("Unsafe team publication file.");
    const bytes = Buffer.alloc(maximum + 1); let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break; length += read.bytesRead;
    }
    if (BigInt(length) !== before.size || length > maximum || stamp(before) !== stamp(await file.stat({ bigint: true }))
      || stamp(before) !== stamp(await lstat(path, { bigint: true }))) throw new Error("Team publication file changed.");
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)), identity: stamp(before) };
  } finally { await file.close(); }
}

async function writeExclusive(path: string, text: string) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(text); await file.sync(); }
  finally { await file.close(); }
}

async function syncDirectory(path: string) {
  const before = await lstat(path, { bigint: true }); validate(before, true);
  const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (stamp(before) !== stamp(await file.stat({ bigint: true }))) throw new Error("Team publication directory changed.");
    await file.sync();
    if (stamp(before) !== stamp(await lstat(path, { bigint: true }))) throw new Error("Team publication directory changed.");
  } finally { await file.close(); }
}
function validate(value: BigIntStats, directory: boolean) {
  if (value.isSymbolicLink() || (directory ? !value.isDirectory() : !value.isFile() || value.nlink !== 1n)
    || process.platform !== "win32" && (value.uid !== BigInt(process.getuid!()) || (value.mode & 0o077n) !== 0n)) {
    throw new Error("Unsafe team publication entry.");
  }
}
function stamp(value: BigIntStats) {
  return [value.dev, value.ino, value.mode, value.uid, value.gid, value.nlink, value.size, value.mtimeNs, value.ctimeNs].join(":");
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
