import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionCatalogContext, SessionCatalogDiscoveryResult } from "./session-catalog.js";
import {
  normalizeSessionCatalogPathIdentity,
  versionSessionCatalogSourceIdentity
} from "./session-path-identity.js";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

const MAX_CONCURRENT_SESSION_DIRECTORIES = 4;

interface SessionDiscoveryScan {
  sessions: SessionInfo[];
  scannedCount: number;
  incomplete: boolean;
}

async function listAgentSessions(agentDir: string): Promise<SessionDiscoveryScan> {
  const sessionsRoot = join(agentDir, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => join(sessionsRoot, entry.name));
  const sessions: SessionInfo[] = [];
  const scanned = { count: 0, incomplete: false };
  const workerCount = Math.min(MAX_CONCURRENT_SESSION_DIRECTORIES, directories.length);
  await Promise.all(
    Array.from({ length: workerCount }, (_, index) => (
      listSessionLane(directories, index, workerCount, sessions, scanned)
    ))
  );
  sessions.sort((left, right) => right.modified.getTime() - left.modified.getTime());
  return { sessions, scannedCount: scanned.count, incomplete: scanned.incomplete };
}

export interface SessionCatalogDiscoveryOptions {
  agentDir: string;
  configuredSessionDir?: string;
  workspaceCwd: string;
}

export function createSessionCatalogContext(options: SessionCatalogDiscoveryOptions): SessionCatalogContext {
  return {
    sourceKey: createSessionCatalogSourceKey(options),
    workspaceCwd: options.workspaceCwd,
    discover: () => discoverSessionCatalog(options)
  };
}

async function discoverSessionCatalog(
  options: SessionCatalogDiscoveryOptions
): Promise<SessionCatalogDiscoveryResult> {
  const scan = options.configuredSessionDir
    ? await listConfiguredSessions(options.configuredSessionDir)
    : await listAgentSessions(options.agentDir);
  const skippedCount = Math.max(0, scan.scannedCount - scan.sessions.length);
  return {
    records: scan.sessions.map(toCatalogRecord),
    incomplete: scan.incomplete || skippedCount > 0,
    skippedCount
  };
}

export function createSessionCatalogSourceKey(options: SessionCatalogDiscoveryOptions): string {
  const agentDir = normalizeSessionCatalogPathIdentity(options.agentDir);
  const configuredSessionDir = options.configuredSessionDir === undefined
    ? ""
    : normalizeSessionCatalogPathIdentity(options.configuredSessionDir);
  const identity = createHash("sha256").update(agentDir).update("\0").update(configuredSessionDir).digest("hex");
  return createHash("sha256").update(versionSessionCatalogSourceIdentity(identity)).digest("hex");
}

function toCatalogRecord(session: SessionInfo): SessionCatalogRecord {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    cwdKey: normalizeSessionCatalogPathIdentity(session.cwd),
    ...(session.name?.trim() ? { explicitName: session.name.trim() } : {}),
    modifiedAt: session.modified.getTime(),
    messageCount: session.messageCount,
    ...(session.parentSessionPath ? { parentSessionPath: session.parentSessionPath } : {})
  };
}

async function listSessionLane(
  directories: string[],
  index: number,
  stride: number,
  sessions: SessionInfo[],
  scanned: { count: number; incomplete: boolean }
): Promise<void> {
  const directory = directories[index];
  if (!directory) return;
  const scan = await listConfiguredSessions(directory);
  sessions.push(...scan.sessions);
  scanned.count += scan.scannedCount;
  scanned.incomplete ||= scan.incomplete;
  await listSessionLane(directories, index + stride, stride, sessions, scanned);
}

async function listConfiguredSessions(sessionDirectory: string): Promise<SessionDiscoveryScan> {
  const expectedCount = await readdir(sessionDirectory).then(
    (files) => files.filter((name) => name.endsWith(".jsonl")).length,
    (error: unknown) => (
      error instanceof Error && "code" in error && error.code === "ENOENT" ? 0 : undefined
    )
  );
  let progressCount = 0;
  const sessions = await SessionManager.listAll(sessionDirectory, (_loaded, total) => {
    progressCount = total;
  });
  return {
    sessions,
    scannedCount: expectedCount ?? progressCount,
    incomplete: expectedCount === undefined
  };
}
