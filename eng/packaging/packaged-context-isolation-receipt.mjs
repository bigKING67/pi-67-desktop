import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const PACKAGED_CONTEXT_ISOLATION_RECEIPT_SCHEMA = "pi67.packaged-context-isolation.v1";

export async function snapshotDirectoryMetadata(path) {
  try {
    const metadata = await lstat(path, { bigint: true });
    return {
      exists: true,
      device: String(metadata.dev),
      inode: String(metadata.ino),
      mode: Number(metadata.mode),
      links: String(metadata.nlink),
      size: String(metadata.size),
      modifiedNs: String(metadata.mtimeNs),
      changedNs: String(metadata.ctimeNs)
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}

export function watchDirectoryMutationDigests(path) {
  const observations = [];
  const watcher = watch(path, { recursive: true }, (eventType, filename) => {
    observations.push({
      eventType,
      pathSha256: sha256(String(filename ?? "<unknown>"))
    });
  });
  return {
    observations,
    close() {
      watcher.close();
    }
  };
}

export async function collectIsolatedSessionEvidence(agentDir) {
  const sessionRoot = resolve(agentDir, "sessions");
  const files = await findJsonlFiles(sessionRoot);
  const evidence = [];
  for (const path of files) {
    const contents = await readFile(path, "utf8");
    const entries = contents.split(/\r?\n/u).filter(Boolean).flatMap(parseJsonLine);
    const header = entries.find((entry) => entry?.type === "session");
    evidence.push({
      relativePath: portableRelative(agentDir, path),
      sha256: sha256(contents),
      byteLength: Buffer.byteLength(contents),
      entryCount: entries.length,
      sessionId: typeof header?.id === "string" ? header.id : null,
      compactionCount: entries.filter((entry) => entry?.type === "compaction").length
    });
  }
  return evidence;
}

export async function assertPathContained(root, candidate) {
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate)
  ]);
  const child = relative(canonicalRoot, canonicalCandidate);
  if (child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))) return;
  throw new Error(`Packaged isolation path escaped its exact profile root: ${candidate}`);
}

export function assertPackagedContextIsolationReceipt(receipt) {
  const failures = [];
  if (receipt?.schema !== PACKAGED_CONTEXT_ISOLATION_RECEIPT_SCHEMA) failures.push("schema is invalid");
  if (receipt?.status !== "passed") failures.push("status is not passed");
  if (receipt?.evidenceLevel !== "packaged-electron-runtime") failures.push("evidence level is invalid");
  if (receipt?.isolation?.allPathsContained !== true) failures.push("isolated paths are not contained");
  if (!sameMetadata(receipt?.canonicalSessionRoot?.before, receipt?.canonicalSessionRoot?.after)) {
    failures.push("canonical Session root metadata changed");
  }
  if (receipt?.canonicalSessionRoot?.mutationEventCount !== 0) {
    failures.push("canonical Session root emitted filesystem mutations");
  }
  if (!Array.isArray(receipt?.isolatedSessions) || receipt.isolatedSessions.length !== 1) {
    failures.push("expected exactly one isolated Pi JSONL Session");
  } else {
    const session = receipt.isolatedSessions[0];
    if (!/^sessions\/.+\.jsonl$/u.test(session.relativePath ?? "")) {
      failures.push("isolated Session locator is invalid");
    }
    if (!/^[a-f0-9]{64}$/u.test(session.sha256 ?? "")) failures.push("isolated Session hash is invalid");
    if (!Number.isSafeInteger(session.entryCount) || session.entryCount < 2) {
      failures.push("isolated Session has no persisted Turn");
    }
  }
  if (receipt?.openViking?.transport !== "isolated-loopback-double") {
    failures.push("OpenViking transport was not isolated");
  }
  if (receipt?.openViking?.healthObserved !== true) failures.push("OpenViking health was not observed");
  if (receipt?.openViking?.searchObserved !== true) failures.push("OpenViking search was not observed");
  if (receipt?.openViking?.nonSyntheticIdentityCount !== 0) {
    failures.push("OpenViking received a non-synthetic identity");
  }
  if (receipt?.openViking?.returnedRecallEntries !== 0) {
    failures.push("isolated OpenViking returned unexpected recall entries");
  }
  if (receipt?.modelContext?.memoryContextBlockCount !== 0) {
    failures.push("model context contained recalled Memory");
  }
  if (receipt?.cleanup?.isolatedProfileRemoved !== true) failures.push("isolated profile was not removed");
  if (receipt?.cleanup?.openVikingDoubleClosed !== true) failures.push("OpenViking double was not closed");
  if (receiptContainsCredentialMaterial(receipt)) failures.push("receipt contains credential material");
  if (failures.length > 0) throw new Error(`Packaged context isolation receipt failed: ${failures.join("; ")}`);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameMetadata(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function receiptContainsCredentialMaterial(receipt) {
  if (typeof receipt === "string") return /\bbearer\s+/iu.test(receipt);
  if (Array.isArray(receipt)) return receipt.some(receiptContainsCredentialMaterial);
  if (!receipt || typeof receipt !== "object") return false;
  return Object.entries(receipt).some(([key, value]) => (
    /^(?:authorization|api[_-]?key|credential|access[_-]?token|refresh[_-]?token)$/iu.test(key)
    || receiptContainsCredentialMaterial(value)
  ));
}

async function findJsonlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findJsonlFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function parseJsonLine(line) {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
}

function portableRelative(root, path) {
  return relative(resolve(root), resolve(path)).split(sep).join("/");
}
