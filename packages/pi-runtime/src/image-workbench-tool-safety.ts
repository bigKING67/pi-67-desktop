import { IMAGE_PROVIDER_ID, type RiskCategory } from "@pi67/domain";
import { imageTools } from "./image-workbench-tools.js";
import { Check } from "typebox/value";
import { classifyPathToolIntent, classifySensitivePathTarget } from "./path-tool-safety.js";
import { stringField } from "./tool-input-contracts.js";

type ImageTool = ReturnType<typeof imageTools>[number];
type Intent = Awaited<ReturnType<typeof classifyPathToolIntent>> | {
  toolName: string; category: RiskCategory; target: string; targetKind: "tool"; sourceLabel: string; nonApprovableReason?: string;
};

const TOOLS: ReadonlyMap<string, ImageTool> = new Map(imageTools().map((tool) => [tool.name, tool] as const));
const READ_TOOLS = new Set(["image_project_read", "image_candidates"]);
const MASK_KEYS = ["generation_mask", "protection_mask", "blend_mask"] as const;

/** Desktop injects these as first-party `customTools` (ADR 0010 decision 13). */
export function isImageWorkbenchToolName(toolName: string): boolean {
  return TOOLS.has(toolName);
}

/**
 * Projects live under the session's Workspace, so project tools are Workspace
 * reads or writes. Creating from a photo reads one local file; generation
 * submits the prompt, references and masks to the user's Pi image model.
 * Credential and system-configuration paths are never valid photos, references
 * or masks, so they stop the call instead of asking (reads alone would ask).
 */
export async function classifyImageWorkbenchToolIntent(
  toolName: string,
  input: Record<string, unknown>,
  workspace: string,
  sourceLabel: string,
  taskTrustedRoots: readonly string[]
): Promise<Intent> {
  const tool = TOOLS.get(toolName);
  const projectId = stringField(input, "project_id");
  if (!tool || !projectId || !Check(tool.parameters, input)) {
    return { toolName, category: "unverified-tool", target: toolName, targetKind: "tool", sourceLabel,
      nonApprovableReason: "图像工作台 Tool 输入不符合已注册合同；请修正参数后重试。" };
  }
  const project = `.newmoney/images/${projectId}`;
  if (toolName === "image_project_create_from_photo") {
    const source = await classifyPathToolIntent(toolName, sourceLabel, "read", stringField(input, "source") ?? "", workspace, undefined, taskTrustedRoots);
    const sensitive = classifySensitivePathTarget(source.target);
    if (sensitive) return { toolName, category: sensitive, target: source.target, targetKind: "path", sourceLabel };
    if (source.category !== "workspace-read" && source.category !== "resource-read") return source;
    return { toolName, category: "workspace-write", target: project, targetKind: "tool", sourceLabel };
  }
  if (toolName === "image_generate") {
    let outside = 0;
    for (const path of generationInputPaths(input)) {
      const read = await classifyPathToolIntent(toolName, sourceLabel, "read", path, workspace, undefined, [], false);
      const sensitive = classifySensitivePathTarget(read.target);
      if (sensitive) return { toolName, category: sensitive, target: read.target, targetKind: "path", sourceLabel };
      if (read.category !== "workspace-read") outside += 1;
    }
    const job = input.job as Record<string, unknown> | undefined;
    const profile = typeof job?.provider_profile === "string" ? job.provider_profile : "unknown";
    return { toolName, category: "external-submit", sourceLabel, targetKind: "tool",
      target: `${IMAGE_PROVIDER_ID}/${profile}${outside ? ` · 含 ${outside} 个工作区外文件` : ""}` };
  }
  return { toolName, category: READ_TOOLS.has(toolName) ? "workspace-read" : "workspace-write", target: project, targetKind: "tool", sourceLabel };
}

function generationInputPaths(input: Record<string, unknown>): string[] {
  const references = Array.isArray(input.references) ? input.references as Record<string, unknown>[] : [];
  const edit = typeof input.edit === "object" && input.edit !== null ? input.edit as Record<string, unknown> : {};
  return [...references.map((reference) => reference.source), ...MASK_KEYS.map((key) => edit[key])]
    .filter((path): path is string => typeof path === "string");
}
