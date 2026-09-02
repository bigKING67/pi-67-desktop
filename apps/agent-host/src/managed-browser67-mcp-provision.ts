import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { safeAtomicReplaceFile } from "@pi67/pi-runtime";
import { isRetiredBrowser67ServerPair } from "./retired-browser67-mcp.js";

const MANAGED_SCHEMA = "pi67.browser67-mcp.v1";
const SERVER_NAMES = ["tmwd_browser", "js-reverse"] as const;
const MAX_CONFIG_BYTES = 1_000_000;
const MAX_CACHE_BYTES = 8_000_000;
const MAX_CACHE_SERVERS = 128;

type ManagedServerName = typeof SERVER_NAMES[number];

interface ManagedServerReceipt {
  kind: "browser67-mcp";
  browser67Commit: string;
  specSha256: string;
  cacheRevisionSha256?: string;
}

interface ManagedMetadata {
  schema: typeof MANAGED_SCHEMA;
  servers: Partial<Record<ManagedServerName, ManagedServerReceipt>>;
}

type ManagedBrowser67McpStatus =
  | "skipped"
  | "created"
  | "updated"
  | "unchanged"
  | "user-owned-conflict"
  | "invalid-json"
  | "revision-conflict";

type ManagedBrowser67McpCacheStatus =
  | "skipped"
  | "missing"
  | "updated"
  | "unchanged"
  | "invalid-json"
  | "revision-conflict";

export interface ManagedBrowser67McpResult {
  status: ManagedBrowser67McpStatus;
  path: string;
  conflicts: ManagedServerName[];
  migratedLegacyServers: ManagedServerName[];
  cacheStatus: ManagedBrowser67McpCacheStatus;
  cachePath: string;
  invalidatedCacheServers: ManagedServerName[];
}

export async function provisionManagedBrowser67Mcp(options: {
  agentDir: string;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  readFile?: (path: string) => Promise<Uint8Array>;
}): Promise<ManagedBrowser67McpResult> {
  const environment = options.environment ?? process.env;
  const path = join(options.agentDir, "mcp.json");
  const cachePath = join(options.agentDir, "mcp-cache.json");
  let migratedLegacyServers: ManagedServerName[] = [];
  const result = (
    status: ManagedBrowser67McpStatus,
    conflicts: ManagedServerName[] = [],
    cacheStatus: ManagedBrowser67McpCacheStatus = "skipped",
    invalidatedCacheServers: ManagedServerName[] = []
  ): ManagedBrowser67McpResult => ({
    status,
    path,
    conflicts,
    migratedLegacyServers,
    cacheStatus,
    cachePath,
    invalidatedCacheServers
  });
  if (environment.PI67_DESKTOP !== "1") return result("skipped");
  const nodeExecutable = environment.PI67_NODE_EXECUTABLE;
  if (!nodeExecutable || !isAbsolute(nodeExecutable)) {
    throw new Error("Managed browser67 MCP requires the Desktop private Node executable.");
  }
  const browser67Root = resolveBrowser67CapabilityRoot(options.agentDir, environment);
  const browser67Package = await readBoundedJson(join(browser67Root, "package.json"));
  if (!isRecord(browser67Package) || !isCommit(browser67Package.gitHead)) {
    throw new Error("Managed browser67 MCP package identity is unavailable.");
  }
  const browser67Commit = browser67Package.gitHead;
  const expected = {
    tmwd_browser: {
      command: resolve(nodeExecutable),
      args: [join(browser67Root, "src", "mcp", "browser", "server.mjs")],
      directTools: true
    },
    "js-reverse": {
      command: resolve(nodeExecutable),
      args: [join(browser67Root, "src", "mcp", "js-reverse", "server.mjs")]
    }
  } satisfies Record<ManagedServerName, Record<string, unknown>>;
  await Promise.all(Object.values(expected).map(async (entry) => {
    const serverPath = (entry.args as string[])[0]!;
    const metadata = await lstat(serverPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("Managed browser67 MCP server entrypoint is unavailable.");
    }
  }));

  const read = options.readFile ?? ((filePath: string) => readFile(filePath));
  let revision = await readRevision(path, read, MAX_CONFIG_BYTES);
  let config: Record<string, unknown> = {};
  if (revision.kind === "present") {
    try {
      const parsed = JSON.parse(revision.bytes.toString("utf8")) as unknown;
      if (!isRecord(parsed)) return result("invalid-json");
      config = parsed;
    } catch {
      return result("invalid-json");
    }
  }
  if (config.mcpServers !== undefined && !isRecord(config.mcpServers)) {
    return result("invalid-json");
  }
  let servers: Record<string, unknown> = config.mcpServers === undefined
    ? {}
    : { ...config.mcpServers as Record<string, unknown> };
  let metadata = parseManagedMetadata(config.pi67ManagedMcp);
  if (config.pi67ManagedMcp !== undefined && !metadata) {
    return result("invalid-json");
  }
  const retiredPair = isRetiredBrowser67ServerPair({
    servers,
    managedReceipts: metadata?.servers,
    agentDir: options.agentDir,
    currentBrowser67Root: browser67Root,
    homeDirectory: options.homeDirectory ?? homedir()
  });
  const conflicts: ManagedServerName[] = [];
  for (const name of SERVER_NAMES) {
    const existing = servers[name];
    if (existing === undefined) continue;
    const receipt = metadata?.servers[name];
    if (receipt?.specSha256 === specSha256(existing)) continue;
    if (retiredPair) continue;
    conflicts.push(name);
  }
  if (conflicts.length > 0) return result("user-owned-conflict", conflicts);
  if (retiredPair) migratedLegacyServers = [...SERVER_NAMES];

  const nextReceipts: Record<ManagedServerName, ManagedServerReceipt> = {
    tmwd_browser: managedReceipt(browser67Commit, expected.tmwd_browser),
    "js-reverse": managedReceipt(browser67Commit, expected["js-reverse"])
  };
  const serverDefinitionsUnchanged = SERVER_NAMES.every((name) => (
    deepEqual(servers[name], expected[name])
    && sameManagedReceiptIdentity(metadata?.servers[name], nextReceipts[name])
  ));
  let configWritten = false;
  const initialKind = revision.kind;
  if (!serverDefinitionsUnchanged) {
    for (const name of SERVER_NAMES) servers[name] = expected[name];
    const provisionalReceipts = Object.fromEntries(SERVER_NAMES.map((name) => {
      const existingReceipt = metadata?.servers[name];
      const nextReceipt = nextReceipts[name];
      return [name, {
        ...nextReceipt,
        ...(sameManagedReceiptIdentity(existingReceipt, nextReceipt)
          && existingReceipt?.cacheRevisionSha256 === cacheRevisionSha256(nextReceipt)
          ? { cacheRevisionSha256: existingReceipt.cacheRevisionSha256 }
          : {})
      }];
    })) as Record<ManagedServerName, ManagedServerReceipt>;
    const nextConfig = {
      ...config,
      mcpServers: servers,
      pi67ManagedMcp: {
        schema: MANAGED_SCHEMA,
        servers: {
          ...metadata?.servers,
          ...provisionalReceipts
        }
      }
    };
    const next = serializeJson(nextConfig);
    if (!await replaceRevision(path, next, revision, read, MAX_CONFIG_BYTES)) {
      return result("revision-conflict");
    }
    revision = { kind: "present", bytes: Buffer.from(next) };
    config = nextConfig;
    metadata = parseManagedMetadata(nextConfig.pi67ManagedMcp);
    configWritten = true;
  }

  const pendingInvalidation = SERVER_NAMES.filter((name) => (
    metadata?.servers[name]?.cacheRevisionSha256 !== cacheRevisionSha256(nextReceipts[name])
  ));
  if (pendingInvalidation.length === 0) {
    return result(configWritten ? (initialKind === "missing" ? "created" : "updated") : "unchanged");
  }

  const cache = await invalidateManagedMcpCache(cachePath, pendingInvalidation, read);
  const provisionStatus = configWritten
    ? (initialKind === "missing" ? "created" : "updated")
    : "unchanged";
  if (cache.status === "invalid-json" || cache.status === "revision-conflict") {
    return result(provisionStatus, [], cache.status, cache.invalidatedServers);
  }

  const acknowledgedReceipts = Object.fromEntries(SERVER_NAMES.map((name) => [name, {
    ...nextReceipts[name],
    cacheRevisionSha256: cacheRevisionSha256(nextReceipts[name])
  }])) as Record<ManagedServerName, ManagedServerReceipt>;
  const acknowledgedConfig = {
    ...config,
    pi67ManagedMcp: {
      schema: MANAGED_SCHEMA,
      servers: {
        ...metadata?.servers,
        ...acknowledgedReceipts
      }
    }
  };
  const acknowledged = serializeJson(acknowledgedConfig);
  if (!await replaceRevision(path, acknowledged, revision, read, MAX_CONFIG_BYTES)) {
    return result("revision-conflict", [], cache.status, cache.invalidatedServers);
  }
  return result(
    initialKind === "missing" ? "created" : "updated",
    [],
    cache.status,
    cache.invalidatedServers
  );
}

function resolveBrowser67CapabilityRoot(agentDir: string, environment: NodeJS.ProcessEnv): string {
  const serialized = environment.PI67_CAPABILITY_PACKAGE_PATHS;
  if (serialized === undefined) {
    return join(agentDir, "desktop-capabilities", "packages", "browser67");
  }
  let paths: unknown;
  try {
    paths = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("Managed browser67 capability paths are malformed.");
  }
  const expected = [
    environment.PI67_BUNDLED_CAPABILITIES_ROOT,
    environment.PI67_MANAGED_CAPABILITIES_ROOT,
    environment.PI67_SHARED_PROFILE_ROOT
  ].filter((root): root is string => typeof root === "string" && isAbsolute(root))
    .map((root) => resolve(root, "packages", "browser67"));
  if (!Array.isArray(paths) || paths.length > 32 || expected.length === 0) {
    throw new Error("Managed browser67 capability paths are unavailable.");
  }
  const browser67Root = paths.find((path) => (
    typeof path === "string" && expected.some((candidate) => samePath(path, candidate))
  ));
  if (typeof browser67Root !== "string") {
    throw new Error("Managed browser67 capability package is unavailable.");
  }
  return resolve(browser67Root);
}

function samePath(left: string, right: string): boolean {
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  return normalize(left) === normalize(right);
}

function managedReceipt(
  browser67Commit: string,
  spec: unknown
): ManagedServerReceipt {
  return {
    kind: "browser67-mcp",
    browser67Commit,
    specSha256: specSha256(spec)
  };
}

function sameManagedReceiptIdentity(
  left: ManagedServerReceipt | undefined,
  right: ManagedServerReceipt
): boolean {
  return left?.kind === right.kind
    && left.browser67Commit === right.browser67Commit
    && left.specSha256 === right.specSha256;
}

function cacheRevisionSha256(receipt: ManagedServerReceipt): string {
  return specSha256({
    browser67Commit: receipt.browser67Commit,
    specSha256: receipt.specSha256
  });
}

function parseManagedMetadata(value: unknown): ManagedMetadata | undefined {
  if (!isRecord(value) || value.schema !== MANAGED_SCHEMA || !isRecord(value.servers)) return undefined;
  const servers: ManagedMetadata["servers"] = {};
  for (const name of SERVER_NAMES) {
    const receipt = value.servers[name];
    if (receipt === undefined) continue;
    if (
      !isRecord(receipt)
      || receipt.kind !== "browser67-mcp"
      || !isCommit(receipt.browser67Commit)
      || !isSha256(receipt.specSha256)
      || (receipt.cacheRevisionSha256 !== undefined && !isSha256(receipt.cacheRevisionSha256))
    ) return undefined;
    servers[name] = {
      kind: "browser67-mcp",
      browser67Commit: receipt.browser67Commit,
      specSha256: receipt.specSha256,
      ...(receipt.cacheRevisionSha256 === undefined
        ? {}
        : { cacheRevisionSha256: receipt.cacheRevisionSha256 })
    };
  }
  return { schema: MANAGED_SCHEMA, servers };
}

async function invalidateManagedMcpCache(
  path: string,
  serverNames: ManagedServerName[],
  read: (path: string) => Promise<Uint8Array>
): Promise<{
  status: Exclude<ManagedBrowser67McpCacheStatus, "skipped">;
  invalidatedServers: ManagedServerName[];
}> {
  const revision = await readRevision(path, read, MAX_CACHE_BYTES);
  if (revision.kind === "missing") return { status: "missing", invalidatedServers: [] };
  let cache: Record<string, unknown>;
  try {
    const parsed = JSON.parse(revision.bytes.toString("utf8")) as unknown;
    if (!isRecord(parsed)) return { status: "invalid-json", invalidatedServers: [] };
    cache = parsed;
  } catch {
    return { status: "invalid-json", invalidatedServers: [] };
  }
  if (
    cache.version !== 1
    || !isRecord(cache.servers)
    || Object.keys(cache.servers).length > MAX_CACHE_SERVERS
  ) {
    return { status: "invalid-json", invalidatedServers: [] };
  }
  const servers = { ...cache.servers };
  const invalidatedServers = serverNames.filter((name) => Object.hasOwn(servers, name));
  if (invalidatedServers.length === 0) return { status: "unchanged", invalidatedServers: [] };
  for (const name of invalidatedServers) delete servers[name];
  const next = serializeJson({ ...cache, servers });
  if (!await replaceRevision(path, next, revision, read, MAX_CACHE_BYTES)) {
    return { status: "revision-conflict", invalidatedServers: [] };
  }
  return { status: "updated", invalidatedServers };
}

async function readBoundedJson(path: string): Promise<unknown> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_CONFIG_BYTES) {
    throw new Error("Managed browser67 package metadata is invalid.");
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

type Revision = { kind: "missing" } | { kind: "present"; bytes: Buffer };

class RevisionConflictError extends Error {}

async function replaceRevision(
  path: string,
  contents: string,
  revision: Revision,
  read: (path: string) => Promise<Uint8Array>,
  maxBytes: number
): Promise<boolean> {
  try {
    await safeAtomicReplaceFile(path, contents, {
      mode: 0o600,
      beforeCommit: async () => {
        const latest = await readRevision(path, read, maxBytes);
        if (!sameRevision(revision, latest)) throw new RevisionConflictError();
      }
    });
    return true;
  } catch (error) {
    if (error instanceof RevisionConflictError) return false;
    throw error;
  }
}

async function readRevision(
  path: string,
  read: (path: string) => Promise<Uint8Array>,
  maxBytes: number
): Promise<Revision> {
  try {
    const bytes = Buffer.from(await read(path));
    if (bytes.byteLength > maxBytes) throw new Error("MCP configuration exceeds its size bound.");
    return { kind: "present", bytes };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { kind: "missing" };
    throw error;
  }
}

function sameRevision(expected: Revision, actual: Revision): boolean {
  if (expected.kind !== actual.kind) return false;
  return expected.kind === "missing"
    || (actual.kind === "present" && expected.bytes.equals(actual.bytes));
}

function specSha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function isCommit(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
