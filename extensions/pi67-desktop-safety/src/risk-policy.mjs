import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const SAFE_SHELL = /^(?:pwd|git\s+status(?:\s+(?:--short|--porcelain(?:=v[12])?|--branch|-s|-b|--untracked-files=(?:no|normal|all)))*)$/i;

const BASH_RULES = [
  ["bulk_delete", /\b(?:rm|rmdir|del|erase|Remove-Item)\b[^\n]*(?:-r|-rf|\/s|\*)/i],
  ["destructive_shell", /\b(?:rm|rmdir|del|erase|format|diskpart|mkfs|shutdown|reboot|Stop-Computer)\b/i],
  ["system_configuration", /\b(?:sudo|runas|reg(?:\.exe)?\s+(?:add|delete)|sc(?:\.exe)?\s+(?:create|delete|config)|Set-ExecutionPolicy|bcdedit|netsh)\b/i],
  ["dependency_change", /\b(?:npm|pnpm|yarn|pip|uv|cargo|dotnet)\s+(?:install|add|remove|uninstall|update|upgrade|tool\s+install)\b/i],
  ["git_external_action", /\bgit\s+(?:push|fetch|pull|clone|remote|submodule|ls-remote)\b/i],
  ["download_and_execute", /\b(?:curl|wget|Invoke-WebRequest|irm|iwr)\b[\s\S]*(?:\||&&|;)[\s\S]*\b(?:sh|bash|pwsh|powershell|cmd|node|python)\b/i],
];

export async function classifyToolCall(event, workspace) {
  if (PATH_TOOLS.has(event.toolName)) {
    const rawPath = typeof event.input?.path === "string" && event.input.path.trim() !== ""
      ? event.input.path
      : workspace;
    const canonical = await canonicalizePotentialPath(rawPath, workspace);
    const contained = isContained(canonical, await realpath(resolve(workspace)));
    if (contained) {
      return { approvalRequired: false, category: WRITE_TOOLS.has(event.toolName) ? "workspace_write" : "workspace_read", canonicalPath: canonical };
    }
    return { approvalRequired: true, category: "external_path", canonicalPath: canonical };
  }

  if (event.toolName === "bash") {
    const command = typeof event.input?.command === "string" ? event.input.command.trim() : "";
    for (const [category, pattern] of BASH_RULES) {
      if (pattern.test(command)) return { approvalRequired: true, category, command };
    }
    if (SAFE_SHELL.test(command)) return { approvalRequired: false, category: "workspace_read", command };
    return { approvalRequired: true, category: "ambiguous_compound_command", command };
  }

  return { approvalRequired: true, category: "ambiguous_compound_command" };
}

export async function canonicalizePotentialPath(value, workspace) {
  let candidate = isAbsolute(value) ? resolve(value) : resolve(workspace, value);
  const missing = [];
  for (;;) {
    try {
      const status = await lstat(candidate);
      if (status.isSymbolicLink()) candidate = await realpath(candidate);
      else candidate = await realpath(candidate);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missing.unshift(candidate.slice(parent.length).replace(/^[/\\]+/, ""));
      candidate = parent;
    }
  }
  return resolve(candidate, ...missing);
}

export function isContained(candidate, workspace) {
  const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const normalizedWorkspace = process.platform === "win32" ? workspace.toLowerCase() : workspace;
  const pathFromWorkspace = relative(normalizedWorkspace, normalizedCandidate);
  return pathFromWorkspace === "" || (!pathFromWorkspace.startsWith(`..${sep}`) && pathFromWorkspace !== ".." && !isAbsolute(pathFromWorkspace));
}

export function describeRisk(risk) {
  const labels = {
    external_path: "访问工作区之外的路径",
    destructive_shell: "执行可能破坏数据的命令",
    system_configuration: "修改 Windows 系统配置",
    dependency_change: "安装、删除或更新依赖",
    git_external_action: "访问或修改远程 Git 状态",
    download_and_execute: "下载后立即执行内容",
    bulk_delete: "批量删除文件或目录",
    ambiguous_compound_command: "执行无法安全拆分的命令或工具",
  };
  return labels[risk.category] ?? "执行敏感操作";
}
