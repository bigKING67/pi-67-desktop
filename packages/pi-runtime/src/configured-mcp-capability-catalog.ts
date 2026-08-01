import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";

const MAX_MCP_CONFIG_BYTES = 1_000_000;
const MAX_MCP_CACHE_BYTES = 8_000_000;
const MAX_MCP_SERVERS = 128;
const MAX_MCP_TOOLS = 4_096;
const MAX_CAPABILITY_IDENTIFIER_CHARS = 256;

export type McpTransport = "stdio" | "http";
type McpToolPrefix = "server" | "none" | "short";

export interface ConfiguredMcpCapability {
  kind: "configured-mcp";
  serverName: string;
  toolName: string;
  transport: McpTransport;
  schemaDigest: string;
  sourceLabel: string;
}

interface McpToolMetadata {
  name: string;
  normalizedName: string;
  schemaDigest: string;
}

interface McpServerMetadata {
  name: string;
  transport: McpTransport;
  tools: Map<string, McpToolMetadata>;
  ambiguousTools: Set<string>;
}

export interface McpCatalogSnapshot {
  servers: Map<string, McpServerMetadata>;
  toolsByName: Map<string, ConfiguredMcpCapability[]>;
  directToolsByName: Map<string, ConfiguredMcpCapability[]>;
}

interface ParsedMcpServer {
  name: string;
  transport: McpTransport;
  directTools: true | Set<string> | false;
  excludedTools: Set<string>;
}

export async function collectMcpSnapshot(agentDir: string): Promise<McpCatalogSnapshot> {
  const [configValue, cacheValue] = await Promise.all([
    readBoundedJson(join(agentDir, "mcp.json"), MAX_MCP_CONFIG_BYTES),
    readBoundedJson(join(agentDir, "mcp-cache.json"), MAX_MCP_CACHE_BYTES)
  ]);
  const config = parseMcpConfig(configValue);
  const cache = parseMcpCache(cacheValue);
  if (!config || !cache) return emptyMcpSnapshot();

  const servers = new Map<string, McpServerMetadata>();
  const toolsByName = new Map<string, ConfiguredMcpCapability[]>();
  const directToolsByName = new Map<string, ConfiguredMcpCapability[]>();
  let totalTools = 0;
  for (const configured of config.servers.values()) {
    const cachedTools = cache.get(configured.name) ?? [];
    totalTools += cachedTools.length;
    if (totalTools > MAX_MCP_TOOLS) return emptyMcpSnapshot();
    const server: McpServerMetadata = {
      name: configured.name,
      transport: configured.transport,
      tools: new Map(),
      ambiguousTools: new Set()
    };
    for (const tool of cachedTools) {
      if (server.tools.has(tool.normalizedName)) {
        server.tools.delete(tool.normalizedName);
        server.ambiguousTools.add(tool.normalizedName);
        continue;
      }
      if (!server.ambiguousTools.has(tool.normalizedName)) server.tools.set(tool.normalizedName, tool);
    }
    servers.set(server.name, server);

    for (const tool of server.tools.values()) {
      const capability = configuredMcpTool(server, tool);
      addMapValue(toolsByName, tool.normalizedName, capability);
      if (!isDirectTool(configured, tool.name)) continue;
      const directName = formatToolName(tool.name, server.name, config.toolPrefix);
      if (
        configured.excludedTools.has(normalizeToolName(tool.name))
        || configured.excludedTools.has(normalizeToolName(directName))
      ) continue;
      addMapValue(directToolsByName, directName, capability);
    }
  }
  return { servers, toolsByName, directToolsByName };
}

export function configuredMcpTool(
  server: McpServerMetadata,
  tool: McpToolMetadata
): ConfiguredMcpCapability {
  return {
    kind: "configured-mcp",
    serverName: server.name,
    toolName: tool.name,
    transport: server.transport,
    schemaDigest: tool.schemaDigest,
    sourceLabel: mcpSourceLabel(server.name)
  };
}

export function mcpSourceLabel(serverName: string): string {
  return `MCP · ${serverName}`;
}

export function normalizeToolName(value: string): string {
  return value.replace(/-/gu, "_");
}

export function emptyMcpSnapshot(): McpCatalogSnapshot {
  return { servers: new Map(), toolsByName: new Map(), directToolsByName: new Map() };
}

function parseMcpConfig(value: unknown): {
  servers: Map<string, ParsedMcpServer>;
  toolPrefix: McpToolPrefix;
} | undefined {
  const root = asRecord(value);
  const rawServers = asRecord(root?.mcpServers);
  if (!root || !rawServers) return undefined;
  const entries = Object.entries(rawServers);
  if (entries.length > MAX_MCP_SERVERS) return undefined;
  const servers = new Map<string, ParsedMcpServer>();
  for (const [name, rawDefinition] of entries) {
    if (!isCapabilityIdentifier(name)) continue;
    const definition = asRecord(rawDefinition);
    if (!definition) continue;
    const transport = typeof definition.url === "string"
      ? "http"
      : typeof definition.command === "string" ? "stdio" : undefined;
    if (!transport) continue;
    servers.set(name, {
      name,
      transport,
      directTools: parseDirectTools(definition.directTools),
      excludedTools: parseNameSet(definition.excludeTools)
    });
  }
  const settings = asRecord(root.settings);
  const prefix = settings?.toolPrefix;
  const toolPrefix: McpToolPrefix = prefix === "none" || prefix === "short" || prefix === "server"
    ? prefix
    : "server";
  return { servers, toolPrefix };
}

function parseMcpCache(value: unknown): Map<string, McpToolMetadata[]> | undefined {
  const root = asRecord(value);
  const rawServers = asRecord(root?.servers);
  if (!root || !rawServers || Object.keys(rawServers).length > MAX_MCP_SERVERS) return undefined;
  const result = new Map<string, McpToolMetadata[]>();
  let totalTools = 0;
  for (const [serverName, rawServer] of Object.entries(rawServers)) {
    if (!isCapabilityIdentifier(serverName)) continue;
    const server = asRecord(rawServer);
    if (!server || !Array.isArray(server.tools)) continue;
    totalTools += server.tools.length;
    if (totalTools > MAX_MCP_TOOLS) return undefined;
    const tools: McpToolMetadata[] = [];
    for (const rawTool of server.tools) {
      const tool = asRecord(rawTool);
      if (!tool || !isCapabilityIdentifier(tool.name)) continue;
      tools.push({
        name: tool.name,
        normalizedName: normalizeToolName(tool.name),
        schemaDigest: digestSchema(tool.inputSchema)
      });
    }
    result.set(serverName, tools);
  }
  return result;
}

function parseDirectTools(value: unknown): ParsedMcpServer["directTools"] {
  if (value === true) return true;
  if (!Array.isArray(value)) return false;
  const names = value.filter(isCapabilityIdentifier);
  return names.length === value.length ? new Set(names.map(normalizeToolName)) : false;
}

function parseNameSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter(isCapabilityIdentifier).map(normalizeToolName));
}

function isDirectTool(server: ParsedMcpServer, toolName: string): boolean {
  return server.directTools === true
    || (server.directTools instanceof Set && server.directTools.has(normalizeToolName(toolName)));
}

function formatToolName(toolName: string, serverName: string, prefix: McpToolPrefix): string {
  if (prefix === "none") return toolName;
  const normalizedServer = serverName.replace(/-/gu, "_");
  const prefixValue = prefix === "short"
    ? normalizedServer.replace(/_?mcp$/iu, "") || "mcp"
    : normalizedServer;
  return `${prefixValue}_${toolName}`;
}

function digestSchema(schema: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(schema ?? null);
  } catch {
    serialized = "null";
  }
  return createHash("sha256").update(serialized).digest("hex");
}

async function readBoundedJson(path: string, maxBytes: number): Promise<unknown> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return undefined;
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")) as unknown;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function addMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key);
  if (current) current.push(value);
  else map.set(key, [value]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isCapabilityIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_CAPABILITY_IDENTIFIER_CHARS
    && /^[a-z0-9][a-z0-9._:-]*$/iu.test(value);
}
