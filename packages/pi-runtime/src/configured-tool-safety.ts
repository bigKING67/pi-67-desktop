import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
  ApprovalTargetKind,
  RiskCategory,
  ToolIntent
} from "@pi67/domain";
import type { LoadedResourceReadAccess } from "./loaded-resource-read-access.js";
import { canonicalizePotentialPath, isContained } from "./path-policy.js";

const PATH_FIELDS = [
  "path",
  "filePath",
  "file_path",
  "directory",
  "download_dir",
  "outputPath",
  "output_path",
  "cwd"
] as const;

const NETWORK_READ_TOOLS = new Set([
  "web_search",
  "source_check",
  "fetch_content",
  "get_search_content",
  "web_fetch",
  "batch_web_fetch",
  "tavily_search",
  "tavily_extract",
  "tavily_crawl",
  "tavily_map",
  "tavily_research",
  "brave_web_search",
  "brave_local_search"
]);

const MEMORY_READ_TOOLS = new Set([
  "memory_route",
  "list_spaces",
  "request_status",
  "recall",
  "briefing",
  "memory_candidates",
  "fetch_history",
  "memory_eval",
  "memory_audit",
  "memory_healthcheck",
  "memory_export"
]);

const MEMORY_WRITE_TOOLS = new Set([
  "add",
  "remember",
  "flush",
  "propose_memory",
  "learn"
]);

const MEMORY_DELETE_PATTERN = /(?:^|[_-])(?:forget|delete|purge)(?:[_-]|$)|^drop_(?:observations|reflections|memory)$/iu;
const CREDENTIAL_TOOL_PATTERN = /(?:^|[_-])(?:auth|oauth|credential|credentials|login|sign_in)(?:[_-]|$)/iu;
const EXTERNAL_SUBMIT_TOOL_PATTERN = /(?:^|[_-])(?:upload|publish|send|submit)(?:[_-]|$)/iu;
const DEPENDENCY_TOOL_PATTERN = /(?:^|[_-])(?:install|uninstall|upgrade|update_dependency|remove_dependency)(?:[_-]|$)/iu;
const SYSTEM_TOOL_PATTERN = /(?:^|[_-])(?:system_config|system_configuration|registry|service_config)(?:[_-]|$)/iu;
const FILE_DELETE_TOOL_PATTERN = /(?:^|[_-])(?:delete_file|delete_files|remove_file|remove_files|delete_directory|remove_directory)(?:[_-]|$)/iu;

export interface ConfiguredToolIntent extends ToolIntent {
  targetKind: ApprovalTargetKind;
  sourceLabel: string;
}

interface ConfiguredToolIntentOptions {
  toolName: string;
  input: Record<string, unknown>;
  workspace: string;
  sourceLabel: string;
  loadedResourceReadAccess?: LoadedResourceReadAccess;
  serverName?: string;
  remoteToolName?: string;
}

export async function classifyConfiguredToolIntent(
  options: ConfiguredToolIntentOptions
): Promise<ConfiguredToolIntent> {
  const effectiveToolName = options.remoteToolName ?? options.toolName;
  const effect = classifyConfiguredEffect(effectiveToolName, options.input, options.serverName);
  const pathIntent = await classifyConfiguredPathEffect(options, effect);
  if (pathIntent) return pathIntent;
  return {
    toolName: options.toolName,
    category: effect,
    target: safeEffectTarget(effectiveToolName, options.input),
    targetKind: "tool",
    sourceLabel: options.sourceLabel
  };
}

function classifyConfiguredEffect(
  toolName: string,
  input: Record<string, unknown>,
  serverName?: string
): RiskCategory {
  if (serverName === "agent_memory") return classifyMemoryEffect(toolName);
  if (serverName === "tmwd_browser") return classifyBrowserEffect(toolName, input);
  if (serverName === "js-reverse") return "configured-operation";
  if (serverName === "tavily-bridge") return "network-read";
  if (NETWORK_READ_TOOLS.has(toolName)) return "network-read";
  if (MEMORY_READ_TOOLS.has(toolName)) return "capability-read";
  if (MEMORY_WRITE_TOOLS.has(toolName)) return "persistent-state-write";
  if (MEMORY_DELETE_PATTERN.test(toolName)) return "persistent-state-delete";
  if (CREDENTIAL_TOOL_PATTERN.test(toolName)) return "credential-or-auth";
  if (EXTERNAL_SUBMIT_TOOL_PATTERN.test(toolName)) return "external-submit";
  if (DEPENDENCY_TOOL_PATTERN.test(toolName)) return "dependency-change";
  if (SYSTEM_TOOL_PATTERN.test(toolName)) return "system-configuration";
  if (FILE_DELETE_TOOL_PATTERN.test(toolName)) return "bulk-delete";
  return "configured-operation";
}

function classifyMemoryEffect(toolName: string): RiskCategory {
  if (MEMORY_DELETE_PATTERN.test(toolName)) return "persistent-state-delete";
  if (MEMORY_WRITE_TOOLS.has(toolName)) return "persistent-state-write";
  return "capability-read";
}

function classifyBrowserEffect(toolName: string, input: Record<string, unknown>): RiskCategory {
  if (toolName === "browser_execute_js" || toolName === "browser_native_input") {
    return "external-submit";
  }
  if (toolName === "browser_auth_ops") return "credential-or-auth";
  if (toolName === "browser_clipboard_ops") return "external-submit";
  if (toolName === "browser_file_ops") {
    return input.action === "inspect_inputs" ? "configured-operation" : "external-submit";
  }
  return "configured-operation";
}

async function classifyConfiguredPathEffect(
  options: ConfiguredToolIntentOptions,
  effect: RiskCategory
): Promise<ConfiguredToolIntent | undefined> {
  for (const rawPath of configuredPaths(options.input)) {
    const expandedPath = rawPath === "~"
      ? homedir()
      : rawPath.startsWith("~/") ? resolve(homedir(), rawPath.slice(2)) : rawPath;
    const canonical = await canonicalizePotentialPath(expandedPath, options.workspace);
    const canonicalWorkspace = await realpath(resolve(options.workspace));
    if (isContained(canonical, canonicalWorkspace)) continue;
    if (
      isReadEffect(effect)
      && options.loadedResourceReadAccess?.allows("read", canonical)
    ) continue;
    return {
      toolName: options.toolName,
      category: "external-path",
      target: canonical,
      targetKind: "path",
      sourceLabel: options.sourceLabel
    };
  }
  return undefined;
}

function configuredPaths(input: Record<string, unknown>): string[] {
  const paths = PATH_FIELDS.flatMap((field) => {
    const value = input[field];
    return typeof value === "string" && value.trim() !== "" ? [value] : [];
  });
  if (Array.isArray(input.files)) {
    for (const value of input.files) {
      if (typeof value === "string" && value.trim() !== "") paths.push(value);
    }
  }
  return paths;
}

function isReadEffect(effect: RiskCategory): boolean {
  return effect === "workspace-read"
    || effect === "resource-read"
    || effect === "capability-read"
    || effect === "network-read";
}

function safeEffectTarget(toolName: string, input: Record<string, unknown>): string {
  for (const key of ["action", "op", "mode"] as const) {
    const value = input[key];
    if (typeof value === "string" && /^[a-z0-9._:-]{1,128}$/iu.test(value)) {
      return `${toolName}: ${value}`;
    }
  }
  return toolName;
}
