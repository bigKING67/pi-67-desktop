import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import {
  getMcpToolExposure, mcpNamespace, validateMcpServerConfig,
  type LoadedMcpConfig, type McpServerEntry, type McpExposure
} from "@earendil-works/pi-coding-agent";

const MAX_CONFIG_BYTES = 1_000_000;
const MAX_SERVERS = 128;

/** Read-only translation; user files and credentials remain Pi-owned. */
export function loadDesktopMcpConfig(options: {
  agentDir: string; cwd: string; projectTrusted: boolean;
}): LoadedMcpConfig {
  const servers = new Map<string, McpServerEntry>();
  const conflictedNamespaces = new Set<string>();
  const errors: string[] = [];
  const files = [{ path: join(options.agentDir, "mcp.json"), scope: "global" as const },
    ...(options.projectTrusted ? [{ path: join(options.cwd, ".pi", "mcp.json"), scope: "project" as const }] : [])];
  for (const { path, scope } of files) {
    let root: Record<string, unknown>;
    try {
      const value = readConfig(path);
      if (value === undefined) continue;
      if (!isRecord(value) || (value.mcpServers !== undefined && !isRecord(value.mcpServers))) {
        throw new Error("expected an mcpServers object");
      }
      root = value;
    } catch {
      errors.push(`${scope} mcp.json: unreadable, invalid or over 1 MB; no servers loaded from this file`);
      // A broken project override cannot silently restore the global connection.
      servers.clear();
      return { servers: [], errors, autoEnableCodemode: false };
    }
    if (root.imports !== undefined && (!Array.isArray(root.imports) || root.imports.length > 0)) {
      errors.push(`${scope} mcp.json: legacy imports are not loaded; move the intended servers into Pi mcpServers`);
    }
    const settings = isRecord(root.settings) ? root.settings : {};
    const entries = Object.entries((root.mcpServers ?? {}) as Record<string, unknown>);
    if (entries.length > MAX_SERVERS) {
      errors.push(`${scope} mcp.json: at most ${MAX_SERVERS} servers are supported`);
      return { servers: [], errors, autoEnableCodemode: false };
    }
    for (const [name, raw] of entries) {
      // Invalid project overrides remove the old global entry instead of falling back.
      servers.delete(name);
      const namespace = mcpNamespace(name);
      try {
        if (conflictedNamespaces.has(namespace)) throw new Error("server namespace conflicts with another configured server");
        const translated = translateServer(raw, settings);
        const config = validateMcpServerConfig(name, translated);
        if (typeof config === "string") throw new Error("invalid native MCP configuration; check server name, transport, exposure and authentication fields");
        if (config.exposure === "codemode" || Object.values(config.toolExposure ?? {}).includes("codemode")) {
          throw new Error("Codemode is not enabled in Desktop; choose direct, deferred or hidden exposure");
        }
        if (scope === "project" && "url" in config && config.auth) throw new Error("provider auth requires global configuration");
        const clash = [...servers.keys()].find((other) => mcpNamespace(other) === mcpNamespace(name));
        if (clash) {
          servers.delete(clash);
          conflictedNamespaces.add(namespace);
          throw new Error("server namespace conflicts with another configured server");
        }
        servers.set(name, { name, config, source: path, scope });
      } catch (error) {
        // A malformed project alias cannot revive a global entry under the same
        // native namespace; an already ambiguous namespace stays quarantined.
        for (const other of servers.keys()) {
          if (mcpNamespace(other) === namespace) {
            servers.delete(other);
            conflictedNamespaces.add(namespace);
          }
        }
        // Translation errors contain field names only; never interpolate raw values.
        const reason = error instanceof Error ? error.message : "invalid configuration";
        errors.push(`${scope} MCP ${safeName(name)}: ${reason}`);
      }
    }
  }
  if (servers.size > MAX_SERVERS) return { servers: [], errors: [...errors, "Too many effective MCP servers"], autoEnableCodemode: false };
  return { servers: [...servers.values()], errors, autoEnableCodemode: false };
}

function translateServer(raw: unknown, settings: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(raw)) throw new Error("server must be an object");
  const result = { ...raw };
  delete result.directTools;
  const direct = raw.directTools ?? settings.directTools;
  if (raw.exposure === undefined) {
    result.exposure = direct === true ? "direct" : "deferred";
    if (Array.isArray(direct)) {
      if (!direct.every((name) => typeof name === "string" && name.length > 0)) throw new Error("invalid directTools list");
      result.directTools = direct;
    } else if (direct !== undefined && typeof direct !== "boolean") throw new Error("invalid directTools setting");
  }
  if (result.exposure === "codemode" || result.exposure === "codemode-deferred"
    || (isRecord(result.toolExposure) && Object.values(result.toolExposure).some((value) => value === "codemode"))) {
    throw new Error("Codemode is not enabled in Desktop; choose direct, deferred or hidden exposure");
  }
  if (raw.excludeTools !== undefined) {
    if (!Array.isArray(raw.excludeTools) || !raw.excludeTools.every((name) => typeof name === "string" && name.length > 0)) {
      throw new Error("invalid excludeTools list");
    }
    result.toolExposure = { ...(isRecord(result.toolExposure) ? result.toolExposure : {}),
      ...Object.fromEntries(raw.excludeTools.map((name) => [name, "hidden"])) };
  }
  const timeout = raw.requestTimeoutMs ?? settings.requestTimeoutMs;
  if (raw.timeout === undefined && timeout !== undefined) {
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) throw new Error("invalid requestTimeoutMs");
    result.timeout = timeout / 1000;
  }
  if (raw.bearerToken !== undefined || raw.bearerTokenEnv !== undefined) {
    if (raw.bearerToken !== undefined && raw.bearerTokenEnv !== undefined) throw new Error("ambiguous bearer token fields");
    const headers = isRecord(raw.headers) ? { ...raw.headers } : {};
    if (Object.keys(headers).some((key) => key.toLowerCase() === "authorization")) throw new Error("ambiguous Authorization header");
    if (typeof raw.bearerTokenEnv === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(raw.bearerTokenEnv)) {
      headers.Authorization = `Bearer \${${raw.bearerTokenEnv}}`;
    } else if (typeof raw.bearerToken === "string" && raw.bearerToken.length > 0) headers.Authorization = `Bearer ${raw.bearerToken}`;
    else throw new Error("invalid bearer token field");
    result.headers = headers;
  }
  if (raw.auth === "oauth" || raw.auth === "bearer") delete result.auth;
  // Do not silently enable native OAuth when a legacy entry explicitly disabled it.
  if (raw.auth === false || raw.oauth === false) throw new Error("legacy auth:false/oauth:false needs an explicit native authentication configuration");
  if (raw.type === "sse") throw new Error("legacy SSE is unsupported; configure streamable HTTP");
  // Keep exclusion names in this ephemeral config for exact live-tool matching.
  // Pi itself ignores this legacy field; the host exposure callback resolves it.
  for (const field of ["requestTimeoutMs", "bearerToken", "bearerTokenEnv"]) delete result[field];
  return result;
}

export function desktopMcpToolExposure(entry: McpServerEntry, toolName: string, exposure: McpExposure): McpExposure {
  const legacy = entry.config as unknown as Record<string, unknown>;
  const server = entry.name.replaceAll("-", "_");
  const short = server.replace(/_?mcp$/iu, "") || "mcp";
  const candidates = new Set([toolName, `${server}_${toolName}`, `${short}_${toolName}`]
    .map((name) => name.replaceAll("-", "_")));
  const matches = (names: unknown) => Array.isArray(names)
    && names.some((name) => typeof name === "string" && candidates.has(name.replaceAll("-", "_")));
  if (matches(legacy.excludeTools)) return "hidden";
  // An explicit native override, including a wildcard or deferred exposure,
  // always wins over the translated legacy direct list.
  if (exposure === "deferred" && matches(legacy.directTools)
    && getMcpToolExposure({ ...entry.config, exposure: "hidden" }, toolName) === "hidden") return "direct";
  return exposure;
}

function readConfig(path: string): unknown {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Error("configuration must be a regular file");
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = readSync(fd, buffer, bytes, buffer.length - bytes, bytes);
      if (!read) break;
      bytes += read;
    }
    if (bytes > MAX_CONFIG_BYTES) throw new Error("oversized config");
    return JSON.parse(buffer.subarray(0, bytes).toString("utf8")) as unknown;
  } finally { closeSync(fd); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeName(name: string): string {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(name) ? name : "[invalid server name]";
}
