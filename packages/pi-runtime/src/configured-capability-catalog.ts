import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  PackageSource,
  ResourceLoader,
  SettingsManager,
  SourceInfo
} from "@earendil-works/pi-coding-agent";
import {
  collectMcpSnapshot,
  configuredMcpTool,
  emptyMcpSnapshot,
  mcpSourceLabel,
  normalizeToolName,
  type ConfiguredMcpCapability,
  type McpCatalogSnapshot,
  type McpTransport
} from "./configured-mcp-capability-catalog.js";

export type { ConfiguredMcpCapability } from "./configured-mcp-capability-catalog.js";

interface ConfiguredPackageCapability {
  kind: "configured-package" | "managed-package";
  sourceLabel: string;
}

export type ConfiguredPackageResolution = ConfiguredPackageCapability | {
  kind: "unconfigured" | "ambiguous";
  sourceLabel: string;
};

export type ConfiguredMcpServerResolution = {
  kind: "configured-mcp";
  serverName: string;
  transport: McpTransport;
  sourceLabel: string;
} | {
  kind: "unconfigured";
  sourceLabel: string;
};

export type ConfiguredMcpToolResolution = ConfiguredMcpCapability | {
  kind: "unconfigured" | "ambiguous";
  sourceLabel: string;
};

interface PackageIdentity extends ConfiguredPackageCapability {
  id: string;
}

interface ConfiguredCapabilityCatalogOptions {
  settingsManager: Pick<SettingsManager, "getPackages">;
  agentDir: string;
  environment?: NodeJS.ProcessEnv;
}

const catalogByLoader = new WeakMap<ResourceLoader, ConfiguredCapabilityCatalog>();

export class ConfiguredCapabilityCatalog {
  private packageIdentities = new Map<string, PackageIdentity[]>();
  private mcp: McpCatalogSnapshot = emptyMcpSnapshot();
  private readonly environment: NodeJS.ProcessEnv;

  constructor(private readonly options: ConfiguredCapabilityCatalogOptions) {
    this.environment = options.environment ?? process.env;
  }

  useSettingsManager(settingsManager: Pick<SettingsManager, "getPackages">): void {
    this.options.settingsManager = settingsManager;
  }

  async refresh(): Promise<void> {
    const packageIdentities = collectPackageIdentities(
      safeGetPackages(this.options.settingsManager),
      this.environment
    );
    const mcp = await collectMcpSnapshot(this.options.agentDir);
    this.packageIdentities = packageIdentities;
    this.mcp = mcp;
  }

  resolvePackageSource(source: SourceInfo): ConfiguredPackageResolution {
    if (source.origin !== "package") {
      return { kind: "unconfigured", sourceLabel: "未配置的直接 Extension" };
    }
    const matches = new Map<string, PackageIdentity>();
    for (const candidate of sourceIdentityCandidates(source)) {
      for (const identity of this.packageIdentities.get(candidate) ?? []) {
        matches.set(identity.id, identity);
      }
    }
    if (matches.size === 0) {
      return { kind: "unconfigured", sourceLabel: "未配置的 Package" };
    }
    if (matches.size !== 1) {
      return { kind: "ambiguous", sourceLabel: "多个已配置 Package 来源" };
    }
    const identity = [...matches.values()][0]!;
    return { kind: identity.kind, sourceLabel: identity.sourceLabel };
  }

  resolveMcpServer(serverName: string): ConfiguredMcpServerResolution {
    const server = this.mcp.servers.get(serverName);
    if (!server) return { kind: "unconfigured", sourceLabel: "未配置的 MCP server" };
    return {
      kind: "configured-mcp",
      serverName: server.name,
      transport: server.transport,
      sourceLabel: mcpSourceLabel(server.name)
    };
  }

  resolveMcpTool(toolName: string, serverName?: string): ConfiguredMcpToolResolution {
    const normalizedName = normalizeToolName(toolName);
    if (serverName !== undefined) {
      const server = this.mcp.servers.get(serverName);
      if (!server) return { kind: "unconfigured", sourceLabel: "未配置的 MCP server" };
      if (server.ambiguousTools.has(normalizedName)) {
        return { kind: "ambiguous", sourceLabel: `MCP · ${server.name}` };
      }
      const tool = server.tools.get(normalizedName);
      return tool === undefined
        ? { kind: "unconfigured", sourceLabel: `MCP · ${server.name}` }
        : configuredMcpTool(server, tool);
    }

    const matches = this.mcp.toolsByName.get(normalizedName) ?? [];
    if (matches.length === 0) return { kind: "unconfigured", sourceLabel: "已配置 MCP 目录" };
    if (matches.length !== 1) return { kind: "ambiguous", sourceLabel: "多个已配置 MCP server" };
    return matches[0]!;
  }

  resolveDirectMcpTool(toolName: string): ConfiguredMcpToolResolution {
    const matches = this.mcp.directToolsByName.get(toolName) ?? [];
    if (matches.length === 0) return { kind: "unconfigured", sourceLabel: "已配置 MCP Direct Tool" };
    if (matches.length !== 1) return { kind: "ambiguous", sourceLabel: "多个 MCP Direct Tool 来源" };
    return matches[0]!;
  }
}

export function bindConfiguredCapabilityCatalog(
  loader: ResourceLoader,
  catalog: ConfiguredCapabilityCatalog
): void {
  catalogByLoader.set(loader, catalog);
}

export async function refreshConfiguredCapabilityCatalog(loader: ResourceLoader): Promise<void> {
  await catalogByLoader.get(loader)?.refresh();
}

function safeGetPackages(
  settingsManager: Pick<SettingsManager, "getPackages">
): PackageSource[] {
  try {
    return settingsManager.getPackages();
  } catch {
    return [];
  }
}

function collectPackageIdentities(
  packages: readonly PackageSource[],
  environment: NodeJS.ProcessEnv
): Map<string, PackageIdentity[]> {
  const result = new Map<string, PackageIdentity[]>();
  const managedRoot = absoluteEnvironmentPath(environment.PI67_MANAGED_CAPABILITIES_ROOT);
  for (const entry of packages) {
    const source = typeof entry === "string" ? entry : entry.source;
    if (!isNonEmptyBoundedString(source, 4_096)) continue;
    const managed = managedRoot !== undefined && isSameOrContainedPath(source, managedRoot);
    const identity: PackageIdentity = {
      id: `${managed ? "managed" : "configured"}:${source}`,
      kind: managed ? "managed-package" : "configured-package",
      sourceLabel: packageSourceLabel(source, managed)
    };
    for (const key of packageIdentityKeys(source)) addMapValue(result, key, identity);
  }
  return result;
}

function sourceIdentityCandidates(source: SourceInfo): string[] {
  return [...new Set([
    ...packageIdentityKeys(source.source),
    ...(source.baseDir === undefined ? [] : packageIdentityKeys(source.baseDir))
  ])];
}

function packageIdentityKeys(source: string): string[] {
  const trimmed = source.trim();
  if (!trimmed) return [];
  if (isAbsolute(trimmed)) return [`path:${normalizeAbsolutePath(trimmed)}`];
  const npmName = parseNpmPackageName(trimmed);
  if (npmName !== undefined) return [`npm:${npmName}`];
  return [`source:${trimmed}`];
}

function parseNpmPackageName(source: string): string | undefined {
  const value = source.startsWith("npm:") ? source.slice(4) : source;
  if (/^(?:git\+|https?:|ssh:|file:|github:)/iu.test(value)) return undefined;
  const scoped = /^(@[a-z0-9._-]+\/[a-z0-9._-]+)(?:@.+)?$/iu.exec(value);
  if (scoped) return scoped[1];
  const unscoped = /^([a-z0-9._-]+)(?:@.+)?$/iu.exec(value);
  return unscoped?.[1];
}

function packageSourceLabel(source: string, managed: boolean): string {
  const npmName = parseNpmPackageName(source);
  const pathName = isAbsolute(source) ? basename(resolve(source)) : undefined;
  const safeName = [npmName, pathName].find((value) => (
    value !== undefined && /^[a-z0-9@/._-]{1,128}$/iu.test(value)
  ));
  const prefix = managed ? "桌面托管 Package" : "已配置 Package";
  return safeName === undefined ? prefix : `${prefix} · ${safeName}`;
}

function addMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key);
  if (current) current.push(value);
  else map.set(key, [value]);
}

function isNonEmptyBoundedString(value: unknown, maxChars: number): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= maxChars;
}

function absoluteEnvironmentPath(value: string | undefined): string | undefined {
  return value !== undefined && isAbsolute(value) ? normalizeAbsolutePath(value) : undefined;
}

function isSameOrContainedPath(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const normalizedCandidate = normalizeAbsolutePath(candidate);
  const fromRoot = relative(root, normalizedCandidate);
  return fromRoot === ""
    || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function normalizeAbsolutePath(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
