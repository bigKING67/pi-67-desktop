import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  MAX_APPROVAL_CWD_BYTES,
  MAX_APPROVAL_TARGET_BYTES,
  classifyShellCommand,
  decideApproval,
  type ApprovalTargetKind,
  type ApprovalRequestDetails,
  type ApprovalMode,
  type ExtensionUiCancellationReason,
  type RiskCategory,
  type ToolIntent,
  type WorkspaceTrust
} from "@pi67/domain";
import { canonicalizePotentialPath, isContained } from "./path-policy.js";
import {
  isVerifiedDesktopToolAlias,
  resolveDesktopToolAliasCall
} from "./tool-routing-extension.js";
import { boundUtf8 } from "./utf8-boundary.js";
import { isVerifiedDesktopAttachmentTool } from "./prompt-attachment-extension.js";

export interface SafetyPolicyState {
  cwd: string;
  trust: WorkspaceTrust;
  approvalMode: ApprovalMode;
}

export type DesktopApprovalDecision =
  | { status: "allowed" }
  | { status: "denied" }
  | { status: "cancelled"; reason: ExtensionUiCancellationReason | "unavailable" };

export type DesktopApprovalRequester = (
  request: ApprovalRequestDetails,
  options: { signal?: AbortSignal }
) => Promise<DesktopApprovalDecision>;

export const DESKTOP_SAFETY_EXTENSION_PATH = "<inline:pi67-desktop-safety>";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const PI_WEB_ACCESS_SOURCE_PATTERN = /^npm:pi-web-access(?:@|$)/u;
const PI_WEB_ACCESS_NETWORK_READ_TOOLS = new Set(["web_search", "fetch_content"]);

interface ClassifiedToolIntent extends ToolIntent {
  targetKind: ApprovalTargetKind;
}

export function createDesktopSafetyExtension(
  getState: () => SafetyPolicyState,
  requestApproval: DesktopApprovalRequester
): InlineExtension {
  return {
    name: "pi67-desktop-safety",
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", async (event, ctx) => {
        if (isVerifiedDesktopAttachmentTool(pi, event.toolName, event.input)) return undefined;
        const state = getState();
        let intent: ClassifiedToolIntent;
        try {
          intent = await classifyToolIntent(pi, event.toolName, event.input, state.cwd);
        } catch {
          return { block: true, reason: "π could not establish a safe canonical target." };
        }

        const decision = decideApproval(intent, state.trust, state.approvalMode);
        if (decision.allow) return undefined;
        if (!decision.approvalRequired) return { block: true, reason: decision.reason };
        if (!ctx.hasUI) return { block: true, reason: "π approval UI is unavailable." };

        const target = boundUtf8(intent.target, MAX_APPROVAL_TARGET_BYTES);
        const cwd = boundUtf8(state.cwd, MAX_APPROVAL_CWD_BYTES);
        if (target.truncated || cwd.truncated) {
          return { block: true, reason: "π will not approve a target that cannot be displayed in full." };
        }
        if (ctx.signal?.aborted) {
          return { block: true, reason: "π approval was cancelled before the tool could run." };
        }
        try {
          const approval = await requestApproval({
            toolCallId: event.toolCallId,
            toolName: intent.toolName,
            category: intent.category,
            reason: decision.reason,
            targetKind: intent.targetKind,
            target: target.value,
            targetTruncated: false,
            cwd: cwd.value,
            cwdTruncated: false,
            scope: "single-tool-call"
          }, ctx.signal === undefined ? {} : { signal: ctx.signal });
          if (ctx.signal?.aborted) {
            return { block: true, reason: "π approval was cancelled before the tool could run." };
          }
          if (approval.status === "allowed") return undefined;
          if (approval.status === "cancelled") {
            return { block: true, reason: approvalCancellationReason(approval.reason) };
          }
          return {
            block: true,
            reason: `工具已注册，但用户未批准本次一次性授权：${decision.reason}。这不表示工具不可用；不要自动重试。`
          };
        } catch {
          return { block: true, reason: "π approval was unavailable and failed closed." };
        }
      });
    }
  };
}

function approvalCancellationReason(
  reason: ExtensionUiCancellationReason | "unavailable"
): string {
  if (reason === "abort") return "π approval was cancelled before the tool could run.";
  if (reason === "timeout") return "等待授权超时，工具未执行；这不是用户拒绝。";
  if (reason === "unavailable") return "π approval was unavailable and failed closed.";
  return `授权请求因 Desktop 状态变化而取消（${reason}），工具未执行；这不是用户拒绝。`;
}

async function classifyToolIntent(
  pi: ExtensionAPI,
  toolName: string,
  input: unknown,
  workspace: string
): Promise<ClassifiedToolIntent> {
  const record = asRecord(input);
  const alias = resolveDesktopToolAliasCall(toolName, record);
  if (alias && isVerifiedDesktopToolAlias(
    alias.alias,
    alias.canonical,
    pi.getAllTools(),
    new Set(pi.getActiveTools())
  )) {
    return classifyToolIntent(pi, alias.canonical, alias.input, workspace);
  }
  if (toolName === "bash") {
    const command = stringField(record, "command") ?? "";
    return { toolName, category: classifyShellCommand(command), target: command, targetKind: "command" };
  }

  if (PATH_TOOLS.has(toolName) && isCurrentBuiltinTool(pi, toolName) && hasBuiltinInputContract(toolName, record)) {
    const rawPath = stringField(record, "path") ?? workspace;
    const canonical = await canonicalizePotentialPath(rawPath, workspace);
    const canonicalWorkspace = await realpath(resolve(workspace));
    const contained = isContained(canonical, canonicalWorkspace);
    const category: RiskCategory = contained
      ? WRITE_TOOLS.has(toolName) ? "workspace-write" : "workspace-read"
      : "external-path";
    return { toolName, category, target: canonical, targetKind: "path" };
  }

  if (isPiWebAccessTool(pi, toolName) && hasPiWebAccessReadContract(toolName, record)) {
    return {
      toolName,
      category: "network-read",
      target: networkReadTarget(record, toolName),
      targetKind: "tool"
    };
  }

  return { toolName, category: "ambiguous-command", target: toolName, targetKind: "tool" };
}

function isPiWebAccessTool(pi: ExtensionAPI, toolName: string): boolean {
  if (!PI_WEB_ACCESS_NETWORK_READ_TOOLS.has(toolName)) return false;
  try {
    const matches = pi.getAllTools().filter((tool) => tool.name === toolName);
    const source = matches.length === 1 ? matches[0]?.sourceInfo : undefined;
    return source?.origin === "package"
      && PI_WEB_ACCESS_SOURCE_PATTERN.test(source.source);
  } catch {
    return false;
  }
}

function hasPiWebAccessReadContract(toolName: string, record: Record<string, unknown>): boolean {
  if (toolName === "web_search") {
    return stringField(record, "query") !== undefined || nonEmptyStringArray(record.queries) !== undefined;
  }
  if (toolName !== "fetch_content") return false;
  const singleUrl = stringField(record, "url");
  const urls = [
    ...(singleUrl === undefined ? [] : [singleUrl]),
    ...(nonEmptyStringArray(record.urls) ?? [])
  ];
  return urls.length > 0 && urls.every(isExternalWebUrl);
}

function nonEmptyStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return items.length > 0 ? items : undefined;
}

function isExternalWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}

function networkReadTarget(record: Record<string, unknown>, fallback: string): string {
  for (const key of ["query", "url", "responseId"] as const) {
    const value = stringField(record, key);
    if (value) return value;
  }
  for (const key of ["queries", "urls"] as const) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    if (items.length > 0) return items.join("\n");
  }
  return fallback;
}

function isCurrentBuiltinTool(pi: ExtensionAPI, toolName: string): boolean {
  try {
    const matches = pi.getAllTools().filter((tool) => tool.name === toolName);
    const source = matches.length === 1 ? matches[0]?.sourceInfo : undefined;
    return source?.source === "builtin"
      && source.path === `<builtin:${toolName}>`
      && source.scope === "temporary"
      && source.origin === "top-level";
  } catch {
    return false;
  }
}

function hasBuiltinInputContract(toolName: string, record: Record<string, unknown>): boolean {
  const path = stringField(record, "path");
  if (toolName === "read") return path !== undefined;
  if (toolName === "write") return path !== undefined && typeof record.content === "string";
  if (toolName === "edit") {
    return path !== undefined
      && Array.isArray(record.edits)
      && record.edits.length > 0
      && record.edits.every(isEditReplacement);
  }
  if (toolName === "grep" || toolName === "find") {
    return stringField(record, "pattern") !== undefined && optionalPathIsValid(record);
  }
  return toolName === "ls" && optionalPathIsValid(record);
}

function isEditReplacement(value: unknown): boolean {
  const record = asRecord(value);
  return typeof record.oldText === "string" && typeof record.newText === "string";
}

function optionalPathIsValid(record: Record<string, unknown>): boolean {
  return record.path === undefined || stringField(record, "path") !== undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
