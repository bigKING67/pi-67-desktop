import type { ApprovalTargetKind, RiskCategory, ToolIntent } from "@pi67/domain";
import type { ConfiguredCapabilityCatalog } from "./configured-capability-catalog.js";
import { classifyConfiguredToolIntent } from "./configured-tool-safety.js";
import type { LoadedResourceReadAccess } from "./loaded-resource-read-access.js";
import type { ToolSafetyProfile } from "./tool-safety-profile.js";

const MCP_METADATA_QUERY_MAX_CHARS = 512;
const MCP_REGEX_QUERY_MAX_CHARS = 256;
const MCP_IDENTIFIER_MAX_CHARS = 256;
const MCP_ARGS_MAX_CHARS = 64_000;

export interface PiMcpAdapterToolIntent extends ToolIntent {
  targetKind: ApprovalTargetKind;
  sourceLabel: string;
  nonApprovableReason?: string;
}

interface PiMcpAdapterClassificationOptions {
  catalog: ConfiguredCapabilityCatalog;
  workspace: string;
  loadedResourceReadAccess?: LoadedResourceReadAccess;
  isDirectTool?: (toolName: string) => boolean;
}

export async function classifyPiMcpAdapterIntent(
  profile: Extract<ToolSafetyProfile, { kind: "pi-mcp-adapter" }>,
  input: unknown,
  options: PiMcpAdapterClassificationOptions
): Promise<PiMcpAdapterToolIntent> {
  if (!isRecordInput(input)) return invalidIntent(profile, "MCP 调用参数必须是对象；授权无法修复参数格式。");
  if (Object.keys(input).length === 0) {
    return capabilityReadIntent(profile, "MCP 工具状态");
  }

  const server = boundedStringField(input, "server", MCP_IDENTIFIER_MAX_CHARS);
  if (hasOnlyKeys(input, ["server"]) && server) {
    return capabilityReadIntent(profile, server);
  }
  if (hasVerifiedMcpSearchContract(input)) {
    return capabilityReadIntent(profile, stringField(input, "search")!);
  }

  const describedTool = boundedStringField(input, "describe", MCP_IDENTIFIER_MAX_CHARS);
  if (hasOnlyKeys(input, ["describe"]) && describedTool) {
    return capabilityReadIntent(profile, describedTool);
  }
  if (hasOnlyKeys(input, ["action"]) && input.action === "ui-messages") {
    return capabilityReadIntent(profile, "MCP UI 消息");
  }

  const connect = boundedStringField(input, "connect", MCP_IDENTIFIER_MAX_CHARS);
  if (hasOnlyKeys(input, ["connect"]) && connect) {
    const configured = options.catalog.resolveMcpServer(connect);
    if (configured.kind !== "configured-mcp") {
      return invalidIntent(profile, `MCP server \`${connect}\` 不在当前有效配置中；授权无法创建或修复 server 配置。`);
    }
    return intent(profile, "configured-operation", connect, configured.sourceLabel);
  }

  const nestedTool = boundedStringField(input, "tool", MCP_IDENTIFIER_MAX_CHARS);
  if (nestedTool && hasOnlyKeys(input, ["tool", "args", "server"])) {
    const args = parseMcpArgs(input.args);
    if (!args) return invalidIntent(profile, "MCP Tool 的 args 必须是对象或可解析为对象的 JSON；授权无法修复参数格式。");
    const configured = options.catalog.resolveMcpTool(nestedTool, server);
    if (configured.kind === "ambiguous") {
      return invalidIntent(
        profile,
        `MCP Tool \`${nestedTool}\` 在多个已配置 server 中同名；请补充 server 后重试。`
      );
    }
    if (configured.kind !== "configured-mcp") {
      if (server === undefined && options.isDirectTool?.(nestedTool)) {
        return invalidIntent(
          profile,
          `\`${nestedTool}\` 是当前 Pi 的直接 Tool；不要通过 mcp 调用，请直接调用 \`${nestedTool}\`。`
        );
      }
      const location = server === undefined ? "当前已配置 MCP 目录" : `已配置 server \`${server}\``;
      return invalidIntent(
        profile,
        `${location} 中未找到 Tool \`${nestedTool}\`；授权无法使未注册的 Tool 生效。`
      );
    }
    return classifyConfiguredToolIntent({
      toolName: profile.toolName,
      input: args,
      workspace: options.workspace,
      sourceLabel: configured.sourceLabel,
      serverName: configured.serverName,
      remoteToolName: configured.toolName,
      ...(options.loadedResourceReadAccess === undefined
        ? {}
        : { loadedResourceReadAccess: options.loadedResourceReadAccess })
    });
  }

  const action = boundedStringField(input, "action", MCP_IDENTIFIER_MAX_CHARS);
  if (action === "auth-start" || action === "auth-complete") {
    if (!server) return invalidIntent(profile, `${action} 必须显式指定已配置的 MCP server。`);
    const configured = options.catalog.resolveMcpServer(server);
    if (configured.kind !== "configured-mcp") {
      return invalidIntent(profile, `MCP server \`${server}\` 不在当前有效配置中；授权无法创建授权目标。`);
    }
    return intent(profile, "credential-or-auth", `${action}: ${server}`, configured.sourceLabel);
  }

  return invalidIntent(profile, "当前 mcp 调用不符合已验证的 Desktop 参数契约；请先修正调用格式。");
}

function capabilityReadIntent(
  profile: Extract<ToolSafetyProfile, { kind: "pi-mcp-adapter" }>,
  target: string
): PiMcpAdapterToolIntent {
  return intent(profile, "capability-read", target, profile.sourceLabel);
}

function invalidIntent(
  profile: Extract<ToolSafetyProfile, { kind: "pi-mcp-adapter" }>,
  nonApprovableReason: string
): PiMcpAdapterToolIntent {
  return {
    ...intent(profile, "unverified-tool", profile.toolName, profile.sourceLabel),
    nonApprovableReason
  };
}

function intent(
  profile: Extract<ToolSafetyProfile, { kind: "pi-mcp-adapter" }>,
  category: RiskCategory,
  target: string,
  sourceLabel: string
): PiMcpAdapterToolIntent {
  return {
    toolName: profile.toolName,
    category,
    target,
    targetKind: "tool",
    sourceLabel
  };
}

function parseMcpArgs(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return {};
  if (isRecordInput(value)) return value;
  if (typeof value !== "string" || value.length > MCP_ARGS_MAX_CHARS) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecordInput(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function hasVerifiedMcpSearchContract(record: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(record, ["search", "regex", "includeSchemas", "server"])) return false;
  const regex = record.regex;
  const includeSchemas = record.includeSchemas;
  if (regex !== undefined && typeof regex !== "boolean") return false;
  if (includeSchemas !== undefined && typeof includeSchemas !== "boolean") return false;
  if (
    record.server !== undefined
    && boundedStringField(record, "server", MCP_IDENTIFIER_MAX_CHARS) === undefined
  ) return false;
  const maxChars = regex === true ? MCP_REGEX_QUERY_MAX_CHARS : MCP_METADATA_QUERY_MAX_CHARS;
  return boundedStringField(record, "search", maxChars) !== undefined;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

function isRecordInput(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedStringField(
  record: Record<string, unknown>,
  key: string,
  maxChars: number
): string | undefined {
  const value = stringField(record, key);
  return value !== undefined && value.length <= maxChars ? value : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
