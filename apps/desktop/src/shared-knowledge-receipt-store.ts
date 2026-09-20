import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

interface ReceiptPointer { version: 1; epoch: string; cursor: string; record: string }
interface ReceiptRecord {
  version: number; epoch: string; fromCursor: string; toCursor: string;
  payload: string; previous: string | null;
}
export interface SharedKnowledgeReceipt {
  epoch: string;
  fromCursor: string;
  toCursor: string;
  bytes: Uint8Array;
}
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
// Shared across binding generations in this Main process. Idle entries are
// removed; at most 16 accepted read/write operations retain queued resources.
const receiptTails = new Map<string, Promise<void>>();
let pendingReceiptOperations = 0;

/** Main-owned storage primitive, not an authorization/parser/index. All instances
 * must use the same canonical Main-owned root spelling (no filesystem aliases).
 * Coordination is process-local, not a cross-process or alias-aware file lock.
 * A future broker must validate that identity and the complete page before append.
 * Only established-epoch pages that advance receipt progress are stored here. */
export class SharedKnowledgeReceiptStore {
  readonly #directory: string;
  constructor(root: string, scopeKey: string) {
    if (!isAbsolute(root) || !HASH.test(scopeKey)) throw new Error("Invalid shared receipt directory.");
    this.#directory = resolve(root, scopeKey);
  }

  append(input: SharedKnowledgeReceipt): Promise<ReceiptPointer> {
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > 2 * 1024 * 1024) return Promise.reject(new Error("Invalid shared receipt size."));
    const snapshot = { ...input, bytes: input.bytes.slice() };
    return this.#serial(async () => {
      if (!UUID.test(snapshot.epoch) || cursor(snapshot.toCursor) <= cursor(snapshot.fromCursor)
          || snapshot.bytes.byteLength > 2 * 1024 * 1024 || snapshot.bytes.byteLength === 0) throw new Error("Invalid shared receipt batch.");
      await this.#prepare();
      const current = await this.#load();
      const payload = Buffer.from(snapshot.bytes).toString("base64");
      // Repeat only when the exact already-published bytes and source cursor match.
      if (current?.epoch === snapshot.epoch && current.cursor === snapshot.toCursor) {
        const record = await this.#record(current.record);
        if (record.fromCursor !== snapshot.fromCursor || record.payload !== payload) throw new Error("Shared receipt retry conflicts.");
        await this.#syncDirectory();
        return current;
      }
      if ((current?.cursor ?? "0") !== snapshot.fromCursor || (current && current.epoch !== snapshot.epoch)) throw new Error("Shared receipt cursor or epoch changed.");
      const content = JSON.stringify({ version: 1, epoch: snapshot.epoch, fromCursor: snapshot.fromCursor,
        toCursor: snapshot.toCursor, previous: current?.record ?? null, payload });
      const record = digest(content);
      // Publishing a page first can leave an unreachable orphan after a crash,
      // but must never leave a pointer to a partial/missing page.
      await this.#replace(`${record}.json`, content);
      const next: ReceiptPointer = { version: 1, epoch: snapshot.epoch, cursor: snapshot.toCursor, record };
      await this.#replace("receipt.json", JSON.stringify(next));
      return next;
    });
  }

  read(): Promise<ReceiptPointer | undefined> {
    return this.#serial(async () => { await this.#prepare(); return this.#load(); });
  }

  /** Verifies a captured tail back to zero, without loading history into memory.
   * Success covers only that snapshot, not later appends, indexing or permission.
   * A budget/abort failure never certifies a partially traversed chain. */
  async verifyHistory(maxPages: number, signal?: AbortSignal): Promise<{ pointer: ReceiptPointer | undefined; pages: number }> {
    return this.#verifyHistory(maxPages, signal);
  }

  /** Replays oldest-first into caller-owned, unpublished staging only. Callers
   * must discard partial staging on failure and separately validate pages,
   * identity, current head and authorization before publishing an index.
   * Callbacks run outside the writer queue; concurrent appends are not included.
   * Cancellation is cooperative: an active callback must honor the signal. */
  async replayHistory(maxPages: number, stage: (receipt: SharedKnowledgeReceipt, signal?: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<{ pointer: ReceiptPointer | undefined; pages: number }> {
    // Bound the hash-only replay manifest, never retain historical page bodies.
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10_000) throw new Error("Invalid shared receipt replay budget.");
    const hashes: string[] = [];
    const verified = await this.#verifyHistory(maxPages, signal, hashes);
    for (let index = hashes.length - 1; index >= 0; index -= 1) {
      signal?.throwIfAborted();
      const record = await this.#record(hashes[index]!);
      signal?.throwIfAborted();
      await stage({ epoch: record.epoch, fromCursor: record.fromCursor,
        toCursor: record.toCursor, bytes: Buffer.from(record.payload, "base64") }, signal);
      signal?.throwIfAborted();
    }
    return verified;
  }

  async #verifyHistory(maxPages: number, signal?: AbortSignal, hashes?: string[]): Promise<{ pointer: ReceiptPointer | undefined; pages: number }> {
    if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error("Invalid shared receipt verification budget.");
    signal?.throwIfAborted();
    const pointer = await this.read();
    signal?.throwIfAborted();
    let hash = pointer?.record ?? null;
    let expectedCursor = pointer?.cursor ?? "0";
    let pages = 0;
    // Immutable records permit traversal outside the writer queue. Strictly
    // decreasing cursors rule out cycles without retaining a growing hash set.
    while (hash !== null) {
      signal?.throwIfAborted();
      if (pages >= maxPages) throw new Error("Shared receipt verification budget exceeded.");
      const record = await this.#record(hash);
      signal?.throwIfAborted();
      if (record.epoch !== pointer?.epoch || record.toCursor !== expectedCursor) throw new Error("Shared receipt history mismatch.");
      hashes?.push(hash);
      expectedCursor = record.fromCursor;
      hash = record.previous;
      pages += 1;
    }
    if (expectedCursor !== "0") throw new Error("Shared receipt history is incomplete.");
    return { pointer, pages };
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    if (pendingReceiptOperations >= 16) return Promise.reject(new Error("Shared receipt operation capacity exceeded."));
    pendingReceiptOperations += 1;
    const previous = receiptTails.get(this.#directory) ?? Promise.resolve();
    const next = previous.then(operation);
    const tail = next.then(() => undefined, () => undefined).then(() => {
      pendingReceiptOperations -= 1;
      if (receiptTails.get(this.#directory) === tail) receiptTails.delete(this.#directory);
    });
    receiptTails.set(this.#directory, tail);
    return next;
  }

  async #prepare(): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.#directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe shared receipt directory.");
    if (process.platform !== "win32") await chmod(this.#directory, 0o700);
  }

  async #load(): Promise<ReceiptPointer | undefined> {
    let text: string;
    try { text = await this.#readFile("receipt.json", 1024); }
    catch (error) { if (code(error) === "ENOENT") return undefined; throw error; }
    const pointer = JSON.parse(text) as ReceiptPointer;
    if (!pointer || pointer.version !== 1 || Object.keys(pointer).length !== 4
        || typeof pointer.epoch !== "string" || !UUID.test(pointer.epoch)
        || typeof pointer.record !== "string" || !HASH.test(pointer.record)) throw new Error("Invalid shared receipt pointer.");
    cursor(pointer.cursor);
    const record = await this.#record(pointer.record);
    if (record.epoch !== pointer.epoch || record.toCursor !== pointer.cursor) throw new Error("Shared receipt pointer mismatch.");
    return pointer;
  }

  async #record(hash: string): Promise<ReceiptRecord> {
    const text = await this.#readFile(`${hash}.json`, 3 * 1024 * 1024);
    if (digest(text) !== hash) throw new Error("Shared receipt content is corrupt.");
    const record = JSON.parse(text) as ReceiptRecord;
    if (!record || record.version !== 1 || Object.keys(record).length !== 6
        || typeof record.epoch !== "string" || !UUID.test(record.epoch) || typeof record.payload !== "string"
        || (record.previous !== null && (typeof record.previous !== "string" || !HASH.test(record.previous)))
        || cursor(record.toCursor) <= cursor(record.fromCursor)) throw new Error("Invalid shared receipt content.");
    const bytes = Buffer.from(record.payload, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024
        || bytes.toString("base64") !== record.payload) throw new Error("Invalid shared receipt payload.");
    return record;
  }

  async #readFile(name: string, maximum: number): Promise<string> {
    const file = await open(join(this.#directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum) throw new Error("Unsafe shared receipt file.");
      return await file.readFile("utf8");
    } finally { await file.close(); }
  }

  async #replace(name: string, content: string): Promise<void> {
    const temporary = join(this.#directory, `.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(content, "utf8"); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(this.#directory, name));
      // Directory fsync is supported on this macOS path; unsupported hosts fail
      // explicitly. Real Windows durability is not claimed by this primitive.
      await this.#syncDirectory();
    } finally { await unlink(temporary).catch((error: unknown) => { if (code(error) !== "ENOENT") throw error; }); }
  }

  async #syncDirectory(): Promise<void> {
    const directory = await open(this.#directory, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
}

function cursor(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/u.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) throw new Error("Invalid shared receipt cursor.");
  return BigInt(value);
}
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function code(error: unknown): unknown { return error && typeof error === "object" && "code" in error ? error.code : undefined; }
