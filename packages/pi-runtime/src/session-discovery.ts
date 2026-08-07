import { readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionCatalogContext, SessionCatalogDiscoveryResult } from "./session-catalog.js";
import {
  normalizeSessionCatalogPathIdentity,
  resolveExistingSessionFileIdentity,
  versionSessionCatalogSourceIdentity
} from "./session-path-identity.js";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

const MAX_CONCURRENT_SESSION_DIRECTORIES = 4;

interface SessionDiscoveryScan {
  sessions: IdentifiedSession[];
  scannedCount: number;
  incomplete: boolean;
}

interface IdentifiedSession {
  session: SessionInfo;
  fileIdentity: string;
}

async function listAgentSessions(agentDir: string): Promise<SessionDiscoveryScan> {
  const sessionsRoot = join(agentDir, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => join(sessionsRoot, entry.name));
  const sessions: IdentifiedSession[] = [];
  const scanned = { count: 0, incomplete: false };
  const workerCount = Math.min(MAX_CONCURRENT_SESSION_DIRECTORIES, directories.length);
  await Promise.all(
    Array.from({ length: workerCount }, (_, index) => (
      listSessionLane(directories, index, workerCount, sessions, scanned)
    ))
  );
  const unique = deduplicateIdentifiedSessions(sessions);
  unique.sessions.sort((left, right) => right.session.modified.getTime() - left.session.modified.getTime());
  return {
    sessions: unique.sessions,
    scannedCount: Math.max(0, scanned.count - unique.duplicateCount),
    incomplete: scanned.incomplete
  };
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
    records: scan.sessions.map(({ session, fileIdentity }) => toCatalogRecord(session, fileIdentity)),
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

function toCatalogRecord(session: SessionInfo, fileIdentity: string): SessionCatalogRecord {
  return {
    fileIdentity,
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
  sessions: IdentifiedSession[],
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
  const canonicalSessionDirectory = await realpath(resolve(sessionDirectory)).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!canonicalSessionDirectory) return { sessions: [], scannedCount: 0, incomplete: false };
  const expectedCount = await readdir(canonicalSessionDirectory).then(
    (files) => files.filter((name) => name.endsWith(".jsonl")).length,
    (error: unknown) => (
      error instanceof Error && "code" in error && error.code === "ENOENT" ? 0 : undefined
    )
  );
  let progressCount = 0;
  const discovered = await SessionManager.listAll(canonicalSessionDirectory, (_loaded, total) => {
    progressCount = total;
  });
  const identified = await identifyPhysicalSessions(discovered);
  const { sessions, duplicateCount } = deduplicateIdentifiedSessions(identified.sessions);
  return {
    sessions,
    scannedCount: Math.max(0, (expectedCount ?? progressCount) - duplicateCount),
    incomplete: expectedCount === undefined || identified.failedCount > 0
  };
}

async function identifyPhysicalSessions(
  sessions: SessionInfo[]
): Promise<{ sessions: IdentifiedSession[]; failedCount: number }> {
  const results = await Promise.all(sessions.map(async (session) => (
    resolveExistingSessionFileIdentity(session.path)
      .then((fileIdentity) => ({ session, fileIdentity }))
      .catch(() => undefined)
  )));
  return {
    sessions: results.filter((session): session is IdentifiedSession => session !== undefined),
    failedCount: results.filter((session) => session === undefined).length
  };
}

function deduplicateIdentifiedSessions(
  sessions: IdentifiedSession[]
): { sessions: IdentifiedSession[]; duplicateCount: number } {
  const seen = new Set<string>();
  const unique: IdentifiedSession[] = [];
  for (const session of sessions) {
    if (seen.has(session.fileIdentity)) continue;
    seen.add(session.fileIdentity);
    unique.push(session);
  }
  return { sessions: unique, duplicateCount: sessions.length - unique.length };
}
