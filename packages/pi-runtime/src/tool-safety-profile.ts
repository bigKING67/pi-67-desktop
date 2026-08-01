import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, SourceInfo } from "@earendil-works/pi-coding-agent";
import type {
  ConfiguredCapabilityCatalog,
  ConfiguredMcpCapability
} from "./configured-capability-catalog.js";

const PI_WEB_ACCESS_VERSION = "0.17.0";
const PI_FFF_VERSION = "0.10.1";
const PI_MCP_ADAPTER_VERSIONS = ["2.10.0", "2.11.0"] as const;

const BUILTIN_TOOLS = new Set(["bash", "read", "write", "edit", "grep", "find", "ls"]);
const PI_WEB_ACCESS_TOOLS = new Set([
  "web_search",
  "source_check",
  "fetch_content",
  "get_search_content"
]);
const PI_FFF_GREP_TOOLS = new Set(["grep", "ffgrep"]);
const PI_FFF_FIND_TOOLS = new Set(["find", "fffind"]);

export type ToolSafetyProfile =
  | { kind: "builtin"; toolName: string; sourceLabel: "Pi 内置" }
  | { kind: "pi-web-access"; toolName: string; sourceLabel: "pi-web-access@0.17.0" }
  | {
      kind: "pi-mcp-adapter";
      toolName: "mcp";
      version: typeof PI_MCP_ADAPTER_VERSIONS[number];
      sourceLabel: `pi-mcp-adapter@${typeof PI_MCP_ADAPTER_VERSIONS[number]}`;
    }
  | {
      kind: "pi-fff";
      toolName: string;
      canonicalToolName: "grep" | "find";
      sourceLabel: "@ff-labs/pi-fff@0.10.1";
    }
  | {
      kind: "configured-package" | "managed-package";
      toolName: string;
      sourceLabel: string;
    }
  | {
      kind: "configured-mcp";
      toolName: string;
      serverName: string;
      remoteToolName: string;
      sourceLabel: string;
      schemaDigest: string;
    }
  | {
      kind: "unverified";
      toolName: string;
      sourceLabel: string;
      nonApprovableReason?: string;
    };

export function createToolSafetyProfileResolver(catalog?: ConfiguredCapabilityCatalog) {
  const manifestChecks = new Map<string, Promise<boolean>>();

  return async (pi: ExtensionAPI, toolName: string): Promise<ToolSafetyProfile> => {
    let matches: ReturnType<ExtensionAPI["getAllTools"]>;
    try {
      matches = pi.getAllTools().filter((tool) => tool.name === toolName);
    } catch {
      return {
        kind: "unverified",
        toolName,
        sourceLabel: "来源不可用",
        nonApprovableReason: "无法读取当前 Tool 目录；请重新加载 Pi 资源后重试。"
      };
    }
    if (matches.length !== 1) {
      return {
        kind: "unverified",
        toolName,
        sourceLabel: matches.length > 1 ? "多个同名 Tool 来源" : "来源不可用",
        nonApprovableReason: matches.length > 1
          ? "当前 Tool 存在多个同名来源，授权无法消除歧义；请移除重复来源并重新加载。"
          : "当前 Tool 未注册，授权无法使这次调用成功；请先检查可用 Tool 目录。"
      };
    }

    const source = matches[0]!.sourceInfo;
    if (isBuiltinIdentity(toolName, source)) {
      return { kind: "builtin", toolName, sourceLabel: "Pi 内置" };
    }
    if (
      PI_WEB_ACCESS_TOOLS.has(toolName)
      && await isVerifiedPackageIdentity(
        source,
        "pi-web-access",
        PI_WEB_ACCESS_VERSION,
        manifestChecks
      )
    ) {
      return { kind: "pi-web-access", toolName, sourceLabel: "pi-web-access@0.17.0" };
    }
    if (PI_WEB_ACCESS_TOOLS.has(toolName)) {
      return reservedIdentityMismatch(toolName, "pi-web-access");
    }
    if (toolName === "mcp") {
      const version = await resolveVerifiedPackageVersion(
        source,
        "pi-mcp-adapter",
        PI_MCP_ADAPTER_VERSIONS,
        manifestChecks
      );
      if (version) {
        return {
          kind: "pi-mcp-adapter",
          toolName,
          version,
          sourceLabel: `pi-mcp-adapter@${version}`
        };
      }
      return reservedIdentityMismatch(toolName, "pi-mcp-adapter");
    }
    if (
      (PI_FFF_GREP_TOOLS.has(toolName) || PI_FFF_FIND_TOOLS.has(toolName))
      && await isVerifiedPackageIdentity(
        source,
        "@ff-labs/pi-fff",
        PI_FFF_VERSION,
        manifestChecks
      )
    ) {
      return {
        kind: "pi-fff",
        toolName,
        canonicalToolName: PI_FFF_GREP_TOOLS.has(toolName) ? "grep" : "find",
        sourceLabel: "@ff-labs/pi-fff@0.10.1"
      };
    }
    if (PI_FFF_GREP_TOOLS.has(toolName) || PI_FFF_FIND_TOOLS.has(toolName)) {
      return reservedIdentityMismatch(toolName, "@ff-labs/pi-fff");
    }

    const directMcp = catalog?.resolveDirectMcpTool(toolName);
    if (directMcp?.kind === "configured-mcp") {
      const version = await resolveVerifiedPackageVersion(
        source,
        "pi-mcp-adapter",
        PI_MCP_ADAPTER_VERSIONS,
        manifestChecks
      );
      if (version) return configuredMcpProfile(toolName, directMcp);
    } else if (directMcp?.kind === "ambiguous") {
      const version = await resolveVerifiedPackageVersion(
        source,
        "pi-mcp-adapter",
        PI_MCP_ADAPTER_VERSIONS,
        manifestChecks
      );
      if (version) {
        return {
          kind: "unverified",
          toolName,
          sourceLabel: directMcp.sourceLabel,
          nonApprovableReason: "当前 MCP Direct Tool 对应多个 server，授权无法消除歧义；请改用 mcp 并显式指定 server。"
        };
      }
    }

    const configuredPackage = catalog?.resolvePackageSource(source);
    if (configuredPackage?.kind === "configured-package" || configuredPackage?.kind === "managed-package") {
      return { kind: configuredPackage.kind, toolName, sourceLabel: configuredPackage.sourceLabel };
    }
    if (configuredPackage?.kind === "ambiguous") {
      return {
        kind: "unverified",
        toolName,
        sourceLabel: configuredPackage.sourceLabel,
        nonApprovableReason: "当前 Tool 对应多个已配置 Package 来源，授权无法消除歧义；请移除重复来源并重新加载。"
      };
    }
    return { kind: "unverified", toolName, sourceLabel: packageSourceLabel(source) };
  };
}

function configuredMcpProfile(
  toolName: string,
  capability: ConfiguredMcpCapability
): Extract<ToolSafetyProfile, { kind: "configured-mcp" }> {
  return {
    kind: "configured-mcp",
    toolName,
    serverName: capability.serverName,
    remoteToolName: capability.toolName,
    sourceLabel: capability.sourceLabel,
    schemaDigest: capability.schemaDigest
  };
}

function reservedIdentityMismatch(toolName: string, expectedPackage: string): ToolSafetyProfile {
  return {
    kind: "unverified",
    toolName,
    sourceLabel: "保留 Tool 身份不匹配",
    nonApprovableReason: `Tool \`${toolName}\` 未通过 ${expectedPackage} 的 Desktop 身份校验；请检查 Package 版本和重复来源。`
  };
}

async function resolveVerifiedPackageVersion<TVersion extends string>(
  source: SourceInfo,
  packageName: string,
  versions: readonly TVersion[],
  manifestChecks: Map<string, Promise<boolean>>
): Promise<TVersion | undefined> {
  for (const version of versions) {
    if (await isVerifiedPackageIdentity(source, packageName, version, manifestChecks)) return version;
  }
  return undefined;
}

function isBuiltinIdentity(toolName: string, source: SourceInfo): boolean {
  return BUILTIN_TOOLS.has(toolName)
    && source.source === "builtin"
    && source.path === `<builtin:${toolName}>`
    && source.scope === "temporary"
    && source.origin === "top-level";
}

async function isVerifiedPackageIdentity(
  source: SourceInfo,
  packageName: string,
  version: string,
  manifestChecks: Map<string, Promise<boolean>>
): Promise<boolean> {
  if (source.origin !== "package") return false;
  const unversioned = `npm:${packageName}`;
  const exact = `${unversioned}@${version}`;
  if (source.source === exact) return true;
  if (source.source !== unversioned) return false;

  const candidates = [source.baseDir, source.path]
    .filter((value): value is string => typeof value === "string" && isAbsolute(value));
  const cacheKey = JSON.stringify([packageName, version, ...candidates]);
  const cached = manifestChecks.get(cacheKey);
  if (cached) return cached;
  const check = candidates.some((candidate) => candidate !== "")
    ? verifyNearestManifest(candidates, packageName, version)
    : Promise.resolve(false);
  manifestChecks.set(cacheKey, check);
  return check;
}

async function verifyNearestManifest(
  candidates: readonly string[],
  packageName: string,
  version: string
): Promise<boolean> {
  for (const candidate of candidates) {
    let cursor = candidate;
    try {
      if (!(await stat(cursor)).isDirectory()) cursor = dirname(cursor);
    } catch {
      cursor = dirname(cursor);
    }
    for (let depth = 0; depth < 12; depth += 1) {
      try {
        const manifest = JSON.parse(await readFile(join(cursor, "package.json"), "utf8")) as {
          name?: unknown;
          version?: unknown;
        };
        if (manifest.name === packageName) return manifest.version === version;
      } catch {
        // Continue toward the filesystem root when this directory has no readable manifest.
      }
      const parent = resolve(cursor, "..");
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return false;
}

function packageSourceLabel(source: SourceInfo): string {
  if (source.origin === "package" && source.source.startsWith("npm:")) {
    const label = source.source.slice(4);
    return /^[a-z0-9@/._-]+(?:@[a-z0-9._-]+)?$/iu.test(label) ? label : "未验证的 Package";
  }
  return source.origin === "package" ? "未验证的 Package" : "未配置的直接 Extension";
}
