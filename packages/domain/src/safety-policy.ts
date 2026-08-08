import type { ApprovalMode, WorkspaceTrust } from "./runtime-state.js";
import { parseBoundedShellCommand, type ParsedShellCommand } from "./shell-command-parser.js";

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

const FALLBACK_COMMAND_RULES: ReadonlyArray<[RiskCategory, RegExp]> = [
  ["bulk-delete", /\b(?:rm|rmdir|del|erase|Remove-Item)\b[^\n]*(?:-r|-rf|\/s|\*)/i],
  ["destructive-shell", /\b(?:rm|rmdir|del|erase|format|diskpart|mkfs|shutdown|reboot|Stop-Computer)\b/i],
  ["system-configuration", /\b(?:sudo|runas|reg(?:\.exe)?\s+(?:add|delete)|sc(?:\.exe)?\s+(?:create|delete|config)|Set-ExecutionPolicy|bcdedit|netsh)\b/i],
  ["dependency-change", /\b(?:npm|pnpm|yarn|pip|uv|cargo|dotnet)\s+(?:install|add|remove|uninstall|update|upgrade|ci|tool\s+install)\b/i],
  ["git-external-action", /\bgit\s+(?:push|fetch|pull|clone|remote|submodule|ls-remote)\b/i],
  ["download-and-execute", /\b(?:curl|wget|Invoke-WebRequest|irm|iwr)\b[\s\S]*(?:\||&&|;)[\s\S]*\b(?:sh|bash|pwsh|powershell|cmd|node|python)\b/i],
  ["network-side-effect", /\b(?:curl|wget|Invoke-WebRequest|irm|iwr|ssh|scp|rsync)\b/i]
];

const EXTERNAL_PATH_TOKEN_PATTERN = /^(?:file:|~|\/|\\\\|[a-z]:[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)/iu;
const READ_ONLY_COMMANDS = new Set([
  "pwd", "ls", "cat", "rg", "grep", "find", "head", "tail", "wc", "file", "stat", "du", "diff",
  "sort", "uniq", "sed", "jq", "tree", "realpath", "readlink", "nl", "cut", "tr", "cmp", "basename",
  "dirname", "shasum", "sha256sum", "printf", "echo"
]);
const READ_ONLY_GIT_COMMANDS = new Set([
  "status", "diff", "log", "show", "rev-parse", "ls-files", "grep", "describe"
]);
const PROJECT_SCRIPT_PATTERN = /^(?:check|test|typecheck|lint|build)(?::[a-z0-9:_-]+)?$/iu;
const ENVIRONMENT_ASSIGNMENT_PATTERN = /^([a-z_][a-z0-9_]*)=(.*)$/iu;
const SAFE_ENVIRONMENT_VARIABLES = new Set(["CI", "FORCE_COLOR", "NO_COLOR"]);
const DEPENDENCY_ACTIONS = new Set([
  "install", "add", "remove", "uninstall", "update", "upgrade", "ci", "link", "unlink", "rebuild",
  "prune", "dedupe", "import", "patch", "patch-commit"
]);
const GIT_EXTERNAL_ACTIONS = new Set(["push", "fetch", "pull", "clone", "remote", "submodule", "ls-remote"]);
const SYSTEM_COMMANDS = new Set([
  "sudo", "runas", "format", "diskpart", "mkfs", "shutdown", "reboot", "stop-computer", "bcdedit", "netsh",
  "chmod", "chown", "launchctl", "systemctl"
]);
const NETWORK_COMMANDS = new Set([
  "curl", "wget", "invoke-webrequest", "irm", "iwr", "ssh", "scp", "rsync"
]);
const SHELL_INTERPRETERS = new Set(["sh", "bash", "pwsh", "powershell", "cmd", "node", "python", "python3"]);

export function classifyShellCommand(command: string): RiskCategory {
  const trimmed = command.trim();
  const parsed = parseBoundedShellCommand(trimmed);
  if (!parsed) return classifyFallbackRisk(trimmed) ?? "ambiguous-command";
  if (isDownloadAndExecute(parsed)) return "download-and-execute";
  for (const tokens of parsed.commands) {
    const category = classifyCommandRisk(tokens);
    if (category) return category;
  }
  if (parsed.commands.some(hasExternalPathToken)) return "external-path";
  if (parsed.commands.every((tokens, index) => isWorkspaceCommandSegment(parsed, tokens, index))) {
    return "workspace-command";
  }
  return "ambiguous-command";
}

export function isPlanModeReadOnlyShellCommand(command: string): boolean {
  const parsed = parseBoundedShellCommand(command.trim());
  if (!parsed || parsed.commands.some(hasExternalPathToken)) return false;
  return parsed.commands.every((tokens, index) => isPlanModeReadOnlySegment(parsed, tokens, index));
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

function isWorkspaceCommandSegment(
  parsed: ParsedShellCommand,
  originalTokens: readonly string[],
  index: number
): boolean {
  const tokens = stripSafeEnvironmentAssignments(originalTokens);
  if (!tokens) return false;
  const executable = executableName(tokens[0] ?? "");
  if (executable === "cd") return isSafeDirectoryChange(parsed, tokens, index);
  if (isVersionInspection(executable, tokens.slice(1))) return true;
  if (executable === "command") return tokens.length === 3 && tokens[1] === "-v";
  if (READ_ONLY_COMMANDS.has(executable)) return hasSafeReadOnlyArguments(executable, tokens.slice(1));
  if (executable === "git") return hasSafeGitArguments(tokens.slice(1));
  if (["corepack", "pnpm", "npm", "yarn"].includes(executable)) return isProjectManagerCommand(tokens);
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

function isPlanModeReadOnlySegment(
  parsed: ParsedShellCommand,
  originalTokens: readonly string[],
  index: number
): boolean {
  const tokens = stripSafeEnvironmentAssignments(originalTokens);
  if (!tokens) return false;
  const executable = executableName(tokens[0] ?? "");
  if (executable === "cd") return isSafeDirectoryChange(parsed, tokens, index);
  if (isVersionInspection(executable, tokens.slice(1))) return true;
  if (executable === "command") return tokens.length === 3 && tokens[1] === "-v";
  if (READ_ONLY_COMMANDS.has(executable)) return hasSafeReadOnlyArguments(executable, tokens.slice(1));
  return executable === "git" && hasSafeGitArguments(tokens.slice(1));
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
      || arg === "--follow"
      || arg === "-L"
      || (command === "grep" && (arg === "-R" || arg === "--dereference-recursive"))
    ));
  }
  if (command === "find") {
    const writeOrExecuteActions = [
      "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"
    ];
    return !args.some((arg) => writeOrExecuteActions.some((action) => (
      arg === action || arg.startsWith(`${action}=`)
    ))) && !args.includes("-L");
  }
  if (command === "du" && args.some((arg) => ["-H", "-L", "--dereference", "--dereference-args"].includes(arg))) {
    return false;
  }
  if (command === "sort" && args.some((arg) => (
    arg === "-o" || arg.startsWith("--output") || arg === "--compress-program" || arg.startsWith("--compress-program=")
  ))) return false;
  if (command === "file" && args.some((arg) => ["-C", "--compile"].includes(arg))) return false;
  if (command === "uniq") {
    return args.filter((arg) => !arg.startsWith("-")).length <= 1;
  }
  if (command === "sed") return isSafeSedCommand(args);
  if (command === "tree") {
    return !args.some((arg) => arg === "-l" || arg === "-o" || arg.startsWith("--output="));
  }
  return true;
}

function isVersionInspection(executable: string, args: readonly string[]): boolean {
  if (!["node", "npm", "pnpm", "yarn", "corepack", "git", "python", "python3", "cargo", "dotnet", "tsc"].includes(executable)) {
    return executable === "go" && args.length === 1 && args[0] === "version";
  }
  return args.length === 1 && ["--version", "-v", "-V", "--info"].includes(args[0] ?? "");
}

function isSafeSedCommand(args: readonly string[]): boolean {
  if (args.length < 2 || !["-n", "--quiet", "--silent"].includes(args[0] ?? "")) return false;
  const expression = args[1] ?? "";
  return /^\d+(?:,(?:\d+|\$))?p$/u.test(expression)
    && args.slice(2).every((arg) => arg !== "-" && !arg.startsWith("-"));
}

function hasSafeGitArguments(args: readonly string[]): boolean {
  const subcommand = args[0] ?? "";
  if (READ_ONLY_GIT_COMMANDS.has(subcommand)) {
    return !args.slice(1).some((arg) => (
      arg === "--ext-diff"
      || arg === "--textconv"
      || arg === "--open-files-in-pager"
      || arg.startsWith("--open-files-in-pager=")
      || arg === "-O"
      || arg === "--output"
      || arg.startsWith("--output=")
    ));
  }
  if (subcommand !== "branch") return false;
  const branchArgs = args.slice(1);
  if (branchArgs.length === 0) return true;
  if (branchArgs.length === 1) {
    return ["--show-current", "--list", "-l", "--all", "-a", "--remotes", "-r", "-v", "-vv"].includes(
      branchArgs[0] ?? ""
    );
  }
  return ["--list", "-l"].includes(branchArgs[0] ?? "")
    && branchArgs.slice(1).every((arg) => !arg.startsWith("-"));
}

function isProjectManagerCommand(originalTokens: readonly string[]): boolean {
  const tokens = originalTokens[0] === "corepack" ? originalTokens.slice(1) : originalTokens;
  const manager = tokens[0];
  if (manager !== "pnpm" && manager !== "npm" && manager !== "yarn") return false;
  if (tokens.length === 2 && ["--version", "-v", "-V"].includes(tokens[1] ?? "")) return true;
  let index = 1;
  while (index < tokens.length) {
    const option = tokens[index] ?? "";
    if (["-r", "--recursive", "-w", "--workspace-root", "--if-present", "--stream", "--parallel", "-s", "--silent"].includes(option)) {
      index += 1;
      continue;
    }
    if (option === "--filter") {
      if (!tokens[index + 1]) return false;
      index += 2;
      continue;
    }
    if (option.startsWith("--filter=")) {
      index += 1;
      continue;
    }
    break;
  }
  const action = tokens[index];
  if (action === "exec") return isSafePackageRunner(tokens.slice(index + 1));
  if (action === "run") {
    index += 1;
    while (["-s", "--silent", "--if-present"].includes(tokens[index] ?? "")) index += 1;
  }
  const script = tokens[index];
  return typeof script === "string"
    && PROJECT_SCRIPT_PATTERN.test(script)
    && !hasMutatingRunnerFlag(tokens.slice(index + 1));
}

function isSafePackageRunner(tokens: readonly string[]): boolean {
  const runner = executableName(tokens[0] ?? "");
  const args = tokens.slice(1);
  if (runner === "vitest") {
    return args[0] === "run" && !args.some((arg) => arg === "-u" || arg === "--update");
  }
  if (runner === "tsc") return args.includes("--noEmit") && !args.includes("--watch");
  if (runner === "oxlint" || runner === "eslint") {
    return !args.some((arg) => arg === "--fix" || arg === "--fix-dangerously");
  }
  if (runner === "knip") return true;
  if (runner === "playwright") {
    return args[0] === "test" && !args.some((arg) => arg.startsWith("--update-snapshots"));
  }
  return runner === "prettier" && args.includes("--check");
}

function hasMutatingRunnerFlag(args: readonly string[]): boolean {
  return args.some((arg) => (
    arg === "-u"
    || arg === "--update"
    || arg === "--fix"
    || arg === "--fix-dangerously"
    || arg.startsWith("--update-snapshots")
  ));
}

function stripSafeEnvironmentAssignments(tokens: readonly string[]): readonly string[] | undefined {
  let index = 0;
  while (index < tokens.length) {
    const match = ENVIRONMENT_ASSIGNMENT_PATTERN.exec(tokens[index] ?? "");
    if (!match) break;
    if (!SAFE_ENVIRONMENT_VARIABLES.has((match[1] ?? "").toUpperCase())) return undefined;
    index += 1;
  }
  return index === tokens.length ? undefined : tokens.slice(index);
}

function isSafeDirectoryChange(parsed: ParsedShellCommand, tokens: readonly string[], index: number): boolean {
  if (tokens.length !== 2) return false;
  const directory = tokens[1] ?? "";
  if (!directory || directory === "-" || directory.startsWith("-")) return false;
  return parsed.operators[index] === "and" && parsed.operators[index - 1] !== "pipe";
}

function classifyCommandRisk(originalTokens: readonly string[]): RiskCategory | undefined {
  const tokens = stripEnvironmentAssignments(originalTokens);
  const executable = executableName(tokens[0] ?? "");
  const args = tokens.slice(1);
  if (["rm", "rmdir", "del", "erase", "remove-item"].includes(executable)) {
    return args.some((arg) => /^(?:-[a-z]*r[a-z]*|\/s)$/iu.test(arg) || arg.includes("*"))
      ? "bulk-delete"
      : "destructive-shell";
  }
  if (executable === "find" && args.some((arg) => arg === "-delete")) return "destructive-shell";
  if (SYSTEM_COMMANDS.has(executable)) return "system-configuration";
  if (executable === "reg" || executable === "reg.exe" || executable === "sc" || executable === "sc.exe") {
    if (args.some((arg) => ["add", "delete", "create", "config"].includes(arg.toLowerCase()))) {
      return "system-configuration";
    }
  }
  const managerTokens = executable === "corepack" ? args : tokens;
  const manager = executableName(managerTokens[0] ?? "");
  if (["npm", "pnpm", "yarn", "pip", "uv", "cargo", "dotnet"].includes(manager)) {
    const managerArgs = managerTokens.slice(1).map((arg) => arg.toLowerCase());
    if (managerArgs.some((arg) => DEPENDENCY_ACTIONS.has(arg))) return "dependency-change";
    if (managerArgs.includes("audit") && managerArgs.includes("fix")) return "dependency-change";
    if (managerArgs.includes("tool") && managerArgs.includes("install")) return "dependency-change";
  }
  if (executable === "git" && GIT_EXTERNAL_ACTIONS.has((args[0] ?? "").toLowerCase())) {
    return "git-external-action";
  }
  if (NETWORK_COMMANDS.has(executable)) return "network-side-effect";
  return undefined;
}

function isDownloadAndExecute(parsed: ParsedShellCommand): boolean {
  const executables = parsed.commands.map((tokens) => executableName(stripEnvironmentAssignments(tokens)[0] ?? ""));
  return executables.some((executable, index) => (
    NETWORK_COMMANDS.has(executable)
    && parsed.operators[index] !== undefined
    && executables.slice(index + 1).some((candidate) => SHELL_INTERPRETERS.has(candidate))
  ));
}

function hasExternalPathToken(tokens: readonly string[]): boolean {
  return tokens.some((token) => {
    const optionValueIndex = token.indexOf("=");
    const candidates = optionValueIndex > 0 ? [token, token.slice(optionValueIndex + 1)] : [token];
    return candidates.some((candidate) => EXTERNAL_PATH_TOKEN_PATTERN.test(candidate));
  });
}

function stripEnvironmentAssignments(tokens: readonly string[]): readonly string[] {
  const index = tokens.findIndex((token) => !ENVIRONMENT_ASSIGNMENT_PATTERN.test(token));
  return index < 0 ? [] : tokens.slice(index);
}

function classifyFallbackRisk(command: string): RiskCategory | undefined {
  for (const [category, pattern] of FALLBACK_COMMAND_RULES) {
    if (pattern.test(command)) return category;
  }
  return undefined;
}

function executableName(value: string): string {
  return value.replaceAll("\\", "/").split("/").pop()?.toLocaleLowerCase() ?? "";
}
