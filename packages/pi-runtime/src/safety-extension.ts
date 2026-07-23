import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  classifyShellCommand,
  decideApproval,
  type ApprovalMode,
  type RiskCategory,
  type ToolIntent,
  type WorkspaceTrust
} from "@pi67/domain";
import { canonicalizePotentialPath, isContained } from "./path-policy.js";

export interface SafetyPolicyState {
  cwd: string;
  trust: WorkspaceTrust;
  approvalMode: ApprovalMode;
}

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

export function createDesktopSafetyExtension(getState: () => SafetyPolicyState): InlineExtension {
  return {
    name: "pi67-desktop-safety",
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", async (event, ctx) => {
        const state = getState();
        let intent: ToolIntent;
        try {
          intent = await classifyToolIntent(event.toolName, event.input, state.cwd);
        } catch {
          return { block: true, reason: "Pi-67 Desktop could not establish a safe canonical target." };
        }

        const decision = decideApproval(intent, state.trust, state.approvalMode);
        if (decision.allow) return undefined;
        if (!decision.approvalRequired) return { block: true, reason: decision.reason };
        if (!ctx.hasUI) return { block: true, reason: "Pi-67 Desktop approval UI is unavailable." };

        const preview = intent.target.length > 1_200 ? `${intent.target.slice(0, 1_200)}...` : intent.target;
        const allowed = await ctx.ui.confirm(
          decision.reason,
          `${preview}\n\n工作目录：${state.cwd}\n仅允许本次操作；拒绝后当前会话仍可继续。`
        );
        return allowed ? undefined : { block: true, reason: `Blocked by user: ${intent.category}` };
      });
    }
  };
}

async function classifyToolIntent(toolName: string, input: unknown, workspace: string): Promise<ToolIntent> {
  const record = asRecord(input);
  if (PATH_TOOLS.has(toolName)) {
    const rawPath = stringField(record, "path") ?? stringField(record, "filePath") ?? workspace;
    const canonical = await canonicalizePotentialPath(rawPath, workspace);
    const canonicalWorkspace = await realpath(resolve(workspace));
    const contained = isContained(canonical, canonicalWorkspace);
    const category: RiskCategory = contained
      ? WRITE_TOOLS.has(toolName) ? "workspace-write" : "workspace-read"
      : "external-path";
    return { toolName, category, target: canonical };
  }

  if (toolName === "bash") {
    const command = stringField(record, "command") ?? "";
    return { toolName, category: classifyShellCommand(command), target: command };
  }

  return { toolName, category: "ambiguous-command", target: toolName };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
