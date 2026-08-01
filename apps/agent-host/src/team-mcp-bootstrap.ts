import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  | "invalid-json";

export interface TeamMcpBootstrapResult {
  status: TeamMcpBootstrapStatus;
  path: string;
  serverName: string;
}

export interface TeamMcpBootstrapOptions {
  agentDir: string;
  environment?: NodeJS.ProcessEnv;
  baseline?: TeamMcpServerBaseline;
  createToken?: () => string;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, data: string, options?: { mode?: number }) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  mkdir?: (path: string, options?: { recursive?: boolean; mode?: number }) => Promise<unknown>;
  exists?: (path: string) => boolean;
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
  const read = options.readFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const write = options.writeFile
    ?? ((filePath: string, data: string, fileOptions?: { mode?: number }) =>
      writeFile(filePath, data, { mode: fileOptions?.mode ?? 0o600 }));
  const move = options.rename ?? rename;
  const makeDir = options.mkdir
    ?? ((dir: string, dirOptions?: { recursive?: boolean; mode?: number }) =>
      mkdir(dir, { recursive: dirOptions?.recursive ?? true, mode: dirOptions?.mode ?? 0o700 }));
  const exists = options.exists ?? existsSync;
  const createToken = options.createToken ?? randomUUID;

  let raw: string | undefined;
  if (exists(path)) {
    try {
      raw = await read(path);
    } catch {
      return { status: "invalid-json", path, serverName };
    }
  }

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

  await makeDir(options.agentDir, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${createToken()}.tmp`;
  await write(temporary, next, { mode: 0o600 });
  await move(temporary, path);
  return {
    status: raw === undefined ? "created" : "merged",
    path,
    serverName
  };
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
