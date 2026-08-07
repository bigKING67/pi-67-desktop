import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { safeAtomicReplaceFile } from "@pi67/pi-runtime";

const TEAM_MCP_SERVER_NAME = "tavily-bridge";
const TEAM_MCP_TOKEN_ENV = "TAVILY_BRIDGE_MCP_TOKEN";

export interface TeamMcpServerBaseline {
  url: string;
  auth: "bearer";
  bearerTokenEnv: string;
  lifecycle: "lazy" | "eager" | "keep-alive";
  requestTimeoutMs: number;
  directTools: string[];
}

export const DEFAULT_TEAM_MCP_BASELINE: TeamMcpServerBaseline = {
  url: "https://tavily.52671314.xyz/mcp",
  auth: "bearer",
  bearerTokenEnv: TEAM_MCP_TOKEN_ENV,
  lifecycle: "lazy",
  requestTimeoutMs: 180_000,
  directTools: ["tavily_search", "tavily_extract"]
};

type TeamMcpBootstrapStatus =
  | "skipped"
  | "created"
  | "merged"
  | "unchanged"
  | "preserved-user"
  | "invalid-json"
  | "revision-conflict";

export interface TeamMcpBootstrapResult {
  status: TeamMcpBootstrapStatus;
  path: string;
  serverName: string;
}

export interface TeamMcpBootstrapOptions {
  agentDir: string;
  environment?: NodeJS.ProcessEnv;
  baseline?: TeamMcpServerBaseline;
  readFile?: (path: string) => Promise<Uint8Array>;
}

/**
 * Ensure the team Tavily Bridge MCP server entry exists in the user's mcp.json.
 * Never writes the bearer token into the file; only bearerTokenEnv is stored.
 */
export async function bootstrapTeamMcpConfig(
  options: TeamMcpBootstrapOptions
): Promise<TeamMcpBootstrapResult> {
  const environment = options.environment ?? process.env;
  const path = join(options.agentDir, "mcp.json");
  const serverName = TEAM_MCP_SERVER_NAME;
  if (environment.PI67_DESKTOP !== "1") {
    return { status: "skipped", path, serverName };
  }

  const baseline = options.baseline ?? DEFAULT_TEAM_MCP_BASELINE;
  const read = options.readFile ?? ((filePath: string) => readFile(filePath));
  const revision = await readTeamMcpRevision(path, read).catch(() => undefined);
  if (!revision) return { status: "invalid-json", path, serverName };
  const raw = revision.kind === "present" ? revision.bytes.toString("utf8") : undefined;

  let config: Record<string, unknown>;
  if (raw === undefined) {
    config = {
      mcpServers: {},
      settings: { toolPrefix: "short" }
    };
  } else {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { status: "invalid-json", path, serverName };
      }
      config = parsed as Record<string, unknown>;
    } catch {
      return { status: "invalid-json", path, serverName };
    }
  }

  const serversValue = config.mcpServers;
  const servers = serversValue && typeof serversValue === "object" && !Array.isArray(serversValue)
    ? { ...(serversValue as Record<string, unknown>) }
    : {};

  const existing = servers[serverName];
  const decision = planTeamMcpMerge(existing, baseline);
  if (decision.status === "preserved-user" || decision.status === "unchanged") {
    return { status: decision.status, path, serverName };
  }

  servers[serverName] = decision.entry;
  config.mcpServers = servers;
  if (!config.settings || typeof config.settings !== "object" || Array.isArray(config.settings)) {
    config.settings = { toolPrefix: "short" };
  }

  const next = `${JSON.stringify(config, null, 2)}\n`;
  if (raw !== undefined && raw === next) {
    return { status: "unchanged", path, serverName };
  }

  try {
    await mkdir(options.agentDir, { recursive: true, mode: 0o700 });
    await safeAtomicReplaceFile(path, next, {
      mode: 0o600,
      beforeCommit: async () => {
        const latest = await readTeamMcpRevision(path, read);
        if (!sameTeamMcpRevision(revision, latest)) throw new TeamMcpRevisionConflictError();
      }
    });
  } catch (error) {
    if (error instanceof TeamMcpRevisionConflictError) {
      return { status: "revision-conflict", path, serverName };
    }
    throw error;
  }
  return {
    status: raw === undefined ? "created" : "merged",
    path,
    serverName
  };
}

type TeamMcpRevision =
  | { readonly kind: "missing" }
  | { readonly kind: "present"; readonly bytes: Buffer };

class TeamMcpRevisionConflictError extends Error {
  constructor() {
    super("mcp.json changed while Team MCP bootstrap was preparing its update.");
  }
}

async function readTeamMcpRevision(
  path: string,
  read: (path: string) => Promise<Uint8Array>
): Promise<TeamMcpRevision> {
  try {
    return { kind: "present", bytes: Buffer.from(await read(path)) };
  } catch (error) {
    if (isMissingFileError(error)) return { kind: "missing" };
    throw error;
  }
}

function sameTeamMcpRevision(expected: TeamMcpRevision, actual: TeamMcpRevision): boolean {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === "missing") return true;
  return actual.kind === "present" && expected.bytes.equals(actual.bytes);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function planTeamMcpMerge(
  existing: unknown,
  baseline: TeamMcpServerBaseline
): {
  status: "merged" | "unchanged" | "preserved-user";
  entry: Record<string, unknown>;
} {
  const baselineEntry = {
    url: baseline.url,
    auth: baseline.auth,
    bearerTokenEnv: baseline.bearerTokenEnv,
    lifecycle: baseline.lifecycle,
    requestTimeoutMs: baseline.requestTimeoutMs,
    directTools: [...baseline.directTools]
  };

  if (existing === undefined || existing === null) {
    return { status: "merged", entry: baselineEntry };
  }
  if (typeof existing !== "object" || Array.isArray(existing)) {
    return { status: "preserved-user", entry: baselineEntry };
  }

  const current = existing as Record<string, unknown>;
  const url = typeof current.url === "string" ? current.url : undefined;
  const auth = current.auth;
  const bearerTokenEnv = typeof current.bearerTokenEnv === "string" ? current.bearerTokenEnv : undefined;

  // User replaced the team endpoint or auth model — do not clobber.
  if (
    (url !== undefined && url !== baseline.url)
    || (auth !== undefined && auth !== baseline.auth)
    || (bearerTokenEnv !== undefined && bearerTokenEnv !== baseline.bearerTokenEnv)
  ) {
    return { status: "preserved-user", entry: { ...current } };
  }

  const merged: Record<string, unknown> = {
    ...current,
    url: baseline.url,
    auth: baseline.auth,
    bearerTokenEnv: baseline.bearerTokenEnv,
    lifecycle: current.lifecycle ?? baseline.lifecycle,
    requestTimeoutMs: current.requestTimeoutMs ?? baseline.requestTimeoutMs,
    directTools: Array.isArray(current.directTools) && current.directTools.length > 0
      ? current.directTools
      : [...baseline.directTools]
  };

  if (stableJson(merged) === stableJson(current)) {
    return { status: "unchanged", entry: merged };
  }
  return { status: "merged", entry: merged };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
