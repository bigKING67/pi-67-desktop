import type { SourceInfo, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { ToolPresentationKind } from "@pi67/domain";
import { isValidExtensionSurfaceName } from "@pi67/extension-compat";
import type { ToolAdapterView } from "./extension-adapter-projection.js";
import { desktopToolAliasTarget } from "./tool-routing-extension.js";

export const TOOL_ATTRIBUTION_LIMITS = Object.freeze({
  runtimeTools: 1_024,
  effectiveTools: 512,
  activeToolCalls: 512,
  settledToolCalls: 512,
  toolCallIdCharacters: 256,
  sourceInfoCharacters: 2_048
});

export type ToolAttributionSource = Pick<ToolInfo, "name" | "sourceInfo">;

export interface ToolExecutionAttribution {
  readonly toolName: string;
  readonly toolKind: ToolPresentationKind;
  readonly adapter?: ToolAdapterView;
}

interface EffectiveToolAdapterAttribution {
  readonly sourceInfo: SourceInfo;
  readonly adapter: ToolAdapterView;
}

export class ToolAttributionRegistry {
  private sessionGeneration: number | undefined;
  private effectiveTools = new Map<string, EffectiveToolAdapterAttribution>();
  private readonly activeToolCalls = new Map<string, ToolExecutionAttribution>();
  private readonly settledToolCalls = new Map<string, ToolExecutionAttribution>();

  replaceEffectiveTools(
    sessionGeneration: number,
    runtimeTools: readonly ToolAttributionSource[],
    adapters: ReadonlyMap<string, ToolAdapterView>
  ): void {
    this.reset();
    if (!isSessionGeneration(sessionGeneration)) return;
    this.sessionGeneration = sessionGeneration;
    const sources = projectUniqueToolSources(runtimeTools);
    for (const [toolName, adapter] of adapters) {
      if (this.effectiveTools.size >= TOOL_ATTRIBUTION_LIMITS.effectiveTools) break;
      const sourceInfo = sources.get(toolName);
      const projectedAdapter = projectAdapter(toolName, adapter);
      if (sourceInfo && projectedAdapter) {
        this.effectiveTools.set(toolName, Object.freeze({ sourceInfo, adapter: projectedAdapter }));
      }
    }
  }

  bindToolExecutionStart(
    sessionGeneration: number,
    toolCallId: string,
    toolName: string,
    runtimeTools: readonly ToolAttributionSource[]
  ): ToolExecutionAttribution | undefined {
    if (!this.isCurrentGeneration(sessionGeneration) || !isToolCallId(toolCallId)) return undefined;
    const existing = this.activeToolCalls.get(toolCallId) ?? this.settledToolCalls.get(toolCallId);
    if (existing) return existing;
    if (this.activeToolCalls.size >= TOOL_ATTRIBUTION_LIMITS.activeToolCalls) return undefined;
    const sourceInfo = resolveCurrentToolSource(toolName, runtimeTools);
    const effectiveAdapter = this.effectiveTools.get(toolName);
    const adapter = sourceInfo && effectiveAdapter && sameSourceInfo(sourceInfo, effectiveAdapter.sourceInfo)
      ? effectiveAdapter.adapter
      : undefined;
    const attribution = Object.freeze({
      toolName,
      toolKind: toolPresentationKind(toolName, sourceInfo, adapter),
      ...(adapter === undefined ? {} : { adapter })
    });
    this.activeToolCalls.set(toolCallId, attribution);
    return attribution;
  }

  peekToolExecution(
    sessionGeneration: number,
    toolCallId: string
  ): ToolExecutionAttribution | undefined {
    if (!this.isCurrentGeneration(sessionGeneration) || !isToolCallId(toolCallId)) return undefined;
    return this.activeToolCalls.get(toolCallId) ?? this.settledToolCalls.get(toolCallId);
  }

  completeToolExecution(
    sessionGeneration: number,
    toolCallId: string
  ): ToolExecutionAttribution | undefined {
    if (!this.isCurrentGeneration(sessionGeneration) || !isToolCallId(toolCallId)) return undefined;
    const settled = this.settledToolCalls.get(toolCallId);
    if (settled) return settled;
    const attribution = this.activeToolCalls.get(toolCallId);
    if (!attribution) return undefined;
    this.activeToolCalls.delete(toolCallId);
    if (this.settledToolCalls.size >= TOOL_ATTRIBUTION_LIMITS.settledToolCalls) {
      const oldest = this.settledToolCalls.keys().next().value;
      if (oldest !== undefined) this.settledToolCalls.delete(oldest);
    }
    this.settledToolCalls.set(toolCallId, attribution);
    return attribution;
  }

  settleActiveToolExecutions(sessionGeneration: number): void {
    if (!this.isCurrentGeneration(sessionGeneration)) return;
    for (const toolCallId of this.activeToolCalls.keys()) {
      this.completeToolExecution(sessionGeneration, toolCallId);
    }
  }

  reset(): void {
    this.sessionGeneration = undefined;
    this.effectiveTools.clear();
    this.activeToolCalls.clear();
    this.settledToolCalls.clear();
  }

  get activeBindingCount(): number {
    return this.activeToolCalls.size;
  }

  get settledBindingCount(): number {
    return this.settledToolCalls.size;
  }

  private isCurrentGeneration(sessionGeneration: number): boolean {
    return isSessionGeneration(sessionGeneration) && sessionGeneration === this.sessionGeneration;
  }
}

function projectUniqueToolSources(
  runtimeTools: readonly ToolAttributionSource[]
): ReadonlyMap<string, SourceInfo> {
  const sources = new Map<string, SourceInfo>();
  const ambiguous = new Set<string>();
  if (runtimeTools.length > TOOL_ATTRIBUTION_LIMITS.runtimeTools) return sources;
  for (const tool of runtimeTools) {
    if (!isValidExtensionSurfaceName(tool.name) || ambiguous.has(tool.name)) continue;
    const sourceInfo = projectSourceInfo(tool.sourceInfo);
    if (!sourceInfo) continue;
    if (sources.has(tool.name)) {
      sources.delete(tool.name);
      ambiguous.add(tool.name);
    } else {
      sources.set(tool.name, sourceInfo);
    }
  }
  return sources;
}

function resolveCurrentToolSource(
  toolName: string,
  runtimeTools: readonly ToolAttributionSource[]
): SourceInfo | undefined {
  if (!isValidExtensionSurfaceName(toolName)
    || runtimeTools.length > TOOL_ATTRIBUTION_LIMITS.runtimeTools) return undefined;
  let sourceInfo: SourceInfo | undefined;
  for (const tool of runtimeTools) {
    if (tool.name !== toolName) continue;
    if (sourceInfo) return undefined;
    sourceInfo = projectSourceInfo(tool.sourceInfo);
    if (!sourceInfo) return undefined;
  }
  return sourceInfo;
}

function toolPresentationKind(
  toolName: string,
  sourceInfo: SourceInfo | undefined,
  adapter: ToolAdapterView | undefined
): ToolPresentationKind {
  if (isConfirmedBuiltinTool(toolName, sourceInfo)) return builtinToolPresentationKind(toolName);
  const aliasTarget = confirmedDesktopAliasTarget(toolName, sourceInfo);
  if (aliasTarget) return builtinToolPresentationKind(aliasTarget);
  if (!adapter) return "generic";
  if (adapter.presentation === "command") return "shell";
  if (adapter.presentation === "read") return "read";
  if (adapter.presentation === "change") return "edit";
  if (adapter.presentation === "delegated") return "subagent";
  return "generic";
}

function confirmedDesktopAliasTarget(toolName: string, sourceInfo: SourceInfo | undefined): string | undefined {
  const target = desktopToolAliasTarget(toolName);
  return target
    && sourceInfo?.source === "sdk"
    && sourceInfo.path === `<sdk:${toolName}>`
    && sourceInfo.scope === "temporary"
    && sourceInfo.origin === "top-level"
    ? target
    : undefined;
}

function isConfirmedBuiltinTool(toolName: string, sourceInfo: SourceInfo | undefined): boolean {
  return sourceInfo?.source === "builtin"
    && sourceInfo.path === `<builtin:${toolName}>`
    && sourceInfo.scope === "temporary"
    && sourceInfo.origin === "top-level";
}

function builtinToolPresentationKind(toolName: string): ToolPresentationKind {
  if (toolName === "read") return "read";
  if (toolName === "grep" || toolName === "find" || toolName === "ls") return "search";
  if (toolName === "edit" || toolName === "write") return "edit";
  if (toolName === "bash") return "shell";
  if (toolName === "web_search" || toolName === "fetch_content") return "search";
  return "generic";
}

function projectSourceInfo(sourceInfo: SourceInfo): SourceInfo | undefined {
  if (!isBoundedSourceInfoText(sourceInfo.path)
    || !isBoundedSourceInfoText(sourceInfo.source)
    || (sourceInfo.scope !== "user" && sourceInfo.scope !== "project" && sourceInfo.scope !== "temporary")
    || (sourceInfo.origin !== "package" && sourceInfo.origin !== "top-level")
    || (sourceInfo.baseDir !== undefined && !isBoundedSourceInfoText(sourceInfo.baseDir))) return undefined;
  return Object.freeze({
    path: sourceInfo.path,
    source: sourceInfo.source,
    scope: sourceInfo.scope,
    origin: sourceInfo.origin,
    ...(sourceInfo.baseDir === undefined ? {} : { baseDir: sourceInfo.baseDir })
  });
}

function sameSourceInfo(left: SourceInfo, right: SourceInfo): boolean {
  return left.path === right.path
    && left.source === right.source
    && left.scope === right.scope
    && left.origin === right.origin
    && left.baseDir === right.baseDir;
}

function isBoundedSourceInfoText(value: string): boolean {
  return value.length > 0
    && value.length <= TOOL_ATTRIBUTION_LIMITS.sourceInfoCharacters
    && !hasControlCharacter(value);
}

function projectAdapter(toolName: string, adapter: ToolAdapterView): ToolAdapterView | undefined {
  if (!isValidExtensionSurfaceName(toolName)
    || typeof adapter.adapterId !== "string"
    || adapter.adapterId.length === 0
    || adapter.adapterId.length > 80
    || typeof adapter.package !== "string"
    || adapter.package.length === 0
    || adapter.package.length > 214
    || !isPresentation(adapter.presentation)
    || (adapter.label !== undefined && (typeof adapter.label !== "string" || adapter.label.length > 120))) {
    return undefined;
  }
  return Object.freeze({
    adapterId: adapter.adapterId,
    package: adapter.package,
    presentation: adapter.presentation,
    ...(adapter.label === undefined ? {} : { label: adapter.label })
  });
}

function isPresentation(value: string): value is ToolAdapterView["presentation"] {
  return value === "generic"
    || value === "command"
    || value === "read"
    || value === "change"
    || value === "delegated";
}

function isSessionGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isToolCallId(value: string): boolean {
  return value.length > 0
    && value.length <= TOOL_ATTRIBUTION_LIMITS.toolCallIdCharacters
    && !hasControlCharacter(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
