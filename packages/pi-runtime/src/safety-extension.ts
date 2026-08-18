import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  MAX_APPROVAL_CWD_BYTES,
  MAX_APPROVAL_TARGET_BYTES,
  classifyShellCommand,
  decideApproval,
  isPlanModeReadOnlyShellCommand,
  type ApprovalTargetKind,
  type ApprovalRequestDetails,
  type ApprovalMode,
  type ExtensionUiCancellationReason,
  type RiskCategory,
  type TaskToolMode,
  type SessionInteractionMode,
  type ToolAutoAuthorizationReason,
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
import type { LoadedResourceReadAccess } from "./loaded-resource-read-access.js";
import { classifyPiMcpAdapterIntent } from "./pi-mcp-adapter-safety.js";
import type { ConfiguredCapabilityCatalog } from "./configured-capability-catalog.js";
import { classifyConfiguredToolIntent } from "./configured-tool-safety.js";
import {
  createToolSafetyProfileResolver,
  type ToolSafetyProfile
} from "./tool-safety-profile.js";
import {
  asToolInputRecord,
  hasBuiltinInputContract,
  hasPi67PlanToolContract,
  hasPiFffInputContract,
  hasPiWebAccessReadContract,
  networkReadTarget,
  stringField
} from "./tool-input-contracts.js";

export interface SafetyPolicyState {
  cwd: string;
  trust: WorkspaceTrust;
  approvalMode: ApprovalMode;
  taskToolMode: TaskToolMode;
}

export type DesktopApprovalDecision =
  | { status: "allowed" }
  | { status: "denied" }
  | { status: "cancelled"; reason: ExtensionUiCancellationReason | "unavailable" };

export type DesktopApprovalRequester = (
  request: ApprovalRequestDetails,
  options: { signal?: AbortSignal }
) => Promise<DesktopApprovalDecision>;

export type DesktopToolAuthorizationRecorder = (
  toolCallId: string,
  reason: ToolAutoAuthorizationReason
) => void;

export const DESKTOP_SAFETY_EXTENSION_PATH = "<inline:pi67-desktop-safety>";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

interface ClassifiedToolIntent extends ToolIntent {
  targetKind: ApprovalTargetKind;
  sourceLabel: string;
  nonApprovableReason?: string;
  autoAuthorizationReason?: ToolAutoAuthorizationReason;
}

export function createDesktopSafetyExtension(
  getState: () => SafetyPolicyState,
  requestApproval: DesktopApprovalRequester,
  loadedResourceReadAccess?: LoadedResourceReadAccess,
  configuredCapabilities?: ConfiguredCapabilityCatalog,
  recordToolAuthorization?: DesktopToolAuthorizationRecorder,
  getInteractionMode?: () => SessionInteractionMode
): InlineExtension {
  const resolveToolProfile = createToolSafetyProfileResolver(configuredCapabilities);
  return {
    name: "pi67-desktop-safety",
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", async (event, ctx) => {
        if (isVerifiedDesktopAttachmentTool(pi, event.toolName, event.input)) return undefined;
        const state = getState();
        let intent: ClassifiedToolIntent;
        try {
          intent = await classifyToolIntent(
            pi,
            event.toolName,
            event.input,
            state.cwd,
            loadedResourceReadAccess,
            resolveToolProfile,
            configuredCapabilities
          );
        } catch {
          return { block: true, reason: "π could not establish a safe canonical target." };
        }
        if (getInteractionMode?.() === "plan") {
          if (isPlanModeAllowedIntent(intent, event.toolName, event.input)) return undefined;
          return {
            block: true,
            reason: "PLAN_MODE_READ_ONLY: 当前会话处于计划模式，只允许只读检查、原生搜索和计划交互。请切换到执行模式后再修改或运行可能写入的命令。"
          };
        }
        if (state.trust === "trusted" && state.taskToolMode === "yolo") return undefined;
        if (intent.nonApprovableReason) {
          return { block: true, reason: intent.nonApprovableReason };
        }
        if (
          state.trust === "trusted"
          && state.taskToolMode === "auto"
          && intent.autoAuthorizationReason !== undefined
        ) {
          recordToolAuthorization?.(event.toolCallId, intent.autoAuthorizationReason);
          return undefined;
        }

        const approvalMode: ApprovalMode = state.taskToolMode === "ask" ? "guided" : "balanced";
        const decision = decideApproval(intent, state.trust, approvalMode);
        if (decision.allow) {
          const authorizationReason = autoAuthorizationReason(intent.category);
          if (authorizationReason) recordToolAuthorization?.(event.toolCallId, authorizationReason);
          return undefined;
        }
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
            toolSource: intent.sourceLabel,
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

function autoAuthorizationReason(category: RiskCategory): ToolAutoAuthorizationReason | undefined {
  if (
    category === "workspace-read"
    || category === "resource-read"
    || category === "capability-read"
    || category === "network-read"
  ) return "read-only";
  if (category === "workspace-command") return "workspace-command";
  if (category === "workspace-write") return "workspace-write";
  if (category === "configured-operation" || category === "persistent-state-write") {
    return "configured-source";
  }
  return undefined;
}

function isPlanModeAllowedIntent(
  intent: ClassifiedToolIntent,
  toolName: string,
  input: unknown
): boolean {
  if (
    intent.category === "workspace-read"
    || intent.category === "resource-read"
    || intent.category === "capability-read"
    || intent.category === "network-read"
  ) return true;
  if (toolName !== "bash" || intent.category !== "workspace-command") return false;
  return isPlanModeReadOnlyShellCommand(stringField(asToolInputRecord(input), "command") ?? "");
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
  workspace: string,
  loadedResourceReadAccess: LoadedResourceReadAccess | undefined,
  resolveToolProfile: ReturnType<typeof createToolSafetyProfileResolver>,
  configuredCapabilities: ConfiguredCapabilityCatalog | undefined
): Promise<ClassifiedToolIntent> {
  const record = asToolInputRecord(input);
  const alias = resolveDesktopToolAliasCall(toolName, record);
  if (alias && isVerifiedDesktopToolAlias(
    alias.alias,
    alias.canonical,
    pi.getAllTools(),
    new Set(pi.getActiveTools())
  )) {
    return classifyToolIntent(
      pi,
      alias.canonical,
      alias.input,
      workspace,
      loadedResourceReadAccess,
      resolveToolProfile,
      configuredCapabilities
    );
  }
  const profile = await resolveToolProfile(pi, toolName);
  if (profile.kind === "pi67-plan" && hasPi67PlanToolContract(toolName, record)) {
    return {
      toolName,
      category: "capability-read",
      target: toolName,
      targetKind: "tool",
      sourceLabel: profile.sourceLabel
    };
  }
  if (toolName === "bash" && profile.kind === "builtin") {
    const command = stringField(record, "command") ?? "";
    return {
      toolName,
      category: classifyShellCommand(command),
      target: command,
      targetKind: "command",
      sourceLabel: profile.sourceLabel
    };
  }

  if (
    profile.kind === "builtin"
    && PATH_TOOLS.has(toolName)
    && hasBuiltinInputContract(toolName, record)
  ) {
    return classifyPathTool(
      profile,
      toolName,
      stringField(record, "path") ?? workspace,
      workspace,
      loadedResourceReadAccess
    );
  }

  if (profile.kind === "pi-fff" && hasPiFffInputContract(profile.canonicalToolName, record)) {
    if (stringField(record, "cursor") !== undefined) {
      return {
        toolName,
        category: "unverified-tool",
        target: `${toolName} cursor`,
        targetKind: "tool",
        sourceLabel: profile.sourceLabel,
        nonApprovableReason: "无法验证分页游标对应的搜索根目录；请不带 cursor 重新执行搜索。"
      };
    }
    return classifyPathTool(
      profile,
      profile.canonicalToolName,
      stringField(record, "path") ?? workspace,
      workspace,
      loadedResourceReadAccess
    );
  }

  if (
    (profile.kind === "pi67-web" || profile.kind === "pi-web-access")
    && hasPiWebAccessReadContract(toolName, record)
  ) {
    return {
      toolName,
      category: "network-read",
      target: networkReadTarget(record, toolName),
      targetKind: "tool",
      sourceLabel: profile.sourceLabel
    };
  }

  if (profile.kind === "pi-mcp-adapter") {
    const directToolCorrection = await classifyPiFffMcpMisroute(
      pi,
      profile,
      record,
      resolveToolProfile
    );
    if (directToolCorrection) return directToolCorrection;
    if (!configuredCapabilities) {
      return {
        toolName,
        category: "unverified-tool",
        target: toolName,
        targetKind: "tool",
        sourceLabel: profile.sourceLabel,
        nonApprovableReason: "当前 Task 的有效 MCP 能力目录不可用；请重新加载 Pi 资源后重试。"
      };
    }
    let activeTools: ReadonlySet<string> = new Set();
    try {
      activeTools = new Set(pi.getActiveTools());
    } catch {
      // The configured MCP catalog still remains authoritative for proxy calls.
    }
    const intent = await classifyPiMcpAdapterIntent(profile, input, {
      catalog: configuredCapabilities,
      workspace,
      ...(loadedResourceReadAccess === undefined ? {} : { loadedResourceReadAccess }),
      isDirectTool: (candidate) => candidate !== "mcp" && activeTools.has(candidate)
    });
    return intent.nonApprovableReason === undefined && intent.sourceLabel !== profile.sourceLabel
      ? { ...intent, autoAuthorizationReason: "installed-capability" }
      : intent;
  }

  if (
    profile.kind === "configured-package"
    || profile.kind === "managed-package"
    || profile.kind === "configured-mcp"
  ) {
    const intent = await classifyConfiguredToolIntent({
      toolName,
      input: record,
      workspace,
      sourceLabel: profile.sourceLabel,
      ...(loadedResourceReadAccess === undefined ? {} : { loadedResourceReadAccess }),
      ...(profile.kind === "configured-mcp"
        ? { serverName: profile.serverName, remoteToolName: profile.remoteToolName }
        : {})
    });
    return { ...intent, autoAuthorizationReason: "installed-capability" };
  }

  return {
    toolName,
    category: "unverified-tool",
    target: toolName,
    targetKind: "tool",
    sourceLabel: profile.sourceLabel,
    ...(!("nonApprovableReason" in profile) || profile.nonApprovableReason === undefined
      ? {}
      : { nonApprovableReason: profile.nonApprovableReason })
  };
}

async function classifyPiFffMcpMisroute(
  pi: ExtensionAPI,
  profile: Extract<ToolSafetyProfile, { kind: "pi-mcp-adapter" }>,
  record: Record<string, unknown>,
  resolveToolProfile: ReturnType<typeof createToolSafetyProfileResolver>
): Promise<ClassifiedToolIntent | undefined> {
  const requestedTool = stringField(record, "tool");
  if (requestedTool !== "fffind" && requestedTool !== "ffgrep") return undefined;
  if (record.server !== undefined) return undefined;
  if (!Object.keys(record).every((key) => key === "tool" || key === "args")) return undefined;

  let activeTools: ReadonlySet<string>;
  try {
    activeTools = new Set(pi.getActiveTools());
  } catch {
    return undefined;
  }

  const canonicalTool = requestedTool === "fffind" ? "find" : "grep";
  for (const directTool of [requestedTool, canonicalTool]) {
    if (!activeTools.has(directTool)) continue;
    const directProfile = await resolveToolProfile(pi, directTool);
    if (
      directProfile.kind !== "pi-fff"
      || directProfile.canonicalToolName !== canonicalTool
    ) continue;
    return {
      toolName: profile.toolName,
      category: "unverified-tool",
      target: requestedTool,
      targetKind: "tool",
      sourceLabel: profile.sourceLabel,
      nonApprovableReason: `无需用户授权：@ff-labs/pi-fff 当前注册为直接 Tool \`${directTool}\`，不要通过 \`mcp\` 调用 \`${requestedTool}\`；请直接调用 \`${directTool}\`。`
    };
  }
  return undefined;
}

async function classifyPathTool(
  profile: Extract<ToolSafetyProfile, { kind: "builtin" | "pi-fff" }>,
  capabilityName: string,
  rawPath: string,
  workspace: string,
  loadedResourceReadAccess?: LoadedResourceReadAccess
): Promise<ClassifiedToolIntent> {
  const expandedPath = rawPath === "~"
    ? homedir()
    : rawPath.startsWith("~/")
      ? resolve(homedir(), rawPath.slice(2))
      : rawPath;
  const canonical = await canonicalizePotentialPath(expandedPath, workspace);
  const canonicalWorkspace = await realpath(resolve(workspace));
  const contained = isContained(canonical, canonicalWorkspace);
  const category: RiskCategory = contained
    ? WRITE_TOOLS.has(capabilityName) ? "workspace-write" : "workspace-read"
    : loadedResourceReadAccess?.allows(capabilityName, canonical)
      ? "resource-read"
      : "external-path";
  return {
    toolName: profile.toolName,
    category,
    target: canonical,
    targetKind: "path",
    sourceLabel: profile.sourceLabel
  };
}
