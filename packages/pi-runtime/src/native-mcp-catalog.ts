import { createHash } from "node:crypto";
import type { ExtensionAPI, McpExtensionOptions, McpServerEntry, SourceInfo } from "@earendil-works/pi-coding-agent";

export const NATIVE_MCP_EXTENSION_PATH = "<inline:pi67-native-mcp>";
const NATIVE_MCP_SEARCH_PATH = "<inline:pi67-native-tool-search>";
type NativeBinding = Parameters<NonNullable<McpExtensionOptions["onToolsChanged"]>>[1][number];
type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number];

export interface NativeMcpCapability {
  kind: "configured-mcp";
  serverName: string;
  toolName: string;
  sourceLabel: string;
  schemaDigest: string;
}

interface ServerIdentity {
  signature: string;
  bindings: Map<string, { capability: NativeMcpCapability; parameters: ToolInfo["parameters"]; exposure: string }>;
}

/** Credentials/config bodies are never retained in the permission catalog. */
export class NativeMcpCatalog {
  private readonly servers = new Map<string, ServerIdentity>();

  configure(entries: readonly McpServerEntry[]): void {
    this.servers.clear();
    for (const entry of entries) {
      if (entry.config.enabled === false) continue;
      this.servers.set(entry.name, { signature: signature(entry), bindings: new Map() });
    }
  }

  clear(): void { this.servers.clear(); }

  replaceTools(entry: McpServerEntry, tools: readonly NativeBinding[]): void {
    const server = this.servers.get(entry.name);
    if (!server) return;
    server.bindings.clear();
    if (server.signature !== signature(entry) || tools.length > 4_096) return;
    const rawNames = new Set<string>();
    for (const tool of tools) {
      if (tool.exposure === "hidden") continue;
      if (!tool.name || tool.name.length > 64 || !tool.toolName || tool.toolName.length > 256
        || rawNames.has(tool.toolName) || server.bindings.has(tool.name)) {
        server.bindings.clear();
        return;
      }
      rawNames.add(tool.toolName);
      server.bindings.set(tool.name, {
        parameters: tool.parameters, exposure: tool.exposure,
        capability: { kind: "configured-mcp", serverName: entry.name, toolName: tool.toolName,
          sourceLabel: `MCP · ${entry.name}`, schemaDigest: schemaDigest(tool.parameters) }
      });
    }
  }

  resolve(tool: ToolInfo): NativeMcpCapability | undefined {
    if (!isNativeMcpSource(tool.sourceInfo) || tool.exposure === "hidden") return undefined;
    const bindings = [...this.servers.values()].flatMap((server) => {
      const binding = server.bindings.get(tool.name);
      return binding ? [binding] : [];
    });
    if (bindings.length !== 1) return undefined;
    const binding = bindings[0]!;
    // The SDK callback and registered ToolInfo share the actual normalized schema.
    // Digest also detects a mutated schema while preserving an in-memory hot path.
    if (binding.parameters !== tool.parameters || binding.exposure !== tool.exposure
      || binding.capability.schemaDigest !== schemaDigest(tool.parameters)) return undefined;
    return binding.capability;
  }

  hasServer(name: string): boolean { return this.servers.has(name); }
}

export function isNativeMcpSource(source: SourceInfo): boolean {
  return source.source === "inline" && source.path === NATIVE_MCP_EXTENSION_PATH
    && source.scope === "temporary" && source.origin === "top-level";
}

export function isNativeToolSearchSource(source: SourceInfo): boolean {
  return source.source === "inline" && source.path === NATIVE_MCP_SEARCH_PATH
    && source.scope === "temporary" && source.origin === "top-level";
}

function signature(entry: McpServerEntry): string {
  return createHash("sha256").update(JSON.stringify([entry.name, entry.scope, entry.source, entry.config])).digest("hex");
}

function schemaDigest(parameters: ToolInfo["parameters"]): string {
  return createHash("sha256").update(JSON.stringify(parameters)).digest("hex");
}
