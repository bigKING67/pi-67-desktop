import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { SessionCatalogView, SessionSummary } from "@pi67/domain";
import { HostCommandError } from "../protocol-error.js";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";

const SESSION_PAGE_LIMIT = 200;
const MAX_SESSION_PAGES = 100;
const MAX_SESSION_BYTES = 256 * 1_024 * 1_024;
const HASH_BUFFER_BYTES = 1 * 1_024 * 1_024;

export interface SessionCommitProvenance {
  workspaceId: string;
  workspaceFingerprint: string;
  sourceSessionIdHash: string;
  sessionContentHash: string;
  sessionFileIdentityHash: string;
  sessionBytes: number;
  capturedAt: number;
}

export async function captureSessionCommitProvenance(
  workspaces: WorkspaceContextRegistry,
  workspaceId: string,
  sessionId: string
): Promise<SessionCommitProvenance> {
  const session = await findExactSession(workspaces, workspaceId, sessionId);
  const snapshot = await hashStableSessionFile(session.path);
  return {
    workspaceId,
    workspaceFingerprint: sha256(`pi67-workspace:${workspaceId}`),
    sourceSessionIdHash: sha256(sessionId),
    sessionContentHash: snapshot.sha256,
    sessionFileIdentityHash: sha256(session.fileIdentity),
    sessionBytes: snapshot.bytes,
    capturedAt: Date.now()
  };
}

async function findExactSession(
  workspaces: WorkspaceContextRegistry,
  workspaceId: string,
  sessionId: string
): Promise<SessionSummary> {
  const matches: SessionSummary[] = [];
  for (const view of ["active", "archived"] satisfies SessionCatalogView[]) {
    let cursor: Parameters<WorkspaceContextRegistry["queryCatalog"]>[1]["cursor"];
    for (let pageIndex = 0; pageIndex < MAX_SESSION_PAGES; pageIndex += 1) {
      const page = await workspaces.queryCatalog(workspaceId, {
        scope: "workspace",
        view,
        limit: SESSION_PAGE_LIMIT,
        ...(cursor === undefined ? { refresh: pageIndex === 0 } : { cursor })
      });
      matches.push(...page.items.filter((item) => item.id === sessionId));
      if (!page.hasMore) break;
      if (!page.nextCursor) {
        throw new HostCommandError(
          "RUNTIME_NOT_READY",
          "The Session Catalog returned an incomplete provenance page.",
          true
        );
      }
      cursor = page.nextCursor;
      if (pageIndex === MAX_SESSION_PAGES - 1) {
        throw new HostCommandError(
          "RESOURCE_LIMIT_EXCEEDED",
          "The Session Catalog is too large to resolve exact candidate provenance safely.",
          true
        );
      }
    }
  }
  const unique = [...new Map(matches.map((item) => [item.fileIdentity, item])).values()];
  if (unique.length === 0) {
    throw new HostCommandError(
      "RESOURCE_NOT_FOUND",
      "The exact Pi JSONL Session could not be resolved for Experience provenance.",
      true
    );
  }
  if (unique.length !== 1) {
    throw new HostCommandError(
      "DUPLICATE_REQUEST",
      "More than one Pi JSONL Session matched the requested Session identity.",
      false
    );
  }
  return unique[0]!;
}

async function hashStableSessionFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const link = await lstat(path);
  if (!link.isFile() || link.isSymbolicLink()) {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      "The Session provenance source must be a regular non-symlink JSONL file.",
      false
    );
  }
  if (link.size > MAX_SESSION_BYTES) {
    throw new HostCommandError(
      "RESOURCE_LIMIT_EXCEEDED",
      "The Session JSONL exceeds the 256 MiB candidate-provenance limit.",
      true
    );
  }
  const flags = process.platform === "win32"
    ? fsConstants.O_RDONLY
    : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
  const handle = await open(path, flags);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== link.size) throw sessionChanged();
    if (link.ino !== 0 && before.ino !== 0 && (link.dev !== before.dev || link.ino !== before.ino)) {
      throw sessionChanged();
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let position = 0;
    while (position < before.size) {
      const length = Math.min(buffer.byteLength, before.size - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead <= 0) throw sessionChanged();
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (
      after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || (before.ino !== 0 && after.ino !== 0 && (after.dev !== before.dev || after.ino !== before.ino))
    ) throw sessionChanged();
    return { sha256: hash.digest("hex"), bytes: before.size };
  } finally {
    await handle.close();
  }
}

function sessionChanged(): HostCommandError {
  return new HostCommandError(
    "RESOURCE_CHANGED_EXTERNALLY",
    "The Pi JSONL Session changed while candidate provenance was being captured.",
    true
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
