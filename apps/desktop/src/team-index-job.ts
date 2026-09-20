import { constants } from "node:fs";
import { lstat, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { captureTeamIndexArtifact } from "./team-index-artifact.js";
import { createTeamIndexPublication } from "./team-index-publication.js";
import type { SharedKnowledgeReceiptBinding } from "./shared-knowledge-receipt-binding.js";
import type { prepareTeamWorker } from "./team-worker-preparation.js";

type Prepared = Pick<Awaited<ReturnType<typeof prepareTeamWorker>>, "scopeKey" | "directory" | "assertCurrent" | "assertStorage">;
interface Model { endpoint: string; model: string }
export interface TeamIndexModels { embedding: Model & { dimension: number }; extraction: Model }
interface Version { assetId: string; contentRevision: string }

/** Main-owned local job handoff, not a launch or Host publication API. assertReadable
 * must check the current exact-owner read grant, never a stored page's lease.
 * Host separately authorizes every model frame. No provider credentials enter
 * this file. The index owner must keep runtime/storage unchanged until launch. */
export async function writeTeamIndexJob(input: {
  prepared: Prepared;
  binding: SharedKnowledgeReceiptBinding;
  models: TeamIndexModels;
  limits: { maxPages: number; maxAssets: number };
  assertReadable(this: void): void;
  signal: AbortSignal;
}) {
  const { prepared, binding, signal, assertReadable } = input;
  const models = captureModels(input.models), limits = { ...input.limits };
  if (binding.scopeKey !== prepared.scopeKey) throw new Error("Team index owner mismatch.");
  const assertAccess = async () => {
    signal.throwIfAborted(); assertReadable(); await prepared.assertCurrent();
    signal.throwIfAborted(); assertReadable();
  };
  await assertAccess();
  if ((await readdir(prepared.directory)).length !== 0) throw new Error("Team index job requires empty staging.");
  await assertAccess();
  const path = join(prepared.directory, "job.json");
  const file = await open(path, "wx", 0o600);
  const identity = await file.stat().catch(async (error: unknown) => { await file.close(); throw error; });
  let closed = false, discarded = false, accepted = false;
  let size = 0;
  const documents: Readonly<Version>[] = [];
  const removeInput = async () => {
    if (discarded) return;
    await prepared.assertStorage();
    const current = await lstat(path);
    if (!current.isFile() || current.isSymbolicLink() || current.ino !== identity.ino || current.dev !== identity.dev) {
      throw new Error("Team index input changed; cleanup refused.");
    }
    await unlink(path); discarded = true;
  };
  const write = async (text: string) => {
    const bytes = Buffer.from(text, "utf8"); size += bytes.length;
    if (size > 8 * 1024 * 1024) throw new Error("Team index job byte budget exceeded.");
    await file.writeFile(bytes);
  };
  try {
    await write(JSON.stringify({ schema: "newmoney.team-index-job.v1", scopeKey: prepared.scopeKey, ...models }).slice(0, -1) + ',"documents":[');
    const snapshot = await binding.materialize(limits, async (version, canonicalContent) => {
      await assertAccess();
      if (documents.length >= 100 || Buffer.byteLength(canonicalContent) > 2 * 1024 * 1024) throw new Error("Team index document budget exceeded.");
      const selected = Object.freeze({ assetId: version.assetId, contentRevision: version.contentRevision });
      await write((documents.length ? "," : "") + JSON.stringify({ ...selected, canonicalContent }));
      documents.push(selected);
      await assertAccess();
    }, signal);
    if (documents.length === 0 || snapshot.epoch === null || snapshot.cursor !== snapshot.capturedHeadCursor) {
      throw new Error("Team index snapshot is empty or has not reached its captured head.");
    }
    await write("]}"); await file.sync(); await file.close(); closed = true;
    const assertSnapshotCurrent = async () => {
      if (discarded) throw new Error("Team index input has been discarded.");
      await assertAccess();
      const pointer = await binding.read();
      if ((pointer?.record ?? null) !== snapshot.receiptRecord) throw new Error("Team index snapshot changed.");
      await assertAccess();
    };
    await assertSnapshotCurrent();
    const expected = Object.freeze(documents);
    return Object.freeze({ snapshot, documents: expected, assertSnapshotCurrent,
      /** Only before launch or after confirmed worker exit. Never removes index/
       * or result.json; populated staging belongs to the future publication owner. */
      discardInput: removeInput,
      async verifyResult(completion: Promise<"completed" | "cancelled" | "failed">) {
        if (accepted) throw new Error("Team index result was already accepted.");
        // Supply this exact job's Main supervisor physical completion, never a
        // Host assertion, port EOF, exit-only event or unrelated worker receipt.
        if (await completion !== "completed") throw new Error("Team index worker did not complete.");
        await assertSnapshotCurrent();
        const result = await readResult(join(prepared.directory, "result.json"));
        validateResult(result, prepared.scopeKey, expected);
        const artifact = await captureTeamIndexArtifact({ directory: prepared.directory, signal, assertCurrent: assertAccess });
        const assertArtifactCurrent = async (flush = false, operationSignal?: AbortSignal) => {
          operationSignal?.throwIfAborted();
          await assertSnapshotCurrent();
          await artifact.assertUnchanged(flush, operationSignal);
          await assertSnapshotCurrent();
          operationSignal?.throwIfAborted();
        };
        await assertArtifactCurrent();
        const publication = createTeamIndexPublication({ directory: prepared.directory, scopeKey: prepared.scopeKey,
          snapshot, models, documents: expected, artifact: artifact.fingerprint, signal,
          assertStorage: () => prepared.assertStorage(), assertSnapshotCurrent, assertArtifactCurrent });
        if (accepted) throw new Error("Team index result was already accepted.");
        accepted = true;
        return Object.freeze({ snapshot, documents: expected, models, artifact: artifact.fingerprint, assertArtifactCurrent, publication });
      }
    });
  } catch (error) {
    if (!closed) { await file.close(); closed = true; }
    try { await removeInput(); }
    catch { throw new Error("Team index job failed; input cleanup could not be confirmed."); }
    throw error;
  }
}

function captureModels(input: TeamIndexModels): Readonly<TeamIndexModels> {
  const model = (value: Model) => {
    if (typeof value.endpoint !== "string" || value.endpoint.length > 2048 || /[\s\p{Cc}\\?#]/u.test(value.endpoint)
        || typeof value.model !== "string" || !value.model || value.model.length > 128 || /[\s\p{Cc}]/u.test(value.model)) {
      throw new Error("Invalid team index model selection.");
    }
    const endpoint = new URL(value.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Invalid team index model endpoint.");
    return { endpoint: value.endpoint, model: value.model };
  };
  const dimension = input.embedding.dimension;
  if (!Number.isInteger(dimension) || dimension < 4 || dimension > 4096 || dimension % 4 !== 0) throw new Error("Invalid team index dimension.");
  return Object.freeze({ embedding: Object.freeze({ ...model(input.embedding), dimension }), extraction: Object.freeze(model(input.extraction)) });
}

async function readResult(path: string): Promise<unknown> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Invalid team index result file.");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.ino !== metadata.ino || before.dev !== metadata.dev || before.size > 32 * 1024
        || process.platform !== "win32" && (before.uid !== process.getuid?.() || (before.mode & 0o077) !== 0)) {
      throw new Error("Unsafe team index result file.");
    }
    const bytes = Buffer.alloc(32 * 1024 + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const after = await file.stat(), current = await lstat(path);
    if (length > 32 * 1024 || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
        || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev) throw new Error("Team index result changed while reading.");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))) as unknown;
  } finally { await file.close(); }
}

function validateResult(value: unknown, scopeKey: string, expected: readonly Readonly<Version>[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid team index result.");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== 3 || result.schema !== "newmoney.team-index-result.v1" || result.scopeKey !== scopeKey
      || !Array.isArray(result.documents) || result.documents.length !== expected.length) throw new Error("Team index result mismatch.");
  const remaining = new Map(expected.map(item => [item.assetId, item.contentRevision]));
  for (const item of result.documents) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid team index result version.");
    const record = item as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.assetId !== "string" || typeof record.contentRevision !== "string"
        || remaining.get(record.assetId) !== record.contentRevision) throw new Error("Team index result version mismatch.");
    remaining.delete(record.assetId);
  }
  if (remaining.size) throw new Error("Team index result is incomplete.");
}
