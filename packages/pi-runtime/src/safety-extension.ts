import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  MAX_APPROVAL_CWD_BYTES,
  MAX_APPROVAL_TARGET_BYTES,
  decideApproval,
  isHardStopRiskCategory,
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
import { classifyBuiltinShellCommand } from "./builtin-shell-safety.js";
import { classifyPathToolIntent } from "./path-tool-safety.js";
import {
  isVerifiedDesktopToolAlias,
  resolveDesktopToolAliasCall
} from "./tool-routing-extension.js";
import { boundUtf8 } from "./utf8-boundary.js";
import { isVerifiedDesktopAttachmentTool } from "./prompt-attachment-extension.js";
import { hasNativeImageToolInput } from "./native-image-tools.js";
import { classifyImageWorkbenchToolIntent } from "./image-workbench-tool-safety.js";
import type { LoadedResourceReadAccess } from "./loaded-resource-read-access.js";
import type { ConfiguredCapabilityCatalog } from "./configured-capability-catalog.js";
import { classifyConfiguredToolIntent } from "./configured-tool-safety.js";
import {
  createToolSafetyProfileResolver
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
import { classifyPi67ContextToolIntent } from "./pi67-context-tool-safety.js";
import { isVerifiedDesktopCodemode } from "./codemode-extension.js";

export interface SafetyPolicyState {
  cwd: string;
  trust: WorkspaceTrust;
  taskToolMode: TaskToolMode;
  taskTrustedRoots?: readonly string[];
  /** Team Chat Agent turns run with no tools at all (ADR 0004). */
  toolsDisabled?: boolean;
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

interface ClassifiedToolIntent extends ToolIntent {
  targetKind: ApprovalTargetKind;
  sourceLabel: string;
  approvalReason?: string;
  nonApprovableReason?: string;
  autoAuthorizationReason?: ToolAutoAuthorizationReason;
  taskPathGrant?: readonly string[];
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
        const state = getState();
        if (state.toolsDisabled) return { block: true, reason: "AGENT_TURN_NO_TOOLS: Team Chat Agent turns have no tools." };
        if (event.toolName === "codemode") {
          try {
            if (!isVerifiedDesktopCodemode(pi, event.input) || event.parentToolCallId) {
              return { block: true, reason: "CODEMODE_IDENTITY_INVALID: Codemode requires the unique Desktop sandbox root; nested Codemode is not allowed." };
            }
          } catch {
            return { block: true, reason: "CODEMODE_IDENTITY_INVALID: Codemode tool identity is unavailable." };
          }
          if (state.trust !== "trusted") return { block: true, reason: "CODEMODE_WORKSPACE_UNTRUSTED: Trust this Workspace before using Codemode." };
          // The sandbox has no model/network/filesystem globals. This admits only
          // the container, including in PLAN; every leaf still runs this hook.
          return undefined;
        }
        if (isVerifiedDesktopAttachmentTool(pi, event.toolName, event.input)) return undefined;
        let intent: ClassifiedToolIntent;
        try {
          intent = await classifyToolIntent(
            pi,
            event.toolName,
            event.input,
            state.cwd,
            loadedResourceReadAccess,
            resolveToolProfile,
            configuredCapabilities,
            state.taskTrustedRoots ?? []
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
        if (intent.nonApprovableReason) {
          return { block: true, reason: intent.nonApprovableReason };
        }
        const hardStop = isHardStopRiskCategory(intent.category);
        if (state.trust === "trusted" && state.taskToolMode === "yolo" && !hardStop) {
          return undefined;
        }
        if (
          state.trust === "trusted"
          && state.taskToolMode === "auto"
          && !hardStop
          && isApplicableAutoAuthorization(intent)
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
        if (!decision.approvalRequired) {
          return { block: true, reason: intent.approvalReason ?? decision.reason };
        }
        if (!ctx.hasUI) return { block: true, reason: "π approval UI is unavailable." };

        const approvalReason = intent.approvalReason ?? decision.reason;
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
            reason: approvalReason,
            targetKind: intent.targetKind,
            target: target.value,
            targetTruncated: false,
            cwd: cwd.value,
            cwdTruncated: false,
            scope: "single-tool-call",
            ...(intent.taskPathGrant === undefined
              ? {}
              : { taskPathGrant: { kind: "paths" as const, paths: [...intent.taskPathGrant] } })
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
            reason: `工具已注册，但用户未批准本次一次性授权：${approvalReason}。这不表示工具不可用；不要自动重试。`
          };
        } catch {
          return { block: true, reason: "π approval was unavailable and failed closed." };
        }
      });
    }
  };
}

function isApplicableAutoAuthorization(
  intent: ClassifiedToolIntent
): intent is ClassifiedToolIntent & { autoAuthorizationReason: ToolAutoAuthorizationReason } {
  if (intent.autoAuthorizationReason === undefined) return false;
  if (intent.autoAuthorizationReason !== "task-trusted-root") return true;
  return intent.category === "workspace-read"
    || intent.category === "workspace-command"
    || intent.category === "dependency-change";
}

function autoAuthorizationReason(category: RiskCategory): ToolAutoAuthorizationReason | undefined {
  if (
    category === "workspace-read"
    || category === "resource-read"
    || category === "capability-read"
    || category === "network-read"
  ) return "read-only";
  if (category === "workspace-command" || category === "dependency-change") return "workspace-command";
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
  configuredCapabilities: ConfiguredCapabilityCatalog | undefined,
  taskTrustedRoots: readonly string[]
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
      configuredCapabilities,
      taskTrustedRoots
    );
  }
  const profile = await resolveToolProfile(pi, toolName);
  if (profile.kind === "pi67-images") {
    if (!hasNativeImageToolInput(toolName, record)) return {
      toolName, category: "unverified-tool", target: toolName, targetKind: "tool", sourceLabel: profile.sourceLabel,
      nonApprovableReason: "生图 Tool 输入不符合已注册合同；请修正参数后重试。"
    };
    return {
      toolName, category: toolName === "image_models" ? "capability-read" : "external-submit",
      target: toolName === "image_models" ? toolName : `${stringField(record, "provider")}/${stringField(record, "model")}`,
      targetKind: "tool", sourceLabel: profile.sourceLabel
    };
  }
  if (profile.kind === "pi67-image-workbench") {
    return classifyImageWorkbenchToolIntent(toolName, record, workspace, profile.sourceLabel, taskTrustedRoots);
  }
  if (profile.kind === "pi67-plan" && hasPi67PlanToolContract(toolName, record)) {
    return {
      toolName,
      category: "capability-read",
      target: toolName,
      targetKind: "tool",
      sourceLabel: profile.sourceLabel
    };
  }
  if (profile.kind === "pi67-context") {
    return classifyPi67ContextToolIntent(toolName, record, profile.sourceLabel);
  }
  if (toolName === "bash" && profile.kind === "builtin") {
    const command = stringField(record, "command") ?? "";
    const shell = await classifyBuiltinShellCommand(command, workspace, taskTrustedRoots);
    return {
      toolName,
      category: shell.category,
      target: command,
      targetKind: "command",
      sourceLabel: profile.sourceLabel,
      ...(shell.approvalReason === undefined ? {} : { approvalReason: shell.approvalReason }),
      ...(shell.taskPathGrant === undefined ? {} : { taskPathGrant: shell.taskPathGrant }),
      ...(shell.authorizedByTaskRoot ? { autoAuthorizationReason: "task-trusted-root" as const } : {})
    };
  }

  if (
    profile.kind === "builtin"
    && PATH_TOOLS.has(toolName)
    && hasBuiltinInputContract(toolName, record)
  ) {
    return classifyPathToolIntent(
      profile.toolName,
      profile.sourceLabel,
      toolName,
      stringField(record, "path") ?? workspace,
      workspace,
      loadedResourceReadAccess,
      taskTrustedRoots
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
    return classifyPathToolIntent(
      profile.toolName,
      profile.sourceLabel,
      profile.canonicalToolName,
      stringField(record, "path") ?? workspace,
      workspace,
      loadedResourceReadAccess,
      [],
      false
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

  if (profile.kind === "native-mcp-read") {
    const server = stringField(record, "server");
    if (server !== undefined && !configuredCapabilities?.nativeMcp.hasServer(server)) {
      return { toolName, category: "unverified-tool", target: toolName, targetKind: "tool",
        sourceLabel: profile.sourceLabel, nonApprovableReason: "MCP server 不在当前 Session 的有效配置中。" };
    }
    return { toolName, category: "capability-read", target: toolName, targetKind: "tool", sourceLabel: profile.sourceLabel };
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
