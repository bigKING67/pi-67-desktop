import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, mkdtemp, open, opendir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

// Safety ceilings for the current 100-document / 8 MiB job, not measured product
// capacity. Stream both directory entries and bytes; never load a database file.
const MAX_ENTRIES = 4096, MAX_DEPTH = 32;
const MAX_FILE_BYTES = 256 * 1024 * 1024, MAX_TOTAL_BYTES = 512 * 1024 * 1024;

/** Main-owned physical-exit uncertainty, never constructed from worker payloads. */
export class TeamIndexWorkingCopyRetentionError extends Error {
  constructor() { super("Team query exit is unconfirmed; retain its working copy for recovery."); }
}

/** Main-only observation after confirmed physical completion. This does not lock
 * files against their OS owner, authenticate database semantics or publish them.
 * The caller owns/anchors staging and must recheck before any later use. */
export async function captureTeamIndexArtifact(input: {
  directory: string;
  signal: AbortSignal;
  assertCurrent(this: void): Promise<void>;
}) {
  const { directory, signal: lifetime, assertCurrent } = input;
  const root = join(directory, "index");
  async function measure(flush = false, operationSignal?: AbortSignal, copyDirectory?: string) {
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(60_000), ...(operationSignal ? [operationSignal] : [])]);
    const content = createHash("sha256"), identity = createHash("sha256");
    let entries = 0, files = 0, directories = 0, bytes = 0;
    const assertAccess = async () => {
      signal.throwIfAborted(); await assertCurrent(); signal.throwIfAborted();
    };
    async function visit(path: string, name: string, depth: number): Promise<void> {
      await assertAccess();
      if (depth > MAX_DEPTH) throw new Error("Team index directory depth exceeded.");
      const before = await lstat(path, { bigint: true });
      validate(before, true); directories += 1;
      if (copyDirectory) await mkdir(join(copyDirectory, "index", name), { mode: 0o700 });
      content.update(JSON.stringify(["directory", name]));
      identity.update(JSON.stringify([name, stamp(before)]));
      const names: string[] = [];
      const directoryHandle = await opendir(path);
      for await (const entry of directoryHandle) {
        signal.throwIfAborted();
        if (++entries > MAX_ENTRIES) throw new Error("Team index entry budget exceeded.");
        if (!entry.name || /[\\/\p{Cc}]/u.test(entry.name) || Buffer.byteLength(entry.name) > 255) {
          throw new Error("Invalid team index entry name.");
        }
        names.push(entry.name);
      }
      same(before, await lstat(path, { bigint: true }));
      for (const child of names.sort()) {
        signal.throwIfAborted();
        const childPath = join(path, child), childName = name ? `${name}/${child}` : child;
        const metadata = await lstat(childPath, { bigint: true });
        if (metadata.isDirectory()) await visit(childPath, childName, depth + 1);
        else {
          validate(metadata, false);
          if (metadata.size > BigInt(MAX_FILE_BYTES) || bytes + Number(metadata.size) > MAX_TOTAL_BYTES) {
            throw new Error("Team index byte budget exceeded.");
          }
          const handle = await open(childPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          let target: Awaited<ReturnType<typeof open>> | undefined;
          try {
            const opened = await handle.stat({ bigint: true });
            same(metadata, opened); validate(opened, false);
            if (copyDirectory) target = await open(join(copyDirectory, "index", childName), "wx", 0o600);
            const digest = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
            let length = 0;
            while (true) {
              signal.throwIfAborted();
              const read = await handle.read(buffer, 0, buffer.length, null);
              signal.throwIfAborted();
              if (read.bytesRead === 0) break;
              length += read.bytesRead;
              if (length > Number(opened.size)) throw new Error("Team index file changed.");
              digest.update(buffer.subarray(0, read.bytesRead));
              if (target) await target.writeFile(buffer.subarray(0, read.bytesRead));
            }
            if (length !== Number(opened.size)) throw new Error("Team index file changed.");
            if (flush) await handle.sync();
            same(opened, await handle.stat({ bigint: true }));
            same(opened, await lstat(childPath, { bigint: true }));
            content.update(JSON.stringify(["file", childName, length, digest.digest("hex")]));
            identity.update(JSON.stringify([childName, stamp(opened)]));
            files += 1; bytes += length;
          } finally { try { await target?.close(); } finally { await handle.close(); } }
        }
      }
      if (flush) {
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
        try { same(before, await handle.stat({ bigint: true })); await handle.sync(); }
        finally { await handle.close(); }
      }
      same(before, await lstat(path, { bigint: true }));
      await assertAccess();
    }
    await visit(root, "", 0);
    if (files === 0 || bytes === 0) throw new Error("Team index artifact is empty.");
    return { sha256: content.digest("hex"), identity: identity.digest("hex"), files, directories, bytes };
  }
  const captured = await measure();
  let copying = false;
  const unchanged = async (flush = false, operationSignal?: AbortSignal, copyDirectory?: string) => {
    const current = await measure(flush, operationSignal, copyDirectory);
    if (current.sha256 !== captured.sha256 || current.identity !== captured.identity) {
      throw new Error("Team index artifact changed after verification.");
    }
  };
  return Object.freeze({
    fingerprint: Object.freeze({ sha256: captured.sha256, files: captured.files, directories: captured.directories, bytes: captured.bytes }),
    assertUnchanged: (flush = false, operationSignal?: AbortSignal) => unchanged(flush, operationSignal),
    /** Main-only bracket. The operation must settle ONLY after its worker and
     * descendants physically exit, including cancellation. Abort is notification,
     * not evidence of exit. Unconfirmed cleanup must throw the typed retention
     * error instead of a normal rejection. Never query the source directory. */
    async withWorkingCopy<T>(operation: (directory: string, signal: AbortSignal) => Promise<T>, operationSignal: AbortSignal) {
      if (process.platform === "win32" || copying) throw new Error("Team index working copy unavailable.");
      const signal = AbortSignal.any([lifetime, operationSignal, AbortSignal.timeout(60_000)]);
      signal.throwIfAborted(); copying = true;
      const parent = dirname(directory);
      try {
        await assertCurrent(); signal.throwIfAborted();
        const parentIdentity = await lstat(parent, { bigint: true }); validate(parentIdentity, true);
        const path = await mkdtemp(join(parent, "query-"));
        const metadata = await lstat(path, { bigint: true }); validate(metadata, true);
        const checkCopy = async () => {
          const current = await lstat(path, { bigint: true }), currentParent = await lstat(parent, { bigint: true });
          validate(current, true); validate(currentParent, true);
          if (current.dev !== metadata.dev || current.ino !== metadata.ino
            || currentParent.dev !== parentIdentity.dev || currentParent.ino !== parentIdentity.ino) {
            throw new Error("Team query directory changed; cleanup requires recovery.");
          }
        };
        // Cleanup deliberately ignores cancellation, but never deletes a replaced
        // directory. Such failures remain observable for exact-path recovery.
        let result: T, retained = false;
        try {
          await checkCopy();
          await unchanged(false, signal, path);
          await checkCopy();
          const copied = await captureTeamIndexArtifact({ directory: path, signal,
            assertCurrent: async () => { await assertCurrent(); await checkCopy(); } });
          if (copied.fingerprint.sha256 !== captured.sha256 || copied.fingerprint.bytes !== captured.bytes
            || copied.fingerprint.files !== captured.files || copied.fingerprint.directories !== captured.directories) {
            throw new Error("Team index copy mismatch.");
          }
          await unchanged(false, signal); signal.throwIfAborted();
          result = await operation(path, signal);
          signal.throwIfAborted(); await unchanged(false, signal);
        } catch (error) {
          retained = error instanceof TeamIndexWorkingCopyRetentionError;
          throw error;
        } finally { if (!retained) { await checkCopy(); await rm(path, { recursive: true }); } }
        signal.throwIfAborted(); await assertCurrent(); signal.throwIfAborted();
        return result;
      } finally { copying = false; }
    }
  });
}

function validate(metadata: BigIntStats, directory: boolean): void {
  if (metadata.isSymbolicLink() || (directory ? !metadata.isDirectory() : !metadata.isFile() || metadata.nlink !== 1n)
    || process.platform !== "win32" && (metadata.uid !== BigInt(process.getuid!()) || (metadata.mode & 0o077n) !== 0n
      || (metadata.mode & 0o7000n) !== 0n || !directory && (metadata.mode & 0o111n) !== 0n)) {
    throw new Error("Unsafe team index artifact entry.");
  }
}

function stamp(metadata: BigIntStats): string {
  return [metadata.dev, metadata.ino, metadata.mode, metadata.uid, metadata.gid, metadata.nlink,
    metadata.size, metadata.mtimeNs, metadata.ctimeNs].join(":");
}

function same(before: BigIntStats, after: BigIntStats): void {
  if (stamp(before) !== stamp(after)) throw new Error("Team index artifact changed during verification.");
}
