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
  type RiskCategory,
  type ToolIntent,
  type WorkspaceTrust
} from "@pi67/domain";
import { canonicalizePotentialPath, isContained } from "./path-policy.js";
import { boundUtf8 } from "./utf8-boundary.js";

export interface SafetyPolicyState {
  cwd: string;
  trust: WorkspaceTrust;
  approvalMode: ApprovalMode;
}

export type DesktopApprovalRequester = (
  request: ApprovalRequestDetails,
  options: { signal?: AbortSignal }
) => Promise<boolean>;

export const DESKTOP_SAFETY_EXTENSION_PATH = "<inline:pi67-desktop-safety>";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

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
          const allowed = await requestApproval({
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
          return allowed ? undefined : { block: true, reason: `Blocked by user: ${intent.category}` };
        } catch {
          return { block: true, reason: "π approval was unavailable and failed closed." };
        }
      });
    }
  };
}

async function classifyToolIntent(
  pi: ExtensionAPI,
  toolName: string,
  input: unknown,
  workspace: string
): Promise<ClassifiedToolIntent> {
  const record = asRecord(input);
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

  return { toolName, category: "ambiguous-command", target: toolName, targetKind: "tool" };
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
