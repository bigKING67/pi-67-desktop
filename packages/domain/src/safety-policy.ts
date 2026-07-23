import type { ApprovalMode, WorkspaceTrust } from "./runtime-state.js";

export type RiskCategory =
  | "workspace-read"
  | "workspace-write"
  | "external-path"
  | "bulk-delete"
  | "destructive-shell"
  | "system-configuration"
  | "dependency-change"
  | "git-external-action"
  | "download-and-execute"
  | "network-side-effect"
  | "ambiguous-command";

export interface ToolIntent {
  toolName: string;
  category: RiskCategory;
  target: string;
}

export interface ApprovalDecision {
  allow: boolean;
  approvalRequired: boolean;
  reason: string;
}

const SAFE_READ_COMMAND = /^(?:pwd|git\s+(?:status|diff|log|show)(?:\s|$)|ls(?:\s|$)|find(?:\s|$)|rg(?:\s|$))/i;

const COMMAND_RULES: ReadonlyArray<[RiskCategory, RegExp]> = [
  ["bulk-delete", /\b(?:rm|rmdir|del|erase|Remove-Item)\b[^\n]*(?:-r|-rf|\/s|\*)/i],
  ["destructive-shell", /\b(?:rm|rmdir|del|erase|format|diskpart|mkfs|shutdown|reboot|Stop-Computer)\b/i],
  ["system-configuration", /\b(?:sudo|runas|reg(?:\.exe)?\s+(?:add|delete)|sc(?:\.exe)?\s+(?:create|delete|config)|Set-ExecutionPolicy|bcdedit|netsh)\b/i],
  ["dependency-change", /\b(?:npm|pnpm|yarn|pip|uv|cargo|dotnet)\s+(?:install|add|remove|uninstall|update|upgrade|tool\s+install)\b/i],
  ["git-external-action", /\bgit\s+(?:push|fetch|pull|clone|remote|submodule|ls-remote)\b/i],
  ["download-and-execute", /\b(?:curl|wget|Invoke-WebRequest|irm|iwr)\b[\s\S]*(?:\||&&|;)[\s\S]*\b(?:sh|bash|pwsh|powershell|cmd|node|python)\b/i],
  ["network-side-effect", /\b(?:curl|wget|Invoke-WebRequest|irm|iwr|ssh|scp|rsync)\b/i]
];

export function classifyShellCommand(command: string): RiskCategory {
  const trimmed = command.trim();
  for (const [category, pattern] of COMMAND_RULES) {
    if (pattern.test(trimmed)) return category;
  }
  return SAFE_READ_COMMAND.test(trimmed) ? "workspace-read" : "ambiguous-command";
}

export function decideApproval(
  intent: ToolIntent,
  trust: WorkspaceTrust,
  mode: ApprovalMode
): ApprovalDecision {
  if (trust !== "trusted") {
    return {
      allow: false,
      approvalRequired: false,
      reason: "Workspace is not trusted."
    };
  }

  if (intent.category === "workspace-read") {
    return { allow: true, approvalRequired: false, reason: "Read-only workspace action." };
  }

  if (mode === "balanced" && intent.category === "workspace-write") {
    return { allow: true, approvalRequired: false, reason: "Workspace-local write in balanced mode." };
  }

  return {
    allow: false,
    approvalRequired: true,
    reason: riskLabel(intent.category)
  };
}

export function riskLabel(category: RiskCategory): string {
  const labels: Record<RiskCategory, string> = {
    "workspace-read": "读取工作区内容",
    "workspace-write": "修改工作区文件",
    "external-path": "访问工作区之外的路径",
    "bulk-delete": "批量删除文件或目录",
    "destructive-shell": "执行可能破坏数据的命令",
    "system-configuration": "修改系统配置",
    "dependency-change": "安装、删除或更新依赖",
    "git-external-action": "访问或修改远程 Git 状态",
    "download-and-execute": "下载后立即执行内容",
    "network-side-effect": "执行外部网络操作",
    "ambiguous-command": "执行无法安全分类的命令"
  };
  return labels[category];
}
