import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  classifyShellCommand,
  MAX_APPROVAL_CWD_BYTES,
  MAX_APPROVAL_TASK_PATHS,
  shellCommandExternalPaths,
  type RiskCategory
} from "@pi67/domain";
import {
  canonicalizePotentialPath,
  isContained,
  normalizeShellPathForPlatform
} from "./path-policy.js";

export interface BuiltinShellClassification {
  category: RiskCategory;
  approvalReason?: string;
  taskPathGrant?: readonly string[];
  authorizedByTaskRoot?: boolean;
}

export async function classifyBuiltinShellCommand(
  command: string,
  workspace: string,
  taskTrustedRoots: readonly string[] = []
): Promise<BuiltinShellClassification> {
  const classification = await classifyCategory(command, workspace, taskTrustedRoots);
  return {
    ...classification,
    ...(classification.category === "ambiguous-command" ? { approvalReason: ambiguousReason(command) } : {})
  };
}

async function classifyCategory(
  command: string,
  workspace: string,
  taskTrustedRoots: readonly string[]
): Promise<BuiltinShellClassification> {
  const externalPaths = shellCommandExternalPaths(command);
  if (!externalPaths || externalPaths.length === 0) return { category: classifyShellCommand(command) };
  const canonicalWorkspace = await realpath(resolve(workspace));
  const verifiedWorkspacePaths = new Set<string>();
  const untrustedPaths = new Set<string>();
  let authorizedByTaskRoot = false;
  for (const rawPath of externalPaths) {
    const expandedPath = rawPath === "~"
      ? homedir()
      : rawPath.startsWith("~/") || rawPath.startsWith("~\\")
        ? resolve(homedir(), rawPath.slice(2))
        : normalizeShellPathForPlatform(rawPath);
    const canonical = await canonicalizePotentialPath(expandedPath, workspace);
    if (isContained(canonical, canonicalWorkspace)) {
      verifiedWorkspacePaths.add(rawPath);
      continue;
    }
    if (taskTrustedRoots.some((root) => isContained(canonical, root))) {
      verifiedWorkspacePaths.add(rawPath);
      authorizedByTaskRoot = true;
      continue;
    }
    untrustedPaths.add(canonical);
  }
  const category = classifyShellCommand(command, { verifiedWorkspacePaths });
  const taskPathGrant = category === "external-path"
    && untrustedPaths.size > 0
    && untrustedPaths.size <= MAX_APPROVAL_TASK_PATHS
    && [...untrustedPaths].every((path) => Buffer.byteLength(path, "utf8") <= MAX_APPROVAL_CWD_BYTES)
    ? [...untrustedPaths]
    : undefined;
  return {
    category,
    ...(taskPathGrant === undefined ? {} : { taskPathGrant }),
    ...(authorizedByTaskRoot && category !== "external-path" ? { authorizedByTaskRoot: true } : {})
  };
}

function ambiguousReason(command: string): string {
  const features: string[] = [];
  if (/(?:^|[;\s])(?:for|while|until|case|if)\b/iu.test(command)) features.push("Shell 控制流");
  if (/\$(?:[a-z_{(]|\d)/iu.test(command) || command.includes("`")) features.push("变量或命令展开");
  if (/(?:^|[;\s])(?:(?:\d+)?>>?|<<?)(?!&1\b|\/dev\/null\b)/u.test(command)) {
    features.push("文件重定向");
  }
  if (features.length === 0) return "执行无法安全分类的命令";
  return `命令包含${features.join("、")}，Desktop 无法证明所有步骤均为非破坏性操作；请拆分调用或改用原生 read/grep/find/ls Tool`;
}
