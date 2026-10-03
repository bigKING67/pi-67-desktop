import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, SourceInfo } from "@earendil-works/pi-coding-agent";
import type {
  ConfiguredCapabilityCatalog
} from "./configured-capability-catalog.js";

import { isNativeMcpSource, isNativeToolSearchSource, type NativeMcpCapability } from "./native-mcp-catalog.js";

const PI_WEB_ACCESS_VERSION = "0.17.0";
const PI_FFF_VERSION = "0.10.1";


const BUILTIN_TOOLS = new Set(["bash", "read", "write", "edit", "grep", "find", "ls"]);
const PI_WEB_ACCESS_TOOLS = new Set([
  "web_search",
  "source_check",
  "fetch_content",
  "get_search_content"
]);
const PI67_PLAN_TOOLS = new Set(["plan_ask", "plan_complete"]);
const PI67_SHARED_EXPERIENCE_TOOLS = new Set([
  "viking_team_search", "viking_team_read",
  "viking_shared_search",
  "viking_shared_read",
  "viking_sop_search",
  "viking_sop_read"
]);
const PI_FFF_GREP_TOOLS = new Set(["grep", "ffgrep"]);
const PI_FFF_FIND_TOOLS = new Set(["find", "fffind"]);

export type ToolSafetyProfile =
  | { kind: "builtin"; toolName: string; sourceLabel: "Pi 内置" }
  | { kind: "pi67-web"; toolName: string; sourceLabel: "Pi-67 原生搜索" }
  | { kind: "pi67-plan"; toolName: string; sourceLabel: "Pi-67 原生计划" }
  | { kind: "pi67-context"; toolName: string; sourceLabel: "Pi-67 企业知识" }
  | { kind: "pi-web-access"; toolName: string; sourceLabel: "pi-web-access@0.17.0" }
  | { kind: "native-mcp-read"; toolName: string; sourceLabel: string }
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
    if (PI_WEB_ACCESS_TOOLS.has(toolName) && isFirstPartyWebIdentity(toolName, source)) {
      return { kind: "pi67-web", toolName, sourceLabel: "Pi-67 原生搜索" };
    }
    if (PI67_PLAN_TOOLS.has(toolName) && isFirstPartySdkIdentity(toolName, source)) {
      return { kind: "pi67-plan", toolName, sourceLabel: "Pi-67 原生计划" };
    }
    if (PI67_PLAN_TOOLS.has(toolName)) {
      return reservedIdentityMismatch(toolName, "Pi-67 native Plan Mode");
    }
    if (
      PI67_SHARED_EXPERIENCE_TOOLS.has(toolName)
      && isFirstPartySdkIdentity(toolName, source)
    ) {
      return { kind: "pi67-context", toolName, sourceLabel: "Pi-67 企业知识" };
    }
    if (PI67_SHARED_EXPERIENCE_TOOLS.has(toolName)) {
      return reservedIdentityMismatch(toolName, "Pi-67 enterprise Experience");
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
    if (toolName === "mcp") return reservedIdentityMismatch(toolName, "Pi 原生 MCP（旧代理已下线）");
    if (toolName === "tool_search") {
      return isNativeToolSearchSource(source)
        ? { kind: "native-mcp-read", toolName, sourceLabel: "Pi 原生工具发现" }
        : reservedIdentityMismatch(toolName, "Pi 原生工具发现");
    }
    if (["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"].includes(toolName)) {
      return isNativeMcpSource(source)
        ? { kind: "native-mcp-read", toolName, sourceLabel: "Pi 原生 MCP 资源" }
        : reservedIdentityMismatch(toolName, "Pi 原生 MCP 资源");
    }
    if (toolName.startsWith("mcp__") || isNativeMcpSource(source)) {
      const native = catalog?.nativeMcp.resolve(matches[0]!);
      return native ? configuredMcpProfile(toolName, native)
        : reservedIdentityMismatch(toolName, "当前 Session 的原生 MCP 绑定");
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
  capability: NativeMcpCapability
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

function isBuiltinIdentity(toolName: string, source: SourceInfo): boolean {
  return BUILTIN_TOOLS.has(toolName)
    && source.source === "builtin"
    && source.path === `builtin:${toolName}`
    && source.scope === "temporary"
    && source.origin === "top-level";
}

function isFirstPartyWebIdentity(toolName: string, source: SourceInfo): boolean {
  return isFirstPartySdkIdentity(toolName, source);
}

function isFirstPartySdkIdentity(toolName: string, source: SourceInfo): boolean {
  return source.source === "sdk"
    && source.path === `<sdk:${toolName}>`
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
