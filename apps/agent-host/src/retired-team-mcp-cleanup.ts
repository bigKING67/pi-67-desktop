import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { safeAtomicReplaceFile } from "@pi67/pi-runtime";

const RETIRED_SERVER_NAME = "tavily-bridge";
const RETIRED_SERVER_URL = "https://tavily.52671314.xyz/mcp";
const RETIRED_TOKEN_ENV = "TAVILY_BRIDGE_MCP_TOKEN";

type RetiredTeamMcpCleanupStatus =
  | "skipped"
  | "missing"
  | "removed"
  | "preserved-user"
  | "invalid-json"
  | "revision-conflict";

export interface RetiredTeamMcpCleanupResult {
  status: RetiredTeamMcpCleanupStatus;
  path: string;
}

export async function removeRetiredTeamMcpConfig(options: {
  agentDir: string;
  environment?: NodeJS.ProcessEnv;
  readFile?: (path: string) => Promise<Uint8Array>;
}): Promise<RetiredTeamMcpCleanupResult> {
  const path = join(options.agentDir, "mcp.json");
  if ((options.environment ?? process.env).PI67_DESKTOP !== "1") {
    return { status: "skipped", path };
  }

  const read = options.readFile ?? ((filePath: string) => readFile(filePath));
  const revision = await readRevision(path, read);
  if (revision.kind === "missing") return { status: "missing", path };

  let config: Record<string, unknown>;
  try {
    const parsed = JSON.parse(revision.bytes.toString("utf8")) as unknown;
    if (!isRecord(parsed)) return { status: "invalid-json", path };
    config = parsed;
  } catch {
    return { status: "invalid-json", path };
  }

  if (!isRecord(config.mcpServers)) {
    return { status: config.mcpServers === undefined ? "missing" : "preserved-user", path };
  }
  const servers = { ...config.mcpServers };
  const candidate = servers[RETIRED_SERVER_NAME];
  if (candidate === undefined) return { status: "missing", path };
  if (!isDesktopManagedRetiredEntry(candidate)) return { status: "preserved-user", path };

  delete servers[RETIRED_SERVER_NAME];
  const next = `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`;
  try {
    await safeAtomicReplaceFile(path, next, {
      mode: 0o600,
      beforeCommit: async () => {
        const latest = await readRevision(path, read);
        if (!sameRevision(revision, latest)) throw new RevisionConflictError();
      }
    });
  } catch (error) {
    if (error instanceof RevisionConflictError) return { status: "revision-conflict", path };
    throw error;
  }
  return { status: "removed", path };
}

export function isDesktopManagedRetiredEntry(value: unknown): boolean {
  return isRecord(value)
    && value.url === RETIRED_SERVER_URL
    && value.auth === "bearer"
    && value.bearerTokenEnv === RETIRED_TOKEN_ENV;
}

type Revision =
  | { kind: "missing" }
  | { kind: "present"; bytes: Buffer };

class RevisionConflictError extends Error {}

async function readRevision(
  path: string,
  read: (path: string) => Promise<Uint8Array>
): Promise<Revision> {
  try {
    return { kind: "present", bytes: Buffer.from(await read(path)) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { kind: "missing" };
    }
    throw error;
  }
}

function sameRevision(expected: Revision, actual: Revision): boolean {
  if (expected.kind !== actual.kind) return false;
  return expected.kind === "missing"
    || (actual.kind === "present" && expected.bytes.equals(actual.bytes));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
