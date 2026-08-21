import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  SkillPackEntry,
  SkillPackListResult,
  SkillPackLocalState,
  SkillPackUpdateStatus
} from "@pi67/domain";
import lockfile from "proper-lockfile";

const RECEIPT_SCHEMA = "pi67.skill-pack-check-receipts.v1";
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_RECEIPTS = 64;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

interface SkillPackCheckProjection {
  updateStatus: SkillPackUpdateStatus;
  localState: SkillPackLocalState;
  canUpdate: boolean;
  installedVersion?: string;
  installedSkillVersion?: string;
  latestVersion?: string;
  registryCommit?: string;
  detail?: string;
}

export interface SkillPackCheckReceipt {
  id: string;
  identity: string;
  checkedAt: number;
  projection: SkillPackCheckProjection;
}

interface SkillPackCheckReceiptState {
  schema: typeof RECEIPT_SCHEMA;
  receipts: SkillPackCheckReceipt[];
}

interface SkillPackReceiptIdentityOptions {
  homeDirectory: string;
  larkExecutable?: string;
}

export class SkillPackCheckReceiptStore {
  readonly #path: string;

  constructor(agentDir: string) {
    this.#path = join(resolve(agentDir), "desktop-capabilities", ".state", "skill-pack-checks.json");
  }

  async read(): Promise<SkillPackCheckReceipt[]> {
    return (await readState(this.#path))?.receipts ?? [];
  }

  async upsert(receipts: SkillPackCheckReceipt[]): Promise<boolean> {
    if (receipts.length === 0) return true;
    try {
      await ensurePrivateDirectory(dirname(this.#path));
      const release = await lockfile.lock(this.#path, {
        realpath: false,
        retries: { retries: 6, factor: 1.5, minTimeout: 25, maxTimeout: 200 },
        stale: 10_000
      });
      try {
        const current = await readState(this.#path);
        const byId = new Map((current?.receipts ?? []).map((receipt) => [receipt.id, receipt]));
        for (const receipt of receipts) byId.set(receipt.id, receipt);
        await writeState(this.#path, {
          schema: RECEIPT_SCHEMA,
          receipts: [...byId.values()].slice(-MAX_RECEIPTS)
        });
        return true;
      } finally {
        await release();
      }
    } catch {
      return false;
    }
  }
}

export class SkillPackCheckProjector {
  readonly #store: SkillPackCheckReceiptStore;

  constructor(
    agentDir: string,
    private readonly homeDirectory: string,
    private readonly resolveLarkCli: () => Promise<string | undefined>
  ) {
    this.#store = new SkillPackCheckReceiptStore(agentDir);
  }

  async applyStored(
    items: SkillPackEntry[],
    larkExecutable?: string
  ): Promise<SkillPackListResult> {
    const receipts = await this.#store.read();
    const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
    let checkedAt: number | undefined;
    const projected = await Promise.all(items.map(async (entry) => {
      const identity = await skillPackReceiptIdentity(entry, {
        homeDirectory: this.homeDirectory,
        ...(entry.manager === "lark-cli" && larkExecutable !== undefined ? { larkExecutable } : {})
      });
      const receipt = receiptById.get(entry.id);
      if (receipt?.identity === identity && receipt.projection.updateStatus !== "not-checked") {
        checkedAt = Math.max(checkedAt ?? 0, receipt.checkedAt);
      }
      return applySkillPackCheckReceipt(entry, identity, receipt);
    }));
    return {
      items: projected,
      total: projected.length,
      ...(checkedAt === undefined ? {} : { checkedAt })
    };
  }

  async persist(
    entries: SkillPackEntry[],
    checkedAt: number,
    larkExecutableOverride?: string
  ): Promise<boolean> {
    const larkExecutable = larkExecutableOverride ?? (
      entries.some((entry) => entry.manager === "lark-cli")
        ? await this.resolveLarkCli()
        : undefined
    );
    const receipts = await Promise.all(entries
      .filter((entry) => entry.updateStatus !== "not-checked")
      .map(async (entry) => createSkillPackCheckReceipt(
        entry,
        await skillPackReceiptIdentity(entry, {
          homeDirectory: this.homeDirectory,
          ...(entry.manager === "lark-cli" && larkExecutable !== undefined ? { larkExecutable } : {})
        }),
        checkedAt
      )));
    return this.#store.upsert(receipts);
  }
}

export function checkReceiptPersistenceWarning(entry: SkillPackEntry): SkillPackEntry {
  const warning = "检查已完成，但跨版本状态收据未能保存；重启 Desktop 后可能需要重新检查。";
  return {
    ...entry,
    detail: entry.detail ? `${entry.detail} ${warning}` : warning
  };
}

async function skillPackReceiptIdentity(
  entry: SkillPackEntry,
  options: SkillPackReceiptIdentityOptions
): Promise<string> {
  const common = {
    id: entry.id,
    manager: entry.manager,
    managerStatus: entry.managerStatus,
    localState: entry.manager === "lark-cli" ? undefined : entry.localState,
    installed: entry.installed,
    installedSkillCount: entry.installedSkillCount,
    skillIds: [...entry.skillIds].sort(),
    canInstall: entry.canInstall,
    effectiveSource: entry.effectiveSource,
    baselineVersion: entry.baselineVersion,
    installedVersion: entry.manager === "lark-cli" ? undefined : entry.installedVersion,
    registryCommit: entry.registryCommit
  };
  const lark = entry.manager === "lark-cli"
    ? {
        executable: options.larkExecutable === undefined
          ? undefined
          : await pathStamp(options.larkExecutable),
        skillLock: await pathStamp(join(options.homeDirectory, ".agents", ".skill-lock.json")),
        skills: await Promise.all([...entry.skillIds].sort().map(async (skillId) => ({
          id: skillId,
          manifest: await pathStamp(join(
            options.homeDirectory,
            ".agents",
            "skills",
            skillId,
            "SKILL.md"
          ))
        })))
      }
    : undefined;
  return createHash("sha256")
    .update(JSON.stringify({ common, lark }), "utf8")
    .digest("hex");
}

function createSkillPackCheckReceipt(
  entry: SkillPackEntry,
  identity: string,
  checkedAt: number
): SkillPackCheckReceipt {
  return {
    id: entry.id,
    identity,
    checkedAt,
    projection: {
      updateStatus: entry.updateStatus,
      localState: entry.localState,
      canUpdate: entry.canUpdate,
      ...(entry.installedVersion === undefined ? {} : { installedVersion: entry.installedVersion }),
      ...(entry.installedSkillVersion === undefined
        ? {}
        : { installedSkillVersion: entry.installedSkillVersion }),
      ...(entry.latestVersion === undefined ? {} : { latestVersion: entry.latestVersion }),
      ...(entry.registryCommit === undefined ? {} : { registryCommit: entry.registryCommit }),
      ...(entry.detail === undefined ? {} : { detail: entry.detail })
    }
  };
}

function applySkillPackCheckReceipt(
  entry: SkillPackEntry,
  identity: string,
  receipt: SkillPackCheckReceipt | undefined
): SkillPackEntry {
  if (receipt?.identity !== identity || receipt.projection.updateStatus === "not-checked") return entry;
  const projection = receipt.projection;
  return {
    ...entry,
    updateStatus: projection.updateStatus,
    localState: projection.localState,
    canUpdate: projection.canUpdate,
    ...(projection.installedVersion === undefined ? {} : { installedVersion: projection.installedVersion }),
    ...(projection.installedSkillVersion === undefined
      ? {}
      : { installedSkillVersion: projection.installedSkillVersion }),
    ...(projection.latestVersion === undefined ? {} : { latestVersion: projection.latestVersion }),
    ...(projection.registryCommit === undefined ? {} : { registryCommit: projection.registryCommit }),
    ...(projection.detail === undefined ? {} : { detail: projection.detail })
  };
}

async function pathStamp(path: string): Promise<unknown> {
  try {
    const [link, target] = await Promise.all([lstat(path), stat(path)]);
    return {
      path: resolve(path),
      link: fileMetadata(link),
      target: fileMetadata(target)
    };
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function fileMetadata(metadata: Awaited<ReturnType<typeof lstat>>): unknown {
  return {
    type: metadata.isFile() ? "file" : metadata.isDirectory() ? "directory" : metadata.isSymbolicLink() ? "symlink" : "other",
    size: metadata.size,
    mtimeMs: metadata.mtimeMs
  };
}

async function readState(path: string): Promise<SkillPackCheckReceiptState | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1 || metadata.size > MAX_RECEIPT_BYTES) {
      return undefined;
    }
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parseState(value);
  } catch {
    return undefined;
  }
}

function parseState(value: unknown): SkillPackCheckReceiptState | undefined {
  if (!isRecord(value) || value.schema !== RECEIPT_SCHEMA || !Array.isArray(value.receipts)) return undefined;
  if (value.receipts.length > MAX_RECEIPTS) return undefined;
  const receipts: SkillPackCheckReceipt[] = [];
  for (const candidate of value.receipts) {
    const parsed = parseReceipt(candidate);
    if (!parsed) return undefined;
    receipts.push(parsed);
  }
  return { schema: RECEIPT_SCHEMA, receipts };
}

function parseReceipt(value: unknown): SkillPackCheckReceipt | undefined {
  if (
    !isRecord(value)
    || !boundedString(value.id, 200)
    || !/^[A-Za-z0-9._:-]+$/u.test(value.id)
    || !boundedString(value.identity, 64)
    || !/^[a-f0-9]{64}$/u.test(value.identity)
    || !Number.isSafeInteger(value.checkedAt)
    || (value.checkedAt as number) < 0
    || !isRecord(value.projection)
  ) return undefined;
  const projection = parseProjection(value.projection);
  if (!projection) return undefined;
  return { id: value.id, identity: value.identity, checkedAt: value.checkedAt as number, projection };
}

function parseProjection(value: Record<string, unknown>): SkillPackCheckProjection | undefined {
  if (
    !isUpdateStatus(value.updateStatus)
    || !isLocalState(value.localState)
    || typeof value.canUpdate !== "boolean"
    || !optionalBoundedString(value.installedVersion, 100)
    || !optionalBoundedString(value.installedSkillVersion, 100)
    || !optionalBoundedString(value.latestVersion, 100)
    || !optionalHexString(value.registryCommit, 40, 64)
    || !optionalBoundedString(value.detail, 500)
  ) return undefined;
  return {
    updateStatus: value.updateStatus,
    localState: value.localState,
    canUpdate: value.canUpdate,
    ...(typeof value.installedVersion === "string" ? { installedVersion: value.installedVersion } : {}),
    ...(typeof value.installedSkillVersion === "string"
      ? { installedSkillVersion: value.installedSkillVersion }
      : {}),
    ...(typeof value.latestVersion === "string" ? { latestVersion: value.latestVersion } : {}),
    ...(typeof value.registryCommit === "string" ? { registryCommit: value.registryCommit } : {}),
    ...(typeof value.detail === "string" ? { detail: value.detail } : {})
  };
}

async function writeState(path: string, state: SkillPackCheckReceiptState): Promise<void> {
  const serialized = `${JSON.stringify(state)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) throw new Error("Skill Pack receipts exceed the storage limit.");
  const directory = dirname(path);
  const temporary = join(directory, `.${randomUUID()}.skill-pack-check.tmp`);
  const handle = await open(temporary, "wx", PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (process.platform !== "win32") await chmod(temporary, PRIVATE_FILE_MODE);
    await replaceWithBoundedRetry(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("Skill Pack receipt directory is unsafe.");
  if (process.platform !== "win32") await chmod(directory, PRIVATE_DIRECTORY_MODE);
}

async function replaceWithBoundedRetry(source: string, target: string): Promise<void> {
  const delays = [25, 50, 100, 200];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!isRetryableReplaceError(error) || attempt >= delays.length) throw error;
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delays[attempt]));
    }
  }
}

function isRetryableReplaceError(error: unknown): boolean {
  const code = nodeErrorCode(error);
  return code === "EACCES" || code === "EPERM" || code === "EBUSY";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function optionalBoundedString(value: unknown, maximum: number): boolean {
  return value === undefined || boundedString(value, maximum);
}

function optionalHexString(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined || (
    boundedString(value, maximum)
    && value.length >= minimum
    && /^[a-f0-9]+$/u.test(value)
  );
}

function isUpdateStatus(value: unknown): value is SkillPackUpdateStatus {
  return typeof value === "string" && [
    "not-installed",
    "not-checked",
    "sync-pending",
    "current",
    "update-available",
    "application-managed",
    "modified",
    "unavailable"
  ].includes(value);
}

function isLocalState(value: unknown): value is SkillPackLocalState {
  return value === "clean" || value === "modified" || value === "unknown";
}

function nodeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}
