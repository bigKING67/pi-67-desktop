import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { isNativeTeamQuery, isSharedKnowledgeReceiptRequest } from "@pi67/protocol";
import { bindSharedKnowledgeOwner, type SharedKnowledgeReceiptOwner } from "./shared-knowledge-owner.js";
import { readExistingLocalMemoryIdentity } from "./local-memory-identity.mjs";
import { readTeamIndexPublication } from "./team-index-publication.js";
import { captureTeamIndexArtifact, TeamIndexWorkingCopyRetentionError } from "./team-index-artifact.js";
import { runNativeTeamIndexQuery } from "./native-team-index-query.js";
import type { SharedKnowledgeReceiptBinding } from "./shared-knowledge-receipt-binding.js";
import type { TeamIndexModels } from "./team-index-job.js";

let active = 0;
const unavailable = () => new Error("Published team index is unavailable or no longer authorized.");

/** Main-only admission and vector-query composition, never a model grant.
 * Main supplies the root, exact owner and independently composed observer.
 * Never send this directory/checker to Host or Renderer as a read capability. */
export async function openPublishedTeamIndex(input: {
  memoryRoot: string; owner: SharedKnowledgeReceiptOwner; binding: SharedKnowledgeReceiptBinding;
  models?: TeamIndexModels; signal: AbortSignal;
  authorize(this: void, signal: AbortSignal): Promise<() => void>;
  revalidate(this: void, snapshot: { epoch: string; cursor: string }, signal: AbortSignal, models: TeamIndexModels): Promise<() => void>;
}) {
  if (process.platform === "win32" || active >= 4 || input.signal.aborted) throw unavailable();
  const { memoryRoot, binding, authorize, revalidate } = input;
  const expected = bindSharedKnowledgeOwner(input.owner), requestedModels = input.models === undefined ? undefined : structuredClone(input.models);
  if (!isAbsolute(memoryRoot) || binding.scopeKey !== expected.key) throw unavailable();
  const controller = new AbortController(), signal = AbortSignal.any([input.signal, binding.signal, controller.signal]);
  const started = Date.now(), monotonicStart = performance.now(); let lastWall = started;
  let inFlight = true, freed = false, retained = false;
  let assertReadable = () => undefined as void;
  active++;
  const timer = setTimeout(() => controller.abort(), 60_000); timer.unref?.();
  const release = () => { if (!inFlight && !freed && !retained) { freed = true; active--; clearTimeout(timer); signal.removeEventListener("abort", release); } };
  signal.addEventListener("abort", release, { once: true });
  const check = () => {
    signal.throwIfAborted(); assertReadable();
    const now = Date.now(), monotonic = performance.now();
    if (now < lastWall || now >= started + 60_000 || monotonic < monotonicStart || monotonic >= monotonicStart + 60_000) throw unavailable();
    lastWall = now;
  };
  try {
    check(); assertReadable = await authorize(signal); check();
    const root = await realpath(memoryRoot);
    const ownerDirectory = join(root, "team-projections", expected.key);
    const anchors = await Promise.all([memoryRoot, root, join(root, "team-projections"), ownerDirectory, join(ownerDirectory, "staging"),
      join(root, "team-projections", "receipts"), join(root, "team-projections", "receipts", expected.key)].map(anchor));
    const storage = async () => {
      check();
      for (const original of anchors) if ((await anchor(original.path)).identity !== original.identity) throw unavailable();
      if (await readExistingLocalMemoryIdentity(root) !== expected.owner.localProfileId) throw unavailable();
      check();
    };
    await storage();
    const stored = await readTeamIndexPublication(ownerDirectory, expected.key); check();
    if (!stored) throw unavailable();
    const directory = join(ownerDirectory, "staging", stored.value.generation);
    anchors.push(await anchor(directory)); await storage();
    const projection = await binding.project({ maxPages: 10_000, maxAssets: 100_000 }, signal); check();
    const documents = projection.versions.filter(version => version.operation === "upsert")
      .map(({ assetId, contentRevision }) => Object.freeze({ assetId, contentRevision }));
    if (documents.length === 0 || documents.length > 100 || projection.cursor !== projection.capturedHeadCursor) throw unavailable();
    const manifest: unknown = JSON.parse(stored.manifest);
    const { fingerprint, models } = validateManifest(manifest, stored.value, projection, requestedModels, documents);
    const current = async () => {
      await storage();
      const receipt = await binding.read(); check();
      if (receipt?.record !== projection.receiptRecord || receipt.epoch !== projection.epoch || receipt.cursor !== projection.cursor) throw unavailable();
      const next = await readTeamIndexPublication(ownerDirectory, expected.key); check();
      if (next?.identity !== stored.identity || next.manifestIdentity !== stored.manifestIdentity || next.text !== stored.text) throw unavailable();
      await storage();
    };
    await current();
    const artifact = await captureTeamIndexArtifact({ directory, signal, assertCurrent: storage });
    if (artifact.fingerprint.sha256 !== fingerprint.sha256 || artifact.fingerprint.files !== fingerprint.files
      || artifact.fingerprint.directories !== fingerprint.directories || artifact.fingerprint.bytes !== fingerprint.bytes) throw unavailable();
    const snapshot = Object.freeze({ epoch: stored.value.epoch, cursor: stored.value.cursor });
    await current();
    const assertObservation = await revalidate(snapshot, signal, models); check(); assertObservation();
    const verify = async () => {
      await current(); assertObservation();
      await artifact.assertUnchanged(false, signal);
      await current(); assertObservation();
    };
    await verify(); inFlight = false;
    const allowlist = new Map(documents.map(document => [document.assetId, document.contentRevision]));
    const withWorkingCopy = async <T>(operation: (directory: string, signal: AbortSignal) => Promise<T>) => {
        if (inFlight) throw unavailable();
        inFlight = true;
        try {
          await verify();
          const result = await artifact.withWorkingCopy(async (copy, copySignal) => {
            await verify(); copySignal.throwIfAborted();
            const result = await operation(copy, copySignal);
            await verify();
            return result;
          }, signal);
          await verify();
          return result;
        } catch (error) {
          if (error instanceof TeamIndexWorkingCopyRetentionError) retained = true;
          controller.abort(); throw unavailable();
        }
        finally { inFlight = false; if (signal.aborted) release(); }
    };
    return Object.freeze({ snapshot, models, directory, documents: Object.freeze(documents), signal,
      dispose: () => controller.abort(), withWorkingCopy,
      /** Canonical receipt bytes, not OV-generated summaries or private files.
       * Callers must withhold output until the whole replay and final checks pass. */
      async readDocument(version: { assetId: string; contentRevision: string }) {
        const selected = { ...version };
        if (inFlight) throw unavailable();
        inFlight = true;
        try {
          check();
          if (allowlist.get(selected.assetId) !== selected.contentRevision) throw unavailable();
          await verify();
          let canonicalContent: string | undefined;
          const materialized = await binding.materialize({ maxPages: 10_000, maxAssets: 100_000 }, async (currentVersion, content) => {
            check();
            if (currentVersion.assetId !== selected.assetId) return;
            if (currentVersion.contentRevision !== selected.contentRevision || canonicalContent !== undefined) throw unavailable();
            await verify(); canonicalContent = content;
          }, signal);
          if (canonicalContent === undefined || materialized.receiptRecord !== projection.receiptRecord
              || materialized.epoch !== snapshot.epoch || materialized.cursor !== snapshot.cursor) throw unavailable();
          await verify();
          return Object.freeze({ ...selected, canonicalContent });
        } catch { controller.abort(); throw unavailable(); }
        finally { inFlight = false; if (signal.aborted) release(); }
      },
      async queryVector(input: {
        vector: readonly number[]; limit: number;
        runtime: Pick<Parameters<typeof runNativeTeamIndexQuery>[0], "python" | "bootstrap" | "assertLaunchable">;
      }) {
        if (input.vector.length !== models.embedding.dimension) throw unavailable();
        const request = { schema: "newmoney.team-vector-query.v1" as const, scopeKey: expected.key,
          assetIds: documents.map(document => document.assetId), vector: [...input.vector], limit: input.limit };
        if (!isNativeTeamQuery(request)) throw unavailable();
        const runtime = { ...input.runtime };
        return withWorkingCopy(async (copy, copySignal) => {
          const hits = await runNativeTeamIndexQuery({ ...runtime, directory: copy, request, signal: copySignal,
            async assertLaunchable(launchSignal) { await runtime.assertLaunchable(launchSignal); await verify(); launchSignal.throwIfAborted(); } });
          return Object.freeze(hits.map(hit => {
            const contentRevision = allowlist.get(hit.assetId);
            if (!contentRevision) throw unavailable();
            return Object.freeze({ ...hit, contentRevision });
          }));
        });
      },
      async assertCurrent(versions: readonly { assetId: string; contentRevision: string }[] = []) {
        if (inFlight) throw unavailable();
        inFlight = true;
        try {
          check();
          if (versions.length > 100 || versions.some(version => !allowlist.has(version.assetId) || allowlist.get(version.assetId) !== version.contentRevision)) throw unavailable();
          await verify();
        } catch { controller.abort(); throw unavailable(); }
        finally { inFlight = false; if (signal.aborted) release(); }
      }
    });
  } catch { controller.abort(); throw unavailable(); }
  finally { inFlight = false; if (signal.aborted) release(); }
}

async function anchor(path: string) {
  const stat = await lstat(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(process.getuid!()) || (stat.mode & 0o7077n) !== 0n) throw unavailable();
  return { path, identity: [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid].join(":") };
}

function validateManifest(value: unknown, pointer: NonNullable<Awaited<ReturnType<typeof readTeamIndexPublication>>>["value"],
  projection: Awaited<ReturnType<SharedKnowledgeReceiptBinding["project"]>>, models: TeamIndexModels | undefined,
  documents: readonly { assetId: string; contentRevision: string }[]) {
  const object = (item: unknown): Record<string, unknown> => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw unavailable();
    return item as Record<string, unknown>;
  };
  const manifest = object(value), snapshot = object(manifest.snapshot), artifact = object(manifest.artifact);
  if (Object.keys(manifest).length !== 7 || manifest.schema !== "newmoney.team-index-publication.v1" || manifest.scopeKey !== pointer.scopeKey
    || manifest.generation !== pointer.generation || Object.keys(snapshot).length !== 3 || snapshot.epoch !== pointer.epoch
    || snapshot.cursor !== pointer.cursor || snapshot.epoch !== projection.epoch || snapshot.cursor !== projection.cursor
    || snapshot.receiptRecord !== projection.receiptRecord) throw unavailable();
  if (!isSharedKnowledgeReceiptRequest({ type: "shared-knowledge-index-prepare", requestId: "reader", handleId: pointer.epoch, models: manifest.models })) throw unavailable();
  const saved = manifest.models as TeamIndexModels;
  if (models && (saved.embedding.endpoint !== models.embedding.endpoint || saved.embedding.model !== models.embedding.model || saved.embedding.dimension !== models.embedding.dimension
    || saved.extraction.endpoint !== models.extraction.endpoint || saved.extraction.model !== models.extraction.model)) throw unavailable();
  if (!Array.isArray(manifest.documents) || manifest.documents.length !== documents.length) throw unavailable();
  const remaining = new Map(documents.map(document => [document.assetId, document.contentRevision]));
  for (const item of manifest.documents) {
    const document = object(item);
    if (Object.keys(document).length !== 2 || typeof document.assetId !== "string" || typeof document.contentRevision !== "string"
      || remaining.get(document.assetId) !== document.contentRevision) throw unavailable();
    remaining.delete(document.assetId);
  }
  if (remaining.size || Object.keys(artifact).length !== 4 || typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) throw unavailable();
  for (const [key, limit] of [["files", 4096], ["directories", 4097], ["bytes", 512 * 1024 * 1024]] as const) {
    if (typeof artifact[key] !== "number" || !Number.isSafeInteger(artifact[key]) || artifact[key] < 1 || artifact[key] > limit) throw unavailable();
  }
  return { fingerprint: artifact as { sha256: string; files: number; directories: number; bytes: number },
    models: Object.freeze({ embedding: Object.freeze({ ...saved.embedding }), extraction: Object.freeze({ ...saved.extraction }) }) };
}
