import type {
  AgentSession,
  ExtensionAPI,
  InlineExtension,
  ToolDefinition
} from "@earendil-works/pi-coding-agent";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
  inputRecord,
  mapBashInput,
  mapEditInput,
  mapFindInput,
  mapGrepInput,
  mapReadInput,
  mapWebFetchInput,
  mapWebSearchInput,
  mapWriteInput,
  optionalString,
  recordOrEmpty
} from "./tool-alias-input.js";

export const DESKTOP_TOOL_ROUTING_EXTENSION_PATH = "<inline:pi67-desktop-tool-routing>";

const PI_WEB_ACCESS_SOURCE_PATTERN = /^npm:pi-web-access(?:@|$)/u;
const MAX_TOOL_NAME_CHARS = 128;

type ToolInfo = ReturnType<AgentSession["getAllTools"]>[number];
export type CanonicalToolName = "bash" | "read" | "edit" | "write" | "grep" | "find" | "web_search" | "fetch_content";

interface DesktopToolAliasSpec {
  alias: string;
  canonical: CanonicalToolName;
  executionMode: "parallel" | "sequential";
  mapInput: (input: unknown) => Record<string, unknown>;
}

const EXECUTABLE_TOOL_ALIASES: readonly DesktopToolAliasSpec[] = [
  { alias: "Bash", canonical: "bash", executionMode: "sequential", mapInput: mapBashInput },
  { alias: "Read", canonical: "read", executionMode: "parallel", mapInput: mapReadInput },
  { alias: "Edit", canonical: "edit", executionMode: "sequential", mapInput: mapEditInput },
  { alias: "Write", canonical: "write", executionMode: "sequential", mapInput: mapWriteInput },
  { alias: "Grep", canonical: "grep", executionMode: "parallel", mapInput: mapGrepInput },
  { alias: "Glob", canonical: "find", executionMode: "parallel", mapInput: mapFindInput },
  { alias: "WebSearch", canonical: "web_search", executionMode: "parallel", mapInput: mapWebSearchInput },
  { alias: "WebFetch", canonical: "fetch_content", executionMode: "parallel", mapInput: mapWebFetchInput },
  { alias: "web_fetch", canonical: "fetch_content", executionMode: "parallel", mapInput: mapWebFetchInput }
];

const RECOVERY_ALIASES = new Map<string, string>([
  ...EXECUTABLE_TOOL_ALIASES.map((spec) => [spec.alias, spec.canonical] as const),
  ["Agent", "subagent"]
]);

export interface DesktopToolAliasBinding {
  tools: ToolDefinition[];
  bind(session: AgentSession): void;
  reconcile(): void;
}

export interface DesktopToolAliasCall {
  alias: string;
  canonical: CanonicalToolName;
  input: Record<string, unknown>;
}

export function createDesktopToolAliasBinding(): DesktopToolAliasBinding {
  let session: AgentSession | undefined;
  const tools = EXECUTABLE_TOOL_ALIASES.map((spec) => createAliasTool(spec, () => session));

  return {
    tools,
    bind(nextSession) {
      session = nextSession;
      reconcileDesktopToolAliases(nextSession);
    },
    reconcile() {
      if (session) reconcileDesktopToolAliases(session);
    }
  };
}

export function resolveDesktopToolAliasCall(toolName: string, input: unknown): DesktopToolAliasCall | undefined {
  const spec = EXECUTABLE_TOOL_ALIASES.find((candidate) => candidate.alias === toolName);
  if (!spec) return undefined;
  return { alias: spec.alias, canonical: spec.canonical, input: inputRecord(input) };
}

export function desktopToolAliasTarget(toolName: string): CanonicalToolName | undefined {
  return EXECUTABLE_TOOL_ALIASES.find((candidate) => candidate.alias === toolName)?.canonical;
}

export function isVerifiedDesktopToolAlias(
  alias: string,
  canonical: CanonicalToolName,
  tools: readonly ToolInfo[],
  activeToolNames?: ReadonlySet<string>
): boolean {
  const aliasInfo = uniqueToolInfo(tools, alias);
  const canonicalInfo = uniqueToolInfo(tools, canonical);
  if (!aliasInfo || !canonicalInfo) return false;
  if (
    aliasInfo.sourceInfo.source !== "sdk"
    || aliasInfo.sourceInfo.path !== `<sdk:${alias}>`
    || aliasInfo.sourceInfo.scope !== "temporary"
    || aliasInfo.sourceInfo.origin !== "top-level"
  ) return false;
  if (activeToolNames && (!activeToolNames.has(alias) || !activeToolNames.has(canonical))) return false;
  return isExpectedCanonicalSource(canonical, canonicalInfo);
}

export function createDesktopToolRoutingExtension(): InlineExtension {
  return {
    name: "pi67-desktop-tool-routing",
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      const webSearchCalls = new Map<string, { automaticProvider: boolean }>();
      let searchRoutingExhausted = false;
      let recoveryFetchStarted = false;

      pi.on("before_agent_start", (event) => {
        webSearchCalls.clear();
        searchRoutingExhausted = false;
        recoveryFetchStarted = false;
        const activeTools = getActiveToolNames(pi);
        const guidance = createToolRoutingGuidance(pi, activeTools);
        return guidance ? { systemPrompt: `${event.systemPrompt}\n\n${guidance}` } : undefined;
      });

      pi.on("tool_call", (event) => {
        if (searchRoutingExhausted && isCredentialConfigRead(event.toolName, event.input)) {
          return {
            block: true,
            reason: "自动搜索路由已耗尽；不要读取可能包含凭据的 web-search.json。请说明需要配置搜索 Provider。"
          };
        }
        if (searchRoutingExhausted && isVerifiedWebFetchCall(pi, event.toolName)) {
          if (recoveryFetchStarted) {
            return {
              block: true,
              reason: "自动搜索路由已耗尽，本轮已尝试一次已知 URL 抓取；不要继续变换 URL 或重复抓取。"
            };
          }
          recoveryFetchStarted = true;
          return undefined;
        }
        if (!isVerifiedWebSearchCall(pi, event.toolName)) return undefined;
        if (searchRoutingExhausted) {
          return {
            block: true,
            reason: "自动搜索已经检查并耗尽当前可用 Provider；不要逐个试探未配置 Provider。已知准确 URL 时使用一次 fetch_content，否则请说明需要配置搜索 Provider。"
          };
        }
        const input = recordOrEmpty(event.input);
        const provider = optionalString(input, "provider");
        webSearchCalls.set(event.toolCallId, {
          automaticProvider: provider === undefined || provider.toLocaleLowerCase("en-US") === "auto"
        });
        return undefined;
      });

      pi.on("message_end", (event) => {
        const message = event.message;
        if (message.role === "toolResult") {
          const searchCall = webSearchCalls.get(message.toolCallId);
          webSearchCalls.delete(message.toolCallId);
          if (searchCall) {
            const normalizedFailure = normalizeWebSearchFailure(message.content, searchCall.automaticProvider);
            if (normalizedFailure) {
              if (searchCall.automaticProvider && isProviderRoutingFailure(message.content)) {
                searchRoutingExhausted = true;
              }
              return {
                message: {
                  ...message,
                  content: normalizedFailure,
                  isError: true
                }
              };
            }
          }
        }
        if (
          message.role !== "toolResult"
          || message.isError !== true
          || !isMissingToolResult(message.content)
        ) return undefined;

        const activeTools = getActiveToolNames(pi);
        if (activeTools.has(message.toolName)) return undefined;
        return {
          message: {
            ...message,
            content: [{
              type: "text",
              text: createMissingToolRecovery(message.toolName, activeTools)
            }]
          }
        };
      });

      pi.on("agent_end", () => {
        webSearchCalls.clear();
        searchRoutingExhausted = false;
        recoveryFetchStarted = false;
      });
      pi.on("session_shutdown", () => {
        webSearchCalls.clear();
        searchRoutingExhausted = false;
        recoveryFetchStarted = false;
      });
    }
  };
}

function createAliasTool(
  spec: DesktopToolAliasSpec,
  getSession: () => AgentSession | undefined
): ToolDefinition {
  return {
    name: spec.alias,
    label: `${spec.alias} compatibility alias`,
    description: `Desktop compatibility alias for the native Pi ${spec.canonical} tool.`,
    parameters: {
      type: "object",
      additionalProperties: true
    } as ToolDefinition["parameters"],
    executionMode: spec.executionMode,
    prepareArguments: (input) => spec.mapInput(input),
    async execute(toolCallId, input, signal, onUpdate, context) {
      const currentSession = getSession();
      if (!currentSession) throw new Error(`Desktop tool alias ${spec.alias} is not bound to a Pi session.`);
      const activeToolNames = new Set(currentSession.getActiveToolNames());
      if (!isVerifiedDesktopToolAlias(spec.alias, spec.canonical, currentSession.getAllTools(), activeToolNames)) {
        throw new Error(`Desktop tool alias ${spec.alias} cannot verify its native Pi target ${spec.canonical}.`);
      }
      const canonical = currentSession.getToolDefinition(spec.canonical);
      if (!canonical) throw new Error(`Native Pi tool ${spec.canonical} is unavailable.`);
      const canonicalInput = canonical.prepareArguments?.(input) ?? input;
      return canonical.execute(toolCallId, canonicalInput, signal, onUpdate, context);
    }
  };
}

function reconcileDesktopToolAliases(session: AgentSession): void {
  const tools = session.getAllTools();
  const active = session.getActiveToolNames();
  const activeSet = new Set(active);
  const supportedAliases = new Set(EXECUTABLE_TOOL_ALIASES.flatMap((spec) => (
    isVerifiedDesktopToolAlias(spec.alias, spec.canonical, tools)
    && activeSet.has(spec.canonical)
      ? [spec.alias]
      : []
  )));
  const next = active.filter((name) => (
    !EXECUTABLE_TOOL_ALIASES.some((spec) => spec.alias === name)
    || supportedAliases.has(name)
  ));
  if (next.length !== active.length || next.some((name, index) => name !== active[index])) {
    session.setActiveToolsByName(next);
  }
}

function createToolRoutingGuidance(
  pi: ExtensionAPI,
  activeTools: ReadonlySet<string>
): string | undefined {
  const aliases = EXECUTABLE_TOOL_ALIASES.filter((spec) => (
    activeTools.has(spec.alias) && activeTools.has(spec.canonical)
  ));
  const piFffGuidance = createPiFffNamingGuidance(pi, activeTools);
  if (aliases.length === 0 && piFffGuidance === undefined) return undefined;
  const mappings = aliases.map((spec) => `\`${spec.alias}\`→\`${spec.canonical}\``).join(", ");
  return [
    "## Pi Desktop tool compatibility",
    aliases.length > 0
      ? `Prefer native Pi tool names and schemas. Desktop also accepts these deterministic aliases: ${mappings}.`
      : undefined,
    piFffGuidance,
    activeTools.has("WebSearch")
      ? "For current web lookups, prefer `web_search`; the `WebSearch` alias is forwarded to it with `workflow: \"none\"` by default. One automatic `web_search` call already checks the configured and available providers. If it reports that routing is exhausted or a provider is unconfigured, do not probe Brave, Tavily, OpenAI, SearXNG, or other named providers one by one, and do not inspect web-search.json because it may contain credentials. Use one batched `fetch_content` call only when exact URLs are already known; otherwise explain the missing search configuration."
      : undefined
  ].filter((line): line is string => line !== undefined).join("\n");
}

function createPiFffNamingGuidance(
  pi: ExtensionAPI,
  activeTools: ReadonlySet<string>
): string | undefined {
  let tools: ReturnType<ExtensionAPI["getAllTools"]>;
  try {
    tools = pi.getAllTools();
  } catch {
    return undefined;
  }
  const hasPiFffTool = (name: string) => {
    if (!activeTools.has(name)) return false;
    const matches = tools.filter((tool) => tool.name === name);
    if (matches.length !== 1) return false;
    const source = matches[0]!.sourceInfo;
    return source.origin === "package"
      && /^npm:@ff-labs\/pi-fff(?:@0\.10\.1)?$/u.test(source.source);
  };
  if (hasPiFffTool("find") && hasPiFffTool("grep")) {
    return "`@ff-labs/pi-fff` is active in override naming mode: the live `find` and `grep` tools are FFF-backed, not Pi built-ins. Call these exact live tools directly; never look them up or invoke them through `mcp`. When asked to use pi-fff, explain the override; do not describe them as native fallbacks or claim pi-fff is unavailable.";
  }
  if (hasPiFffTool("fffind") && hasPiFffTool("ffgrep")) {
    return "`@ff-labs/pi-fff` is active with its explicit live names `fffind` and `ffgrep`. Call those exact live tools directly, never through `mcp`, when the task requests pi-fff.";
  }
  return undefined;
}

function isVerifiedWebSearchCall(pi: ExtensionAPI, toolName: string): boolean {
  if (toolName === "web_search") {
    const tool = uniqueToolInfo(pi.getAllTools(), "web_search");
    return tool !== undefined && isExpectedCanonicalSource("web_search", tool);
  }
  return toolName === "WebSearch"
    && isVerifiedDesktopToolAlias(
      "WebSearch",
      "web_search",
      pi.getAllTools(),
      getActiveToolNames(pi)
    );
}

function isVerifiedWebFetchCall(pi: ExtensionAPI, toolName: string): boolean {
  if (toolName === "fetch_content") {
    const tool = uniqueToolInfo(pi.getAllTools(), "fetch_content");
    return tool !== undefined && isExpectedCanonicalSource("fetch_content", tool);
  }
  return desktopToolAliasTarget(toolName) === "fetch_content"
    && isVerifiedDesktopToolAlias(
      toolName,
      "fetch_content",
      pi.getAllTools(),
      getActiveToolNames(pi)
    );
}

function isCredentialConfigRead(toolName: string, input: unknown): boolean {
  if (toolName !== "read" && toolName !== "Read") return false;
  const record = recordOrEmpty(input);
  const path = optionalString(record, "path") ?? optionalString(record, "file_path");
  return path !== undefined && /(?:^|[/\\])\.pi[/\\]web-search\.json$/u.test(path);
}

function isProviderRoutingFailure(content: ToolResultMessage["content"]): boolean {
  return content.some((part) => part.type === "text" && (
    /Auto provider search failed/iu.test(part.text)
    || /No search provider available/iu.test(part.text)
    || /Configured search routing exhausted/iu.test(part.text)
  ));
}

function normalizeWebSearchFailure(
  content: ToolResultMessage["content"],
  automaticProvider: boolean
): ToolResultMessage["content"] | undefined {
  const firstTextIndex = content.findIndex((part) => part.type === "text");
  if (firstTextIndex < 0) return undefined;
  const first = content[firstTextIndex];
  const text = first?.type === "text" ? first.text : undefined;
  if (!text || !/^Error:\s/iu.test(text)) return undefined;
  const providerFailure = /(?:provider search failed|provider available|API key not found|web search unavailable|base URL is invalid|rate limit|routing exhausted)/iu.test(text);
  const recovery = providerFailure
    ? automaticProvider
      ? "Pi Desktop：自动搜索已经检查了当前可用 Provider。不要再逐个试探未配置的 Provider；已知准确 URL 时只调用一次 fetch_content，否则请说明需要配置搜索 Provider。"
      : "Pi Desktop：指定的搜索 Provider 当前不可用。不要继续轮询其他未配置 Provider；已知准确 URL 时只调用一次 fetch_content，否则请说明需要配置搜索 Provider。"
    : "Pi Desktop：本次网页搜索调用失败。请根据错误修正参数，不要原样重复调用。";
  return content.map((part, index) => index === firstTextIndex
    ? { ...part, text: `${text.trimEnd()}\n\n${recovery}` }
    : part);
}

function createMissingToolRecovery(toolName: string, activeTools: ReadonlySet<string>): string {
  const suggestion = exactToolSuggestion(toolName, activeTools);
  if (!suggestion) {
    return `工具名称不匹配：当前 Pi 会话没有注册 ${formatToolName(toolName)}。请根据当前工具 Schema 选择已注册工具；不要重复调用同一错误名称。`;
  }
  return `工具名称不匹配：当前 Pi 会话没有注册 ${formatToolName(toolName)}；对应的精确工具名是 ${formatToolName(suggestion)}。请按 ${formatToolName(suggestion)} 的 Pi 参数结构重试。`;
}

function exactToolSuggestion(toolName: string, activeTools: ReadonlySet<string>): string | undefined {
  const normalized = toolName.toLocaleLowerCase("en-US");
  const caseInsensitiveMatches = [...activeTools].filter(
    (candidate) => candidate.toLocaleLowerCase("en-US") === normalized
  );
  if (caseInsensitiveMatches.length === 1) return caseInsensitiveMatches[0];
  const alias = [...RECOVERY_ALIASES.entries()].find(([candidate]) => (
    candidate.toLocaleLowerCase("en-US") === normalized
  ));
  return alias && activeTools.has(alias[1]) ? alias[1] : undefined;
}

function isMissingToolResult(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (typeof part !== "object" || part === null) return false;
    const record = part as Record<string, unknown>;
    return record.type === "text"
      && typeof record.text === "string"
      && /^Tool .+ not found$/u.test(record.text.trim());
  });
}

function uniqueToolInfo(tools: readonly ToolInfo[], name: string): ToolInfo | undefined {
  const matches = tools.filter((tool) => tool.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function isExpectedCanonicalSource(name: CanonicalToolName, tool: ToolInfo): boolean {
  if (name === "web_search" || name === "fetch_content") {
    return (
      tool.sourceInfo.source === "sdk"
      && tool.sourceInfo.path === `<sdk:${name}>`
      && tool.sourceInfo.scope === "temporary"
      && tool.sourceInfo.origin === "top-level"
    ) || (
      tool.sourceInfo.origin === "package"
      && PI_WEB_ACCESS_SOURCE_PATTERN.test(tool.sourceInfo.source)
    );
  }
  return tool.sourceInfo.source === "builtin"
    && tool.sourceInfo.path === `<builtin:${name}>`
    && tool.sourceInfo.scope === "temporary"
    && tool.sourceInfo.origin === "top-level";
}

function formatToolName(toolName: string): string {
  const bounded = toolName.slice(0, MAX_TOOL_NAME_CHARS);
  return JSON.stringify(bounded || "unknown-tool");
}

function getActiveToolNames(pi: ExtensionAPI): Set<string> {
  try {
    return new Set(pi.getActiveTools());
  } catch {
    return new Set();
  }
}
