import type { ParsedShellCommand } from "./shell-command-parser.js";
import type { RiskCategory } from "./safety-policy.js";

const FALLBACK_COMMAND_RULES: ReadonlyArray<[RiskCategory, RegExp]> = [
  ["bulk-delete", /\b(?:rm|rmdir|del|erase|Remove-Item)\b[^\n]*(?:-r|-rf|\/s|\*)/i],
  ["destructive-shell", /\b(?:rm|rmdir|del|erase|format|diskpart|mkfs|shutdown|reboot|Stop-Computer)\b/i],
  ["system-configuration", /\b(?:sudo|runas|reg(?:\.exe)?\s+(?:add|delete)|sc(?:\.exe)?\s+(?:create|delete|config)|Set-ExecutionPolicy|bcdedit|netsh)\b/i],
  ["dependency-change", /\b(?:npm|pnpm|yarn|pip|uv|cargo|dotnet)\s+(?:install|add|remove|uninstall|update|upgrade|ci|tool\s+install)\b/i],
  ["git-external-action", /\bgit\s+(?:push|fetch|pull|clone|remote|submodule|ls-remote)\b/i],
  ["download-and-execute", /\b(?:curl|wget|Invoke-WebRequest|irm|iwr)\b[\s\S]*(?:\||&&|;)[\s\S]*\b(?:sh|bash|pwsh|powershell|cmd|node|python)\b/i],
  ["network-side-effect", /\b(?:curl|wget|Invoke-WebRequest|irm|iwr|ssh|scp|rsync)\b/i]
];
const DEPENDENCY_ACTIONS = new Set([
  "install", "add", "remove", "uninstall", "update", "upgrade", "ci", "link", "unlink", "rebuild",
  "prune", "dedupe", "import", "patch", "patch-commit"
]);
const SYSTEM_COMMANDS = new Set([
  "sudo", "runas", "format", "diskpart", "mkfs", "shutdown", "reboot", "stop-computer", "bcdedit", "netsh",
  "chmod", "chown", "launchctl", "systemctl"
]);
const DESTRUCTIVE_SYSTEM_COMMANDS = new Set([
  "format", "diskpart", "mkfs", "shutdown", "reboot", "stop-computer"
]);
const NETWORK_COMMANDS = new Set([
  "curl", "wget", "invoke-webrequest", "irm", "iwr", "ssh", "scp", "rsync"
]);
const SHELL_INTERPRETERS = new Set(["sh", "bash", "pwsh", "powershell", "cmd", "node", "python", "python3"]);
const ENVIRONMENT_ASSIGNMENT_PATTERN = /^([a-z_][a-z0-9_]*)=(.*)$/iu;

export function classifyCommandRisk(originalTokens: readonly string[]): RiskCategory | undefined {
  const tokens = stripEnvironmentAssignments(originalTokens);
  const executable = executableName(tokens[0] ?? "");
  const args = tokens.slice(1);
  if (["rm", "rmdir", "del", "erase", "remove-item"].includes(executable)) {
    return args.some((arg) => /^(?:-[a-z]*r[a-z]*|\/s)$/iu.test(arg) || arg.includes("*"))
      ? "bulk-delete"
      : "destructive-shell";
  }
  if (executable === "find" && args.some((arg) => arg === "-delete")) return "destructive-shell";
  if (executable === "git") return classifyGitCommandRisk(args);
  if (DESTRUCTIVE_SYSTEM_COMMANDS.has(executable)) return "destructive-shell";
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
    if (
      managerArgs.some((arg) => DEPENDENCY_ACTIONS.has(arg))
      || (managerArgs.includes("audit") && managerArgs.includes("fix"))
      || (managerArgs.includes("tool") && managerArgs.includes("install"))
    ) {
      return isGlobalDependencyChange(manager, managerArgs)
        ? "system-configuration"
        : "dependency-change";
    }
  }
  if (NETWORK_COMMANDS.has(executable)) return "network-side-effect";
  return undefined;
}

export function isDownloadAndExecute(parsed: ParsedShellCommand): boolean {
  const executables = parsed.commands.map((tokens) => executableName(stripEnvironmentAssignments(tokens)[0] ?? ""));
  return executables.some((executable, index) => (
    NETWORK_COMMANDS.has(executable)
    && parsed.operators[index] !== undefined
    && executables.slice(index + 1).some((candidate) => SHELL_INTERPRETERS.has(candidate))
  ));
}

export function classifyFallbackRisk(command: string): RiskCategory | undefined {
  for (const [category, pattern] of FALLBACK_COMMAND_RULES) {
    if (pattern.test(command)) return category;
  }
  return undefined;
}

function classifyGitCommandRisk(args: readonly string[]): RiskCategory | undefined {
  const subcommand = (args[0] ?? "").toLowerCase();
  const options = args.slice(1).map((arg) => arg.toLowerCase());
  if (subcommand === "rm" || subcommand === "clean") return "destructive-shell";
  if (subcommand === "reset" && options.includes("--hard")) return "destructive-shell";
  if (subcommand === "restore" && !options.includes("--staged")) return "destructive-shell";
  if (
    (subcommand === "checkout" && (options.includes("--") || options.includes("-f") || options.includes("--force")))
    || (subcommand === "switch" && (options.includes("-f") || options.includes("--force") || options.includes("--discard-changes")))
    || (subcommand === "branch" && options.some((arg) => arg === "-d" || arg === "--delete"))
    || (subcommand === "tag" && options.some((arg) => arg === "-d" || arg === "--delete"))
    || (subcommand === "stash" && options.some((arg) => arg === "drop" || arg === "clear"))
    || (subcommand === "worktree" && options.some((arg) => arg === "remove" || arg === "prune"))
    || (subcommand === "submodule" && options.includes("deinit"))
  ) return "destructive-shell";
  if (subcommand === "push") {
    return options.some((arg) => (
      arg === "-f"
      || arg === "--force"
      || arg.startsWith("--force-with-lease")
      || arg === "-d"
      || arg === "--delete"
      || arg.startsWith(":")
    )) ? "destructive-shell" : "git-external-action";
  }
  if ([
    "add", "commit", "switch", "checkout", "restore", "merge", "rebase", "cherry-pick", "revert",
    "reset", "branch", "tag", "stash", "worktree", "fetch", "pull", "clone", "remote", "submodule",
    "ls-remote"
  ].includes(subcommand)) return "workspace-command";
  return undefined;
}

function isGlobalDependencyChange(manager: string, args: readonly string[]): boolean {
  if (args.some((arg) => arg === "-g" || arg === "--global" || arg === "--user")) return true;
  if (manager === "pip") return true;
  if (manager === "yarn" && args[0] === "global") return true;
  if (manager === "uv" && args.includes("tool")) return true;
  if (manager === "cargo" && (args.includes("install") || args.includes("uninstall"))) return true;
  return manager === "dotnet" && args.includes("tool");
}

function stripEnvironmentAssignments(tokens: readonly string[]): readonly string[] {
  const index = tokens.findIndex((token) => !ENVIRONMENT_ASSIGNMENT_PATTERN.test(token));
  return index < 0 ? [] : tokens.slice(index);
}

function executableName(value: string): string {
  return value.replaceAll("\\", "/").split("/").pop()?.toLocaleLowerCase() ?? "";
}
