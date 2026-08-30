import type { ApprovalMode, WorkspaceTrust } from "./runtime-state.js";
import { parseBoundedShellCommand, type ParsedShellCommand } from "./shell-command-parser.js";
import {
  classifyCommandRisk,
  classifyFallbackRisk,
  isDownloadAndExecute
} from "./shell-command-risk.js";

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
  | "external-delete"
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

export interface ShellCommandClassificationOptions {
  verifiedWorkspacePaths?: ReadonlySet<string>;
}

const HARD_STOP_RISK_CATEGORIES: ReadonlySet<RiskCategory> = new Set([
  "bulk-delete",
  "destructive-shell",
  "persistent-state-delete",
  "external-delete"
]);

const EXTERNAL_PATH_TOKEN_PATTERN = /^(?:file:|~|\/|\\\\|[a-z]:[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)/iu;
const READ_ONLY_COMMANDS = new Set([
  "pwd", "ls", "cat", "rg", "grep", "find", "head", "tail", "wc", "file", "stat", "du", "diff",
  "sort", "uniq", "sed", "jq", "tree", "realpath", "readlink", "nl", "cut", "tr", "cmp", "basename",
  "dirname", "shasum", "sha256sum", "printf", "echo"
]);
const READ_ONLY_GIT_COMMANDS = new Set([
  "status", "diff", "log", "show", "rev-parse", "ls-files", "grep", "describe"
]);
const PROJECT_SCRIPT_PATTERN = /^(?:check|test|typecheck|lint|build|dev|start|format|generate|codegen)(?::[a-z0-9:_-]+)?$/iu;
const ENVIRONMENT_ASSIGNMENT_PATTERN = /^([a-z_][a-z0-9_]*)=(.*)$/iu;
const SAFE_ENVIRONMENT_VARIABLES = new Set(["CI", "FORCE_COLOR", "NO_COLOR"]);
export function classifyShellCommand(
  command: string,
  options: ShellCommandClassificationOptions = {}
): RiskCategory {
  const trimmed = command.trim();
  const parsed = parseBoundedShellCommand(trimmed);
  if (!parsed) return classifyFallbackRisk(trimmed) ?? "ambiguous-command";
  if (isDownloadAndExecute(parsed)) return "download-and-execute";
  const commandRisks = parsed.commands.map(classifyCommandRisk).filter((category) => category !== undefined);
  const hardStopRisk = commandRisks.find(isHardStopRiskCategory);
  if (hardStopRisk) return hardStopRisk;
  const externalPaths = externalPathTokens(parsed.commands);
  if (externalPaths.some((path) => !options.verifiedWorkspacePaths?.has(path))) return "external-path";
  const commandRisk = commandRisks[0];
  if (commandRisk) return commandRisk;
  if (parsed.commands.every((tokens, index) => isWorkspaceCommandSegment(parsed, tokens, index))) {
    return "workspace-command";
  }
  const fallbackRisk = classifyFallbackRisk(trimmed);
  if (fallbackRisk && isHardStopRiskCategory(fallbackRisk)) return fallbackRisk;
  return "ambiguous-command";
}

export function isHardStopRiskCategory(category: RiskCategory): boolean {
  return HARD_STOP_RISK_CATEGORIES.has(category);
}

export function shellCommandExternalPaths(command: string): readonly string[] | undefined {
  const parsed = parseBoundedShellCommand(command.trim());
  return parsed ? externalPathTokens(parsed.commands) : undefined;
}

export function isPlanModeReadOnlyShellCommand(command: string): boolean {
  const parsed = parseBoundedShellCommand(command.trim());
  if (!parsed || externalPathTokens(parsed.commands).length > 0) return false;
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

  if (isHardStopRiskCategory(intent.category)) {
    return {
      allow: false,
      approvalRequired: true,
      reason: riskLabel(intent.category)
    };
  }

  if (
    mode === "balanced"
    && intent.toolName.toLowerCase() === "bash"
    && intent.category === "ambiguous-command"
  ) {
    return {
      allow: false,
      approvalRequired: false,
      reason: "AUTO 无法可靠判断这条 Shell 命令的副作用；请拆成较小的原生 Tool Call 或明确切换到 YOLO。"
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

  if (mode === "balanced" && intent.category === "dependency-change") {
    return { allow: true, approvalRequired: false, reason: "Workspace-local dependency change in balanced mode." };
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
    "external-delete": "删除外部持久化对象",
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

function externalPathTokens(commands: readonly (readonly string[])[]): string[] {
  return [...new Set(commands.flatMap((tokens) => tokens.flatMap((token) => {
    const optionValueIndex = token.indexOf("=");
    const candidates = optionValueIndex > 0 ? [token, token.slice(optionValueIndex + 1)] : [token];
    return candidates.filter((candidate) => EXTERNAL_PATH_TOKEN_PATTERN.test(candidate));
  })))];
}

function executableName(value: string): string {
  return value.replaceAll("\\", "/").split("/").pop()?.toLocaleLowerCase() ?? "";
}
