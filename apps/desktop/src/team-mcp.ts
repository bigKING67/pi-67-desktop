import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const TEAM_MCP_SERVER_NAME = "tavily-bridge";
export const TEAM_MCP_TOKEN_ENV = "TAVILY_BRIDGE_MCP_TOKEN";
export const TEAM_MCP_TOKEN_FILE = "tavily-bridge.token";
const TEAM_MCP_SERVER_FILE = "tavily-bridge.server.json";

const DEFAULT_LOCAL_SECRET = join(homedir(), ".grok", "secrets", "tavily_bridge_mcp_token");

export interface TeamMcpServerDefinition {
  name: string;
  url: string;
  auth: "bearer";
  bearerTokenEnv: string;
  lifecycle: "lazy" | "eager" | "keep-alive";
  requestTimeoutMs: number;
  directTools: string[];
}

export const DEFAULT_TEAM_MCP_SERVER: TeamMcpServerDefinition = {
  name: TEAM_MCP_SERVER_NAME,
  url: "https://tavily.52671314.xyz/mcp",
  auth: "bearer",
  bearerTokenEnv: TEAM_MCP_TOKEN_ENV,
  lifecycle: "lazy",
  requestTimeoutMs: 180_000,
  directTools: ["tavily_search", "tavily_extract"]
};

/**
 * Read the team MCP bearer token for Agent Host env injection.
 * Priority: explicit userData token → resources (legacy) → optional local secret (dev).
 * Never logs the token value.
 */
export function readTeamMcpToken(options: {
  userTokenPath?: string;
  resourcesRoot?: string;
  localSecretPath?: string;
  allowLocalSecretFallback?: boolean;
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
} = {}): string | undefined {
  const read = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const exists = options.exists ?? existsSync;
  const candidates: string[] = [];
  if (options.userTokenPath) candidates.push(options.userTokenPath);
  if (options.resourcesRoot) {
    candidates.push(join(options.resourcesRoot, TEAM_MCP_TOKEN_FILE));
  }
  if (options.allowLocalSecretFallback !== false) {
    candidates.push(options.localSecretPath ?? DEFAULT_LOCAL_SECRET);
  }

  for (const path of candidates) {
    if (!exists(path)) continue;
    try {
      const token = read(path).replace(/^\uFEFF/, "").trim();
      if (token.startsWith("mcp_") && token.includes(".") && token.length >= 20) return token;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

export function loadTeamMcpServerDefinition(options: {
  resourcesRoot?: string;
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
} = {}): TeamMcpServerDefinition {
  const read = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const exists = options.exists ?? existsSync;
  if (options.resourcesRoot) {
    const path = join(options.resourcesRoot, TEAM_MCP_SERVER_FILE);
    if (exists(path)) {
      try {
        const parsed = JSON.parse(read(path)) as Partial<TeamMcpServerDefinition>;
        return normalizeServerDefinition(parsed);
      } catch {
        // fall through to default
      }
    }
  }
  return { ...DEFAULT_TEAM_MCP_SERVER, directTools: [...DEFAULT_TEAM_MCP_SERVER.directTools] };
}

export function teamMcpServerEntry(
  definition: TeamMcpServerDefinition = DEFAULT_TEAM_MCP_SERVER
): Record<string, unknown> {
  return {
    url: definition.url,
    auth: definition.auth,
    bearerTokenEnv: definition.bearerTokenEnv,
    lifecycle: definition.lifecycle,
    requestTimeoutMs: definition.requestTimeoutMs,
    directTools: [...definition.directTools]
  };
}

function normalizeServerDefinition(value: Partial<TeamMcpServerDefinition>): TeamMcpServerDefinition {
  const url = typeof value.url === "string" && value.url.trim() ? value.url.trim() : DEFAULT_TEAM_MCP_SERVER.url;
  const bearerTokenEnv = typeof value.bearerTokenEnv === "string" && value.bearerTokenEnv.trim()
    ? value.bearerTokenEnv.trim()
    : DEFAULT_TEAM_MCP_SERVER.bearerTokenEnv;
  const lifecycle = value.lifecycle === "eager" || value.lifecycle === "keep-alive" || value.lifecycle === "lazy"
    ? value.lifecycle
    : DEFAULT_TEAM_MCP_SERVER.lifecycle;
  const requestTimeoutMs = typeof value.requestTimeoutMs === "number" && value.requestTimeoutMs > 0
    ? value.requestTimeoutMs
    : DEFAULT_TEAM_MCP_SERVER.requestTimeoutMs;
  const directTools = Array.isArray(value.directTools)
    ? value.directTools.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [...DEFAULT_TEAM_MCP_SERVER.directTools];
  return {
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : TEAM_MCP_SERVER_NAME,
    url,
    auth: "bearer",
    bearerTokenEnv,
    lifecycle,
    requestTimeoutMs,
    directTools: directTools.length > 0 ? directTools : [...DEFAULT_TEAM_MCP_SERVER.directTools]
  };
}

export function resolveTeamMcpResourcesRoot(options: {
  packaged: boolean;
  resourcesPath?: string;
  repositoryRoot?: string;
}): string {
  if (options.packaged) {
    return join(options.resourcesPath ?? process.resourcesPath, "team-mcp");
  }
  if (options.repositoryRoot) {
    return resolve(options.repositoryRoot, "apps/desktop/resources/team-mcp");
  }
  return resolve(process.cwd(), "apps/desktop/resources/team-mcp");
}
