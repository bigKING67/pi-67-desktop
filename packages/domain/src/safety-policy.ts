import type { ApprovalMode, WorkspaceTrust } from "./runtime-state.js";

export type RiskCategory =
  | "workspace-read"
  | "resource-read"
  | "workspace-write"
  | "workspace-command"
  | "capability-read"
  | "external-path"
  | "bulk-delete"
  | "destructive-shell"
  | "system-configuration"
  | "dependency-change"
  | "git-external-action"
  | "download-and-execute"
  | "network-read"
  | "network-side-effect"
  | "configured-operation"
  | "persistent-state-write"
  | "persistent-state-delete"
  | "external-submit"
  | "credential-or-auth"
  | "unverified-tool"
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

const COMMAND_RULES: ReadonlyArray<[RiskCategory, RegExp]> = [
  ["bulk-delete", /\b(?:rm|rmdir|del|erase|Remove-Item)\b[^\n]*(?:-r|-rf|\/s|\*)/i],
  ["destructive-shell", /\b(?:rm|rmdir|del|erase|format|diskpart|mkfs|shutdown|reboot|Stop-Computer)\b/i],
  ["system-configuration", /\b(?:sudo|runas|reg(?:\.exe)?\s+(?:add|delete)|sc(?:\.exe)?\s+(?:create|delete|config)|Set-ExecutionPolicy|bcdedit|netsh)\b/i],
  ["dependency-change", /\b(?:npm|pnpm|yarn|pip|uv|cargo|dotnet)\s+(?:install|add|remove|uninstall|update|upgrade|tool\s+install)\b/i],
  ["git-external-action", /\bgit\s+(?:push|fetch|pull|clone|remote|submodule|ls-remote)\b/i],
  ["download-and-execute", /\b(?:curl|wget|Invoke-WebRequest|irm|iwr)\b[\s\S]*(?:\||&&|;)[\s\S]*\b(?:sh|bash|pwsh|powershell|cmd|node|python)\b/i],
  ["network-side-effect", /\b(?:curl|wget|Invoke-WebRequest|irm|iwr|ssh|scp|rsync)\b/i]
];

const SHELL_COMPOSITION_PATTERN = /[\n\r;&|><`$()]/u;
const EXTERNAL_PATH_TOKEN_PATTERN = /^(?:~|\/|\\\\|[a-z]:[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)/iu;
const READ_ONLY_COMMANDS = new Set([
  "pwd", "ls", "rg", "grep", "find", "head", "tail", "wc", "file", "stat", "du", "diff", "sort", "uniq"
]);
const READ_ONLY_GIT_COMMANDS = new Set([
  "status", "diff", "log", "show", "rev-parse", "ls-files", "grep", "describe"
]);
const PROJECT_SCRIPT_PATTERN = /^(?:check|test|typecheck|lint|build)(?::[a-z0-9:_-]+)?$/iu;

export function classifyShellCommand(command: string): RiskCategory {
  const trimmed = command.trim();
  for (const [category, pattern] of COMMAND_RULES) {
    if (pattern.test(trimmed)) return category;
  }
  if (isWorkspaceCommand(trimmed)) return "workspace-command";
  return "ambiguous-command";
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

  if (intent.toolName.toLowerCase() === "bash" && intent.category !== "workspace-command") {
    return {
      allow: false,
      approvalRequired: true,
      reason: riskLabel(intent.category)
    };
  }

  if (intent.category === "workspace-read" || intent.category === "resource-read") {
    return { allow: true, approvalRequired: false, reason: "Read-only workspace action." };
  }

  if (intent.category === "capability-read") {
    return { allow: true, approvalRequired: false, reason: "Verified read-only capability inspection." };
  }

  if (intent.category === "network-read") {
    return { allow: true, approvalRequired: false, reason: "Verified read-only web capability." };
  }

  if (mode === "balanced" && intent.category === "workspace-write") {
    return { allow: true, approvalRequired: false, reason: "Workspace-local write in balanced mode." };
  }

  if (mode === "balanced" && intent.category === "workspace-command") {
    return { allow: true, approvalRequired: false, reason: "Bounded workspace command in balanced mode." };
  }

  if (mode === "balanced" && intent.category === "configured-operation") {
    return { allow: true, approvalRequired: false, reason: "Operation comes from an effective configured capability." };
  }

  if (mode === "balanced" && intent.category === "persistent-state-write") {
    return { allow: true, approvalRequired: false, reason: "Non-destructive persistent state write in balanced mode." };
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
    "resource-read": "读取当前会话已加载的 Pi 资源",
    "workspace-write": "修改工作区文件",
    "workspace-command": "执行工作区内的非破坏性命令",
    "capability-read": "检查当前会话已加载的工具能力",
    "external-path": "访问工作区之外的路径",
    "bulk-delete": "批量删除文件或目录",
    "destructive-shell": "执行可能破坏数据的命令",
    "system-configuration": "修改系统配置",
    "dependency-change": "安装、删除或更新依赖",
    "git-external-action": "访问或修改远程 Git 状态",
    "download-and-execute": "下载后立即执行内容",
    "network-read": "访问外部网络获取信息",
    "network-side-effect": "执行外部网络操作",
    "configured-operation": "执行当前任务已配置的工具能力",
    "persistent-state-write": "新增或更新持久化状态",
    "persistent-state-delete": "删除持久化状态",
    "external-submit": "向外部目标提交内容或操作",
    "credential-or-auth": "使用或修改凭据与授权状态",
    "unverified-tool": "工具来源或参数契约尚未验证",
    "ambiguous-command": "执行无法安全分类的命令"
  };
  return labels[category];
}

function isWorkspaceCommand(command: string): boolean {
  if (!command || SHELL_COMPOSITION_PATTERN.test(command)) return false;
  const tokens = command.split(/\s+/u);
  if (tokens.some((token) => EXTERNAL_PATH_TOKEN_PATTERN.test(stripQuotes(token)))) return false;
  const executable = executableName(tokens[0] ?? "");
  if (READ_ONLY_COMMANDS.has(executable)) return hasSafeReadOnlyArguments(executable, tokens.slice(1));
  if (executable === "git") {
    return READ_ONLY_GIT_COMMANDS.has(tokens[1] ?? "")
      && !tokens.slice(2).some((arg) => (
        arg === "--ext-diff"
        || arg === "--textconv"
        || arg === "--open-files-in-pager"
        || arg.startsWith("--open-files-in-pager=")
        || arg === "--output"
        || arg.startsWith("--output=")
      ));
  }
  if (executable === "corepack") return isProjectScriptCommand(tokens.slice(1));
  if (executable === "pnpm" || executable === "npm" || executable === "yarn") {
    return isProjectScriptCommand(tokens);
  }
  if (executable === "cargo") return ["check", "test", "build", "clippy"].includes(tokens[1] ?? "");
  if (executable === "go") return ["test", "build", "vet"].includes(tokens[1] ?? "");
  if (executable === "dotnet") return ["test", "build"].includes(tokens[1] ?? "");
  if (executable === "pytest") return true;
  if (executable === "uv") return tokens[1] === "run" && tokens[2] === "pytest";
  if (executable === "python" || executable === "python3") {
    return tokens[1] === "-m" && tokens[2] === "pytest";
  }
  return executable === "tsc" && tokens.includes("--noEmit");
}

function hasSafeReadOnlyArguments(command: string, args: readonly string[]): boolean {
  if (command === "pwd") return args.length === 0;
  if (command === "ls") return true;
  if (command === "rg" || command === "grep") {
    return !args.some((arg) => (
      arg === "--pre"
      || arg.startsWith("--pre=")
      || arg === "--hostname-bin"
      || arg.startsWith("--hostname-bin=")
    ));
  }
  if (command === "find") {
    const writeOrExecuteActions = [
      "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"
    ];
    return !args.some((arg) => writeOrExecuteActions.some((action) => (
      arg === action || arg.startsWith(`${action}=`)
    )));
  }
  if (command === "sort" && args.some((arg) => arg === "-o" || arg.startsWith("--output"))) return false;
  if (command === "uniq") {
    return args.filter((arg) => !arg.startsWith("-")).length <= 1;
  }
  return true;
}

function isProjectScriptCommand(tokens: readonly string[]): boolean {
  const commandIndex = tokens[0] === "corepack" ? 1 : 0;
  const manager = tokens[commandIndex];
  if (manager !== "pnpm" && manager !== "npm" && manager !== "yarn") return false;
  const action = tokens[commandIndex + 1];
  const script = action === "run" ? tokens[commandIndex + 2] : action;
  return typeof script === "string" && PROJECT_SCRIPT_PATTERN.test(script);
}

function executableName(value: string): string {
  return stripQuotes(value).replaceAll("\\", "/").split("/").pop()?.toLocaleLowerCase() ?? "";
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/gu, "");
}
