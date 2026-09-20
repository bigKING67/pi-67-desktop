import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

/** Shared preparation/admission format. Installed trees must remain owner-controlled. */
export async function runtimeTreeIdentity(root: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!isAbsolute(root)) throw new Error("Runtime directory must be absolute.");
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error("Unsafe runtime directory.");
  const digest = createHash("sha256");
  let bytes = 0;
  let files = 0;
  const canonicalRoot = await realpath(root);
  async function visit(directory: string): Promise<void> {
    signal?.throwIfAborted();
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    // Drain before descending: at most eight file streams globally, not eight per depth.
    let pending: Promise<{ record: string; bytes: number; files: number }>[] = [];
    async function drain() {
      const results = await Promise.allSettled(pending);
      pending = [];
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
        digest.update(result.value.record);
        bytes += result.value.bytes;
        files += result.value.files;
      }
    }
    try {
      for (const entry of entries) {
        signal?.throwIfAborted();
        const path = join(directory, entry.name);
        const name = relative(root, path).split(sep).join("/");
        const metadata = await lstat(path);
        if (metadata.isSymbolicLink()) {
          await drain();
          const target = await readlink(path);
          const resolved = await realpath(path);
          if (isAbsolute(target) || !resolved.startsWith(`${canonicalRoot}${sep}`)) {
            throw new Error("Runtime symlink escapes its directory.");
          }
          digest.update(JSON.stringify(["link", name, target]));
        } else if (metadata.isDirectory()) {
          await drain();
          await visit(path);
        } else if (metadata.isFile()) {
          const task = measureFile(path, name, metadata, signal);
          // Observe immediately even if traversal fails before the next drain.
          void task.catch(() => undefined);
          pending.push(task);
          if (pending.length === 8) await drain();
        } else throw new Error("Unsupported runtime entry.");
      }
      await drain();
    } finally { await Promise.allSettled(pending); }
  }
  await visit(root);
  signal?.throwIfAborted();
  return { sha256: digest.digest("hex"), files, bytes };
}

async function measureFile(path: string, name: string, metadata: Stats, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== metadata.dev || before.ino !== metadata.ino) {
      throw new Error("Runtime changed during verification.");
    }
    const content = createHash("sha256");
    // Abort may arrive while awaiting metadata; do not construct an already-aborted stream.
    signal?.throwIfAborted();
    const stream = handle.createReadStream({ autoClose: false, ...(signal ? { signal } : {}) });
    for await (const chunk of stream) content.update(chunk);
    const after = await handle.stat();
    const current = await lstat(path);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink()) {
      throw new Error("Runtime changed during verification.");
    }
    return { record: JSON.stringify(["file", name, before.mode & 0o777, content.digest("hex")]), bytes: before.size, files: 1 };
  } finally { await handle.close(); }
}
