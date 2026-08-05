import { MAX_WORKSPACE_FILE_NAME_CHARS } from "@pi67/domain";

export type WorkspaceFileDialogMode =
  | "create-file"
  | "create-directory"
  | "rename-file"
  | "rename-directory"
  | "save-as";

export type WorkspaceFileFormat =
  | "auto"
  | "markdown"
  | "typescript"
  | "javascript"
  | "json"
  | "yaml"
  | "text";

export interface WorkspaceFileFormatOption {
  id: WorkspaceFileFormat;
  label: string;
  extension?: string;
}

export const WORKSPACE_FILE_FORMAT_OPTIONS: readonly WorkspaceFileFormatOption[] = [
  { id: "auto", label: "自动识别" },
  { id: "markdown", label: "Markdown", extension: ".md" },
  { id: "typescript", label: "TypeScript", extension: ".ts" },
  { id: "javascript", label: "JavaScript", extension: ".js" },
  { id: "json", label: "JSON", extension: ".json" },
  { id: "yaml", label: "YAML", extension: ".yaml" },
  { id: "text", label: "纯文本", extension: ".txt" }
];

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const KNOWN_EXTENSIONS: Readonly<Record<string, string>> = {
  md: "Markdown",
  markdown: "Markdown",
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  json: "JSON",
  jsonc: "JSON",
  yaml: "YAML",
  yml: "YAML",
  txt: "纯文本",
  text: "纯文本"
};

export function validateWorkspaceFileName(name: string): string | undefined {
  if (name.length === 0) return "请输入名称。";
  if (name.length > MAX_WORKSPACE_FILE_NAME_CHARS) return `名称不能超过 ${MAX_WORKSPACE_FILE_NAME_CHARS} 个字符。`;
  if (name === "." || name === "..") return "名称不能是 . 或 ..。";
  if (name.includes("/") || name.includes("\\")) return "名称不能包含 / 或 \\。";
  if (Array.from(name).some((character) => character.charCodeAt(0) <= 0x1f)) return "名称不能包含控制字符。";
  if (/[ .]$/u.test(name)) return "名称不能以点或空格结尾。";
  if (name === ".git") return "不能通过文件面板管理 .git 元数据。";
  if (WINDOWS_RESERVED_NAME.test(name)) return "该名称是 Windows 保留名称，请使用其他名称。";
  return undefined;
}

export function detectWorkspaceFileFormat(name: string): { label: string; extension?: string } {
  const extension = fileNameExtension(name);
  if (!extension) return { label: "尚未识别类型" };
  return {
    label: KNOWN_EXTENSIONS[extension] ?? "自定义格式",
    extension: `.${extension}`
  };
}

export function syncWorkspaceFileNameFormat(name: string, format: WorkspaceFileFormat): string {
  const option = WORKSPACE_FILE_FORMAT_OPTIONS.find((candidate) => candidate.id === format);
  if (!option?.extension || !name) return name;
  const dot = name.lastIndexOf(".");
  if (dot > 0) return `${name.slice(0, dot)}${option.extension}`;
  if (dot === name.length - 1) return `${name.slice(0, -1)}${option.extension}`;
  return `${name}${option.extension}`;
}

export function reconcileWorkspaceFileFormat(
  selected: WorkspaceFileFormat,
  name: string
): WorkspaceFileFormat {
  if (selected === "auto") return selected;
  const extension = fileNameExtension(name);
  if (!extension) return selected;
  const selectedExtension = WORKSPACE_FILE_FORMAT_OPTIONS
    .find((candidate) => candidate.id === selected)?.extension?.slice(1);
  return extension === selectedExtension ? selected : "auto";
}

export function workspaceFileNameSelectionEnd(name: string, mode: WorkspaceFileDialogMode): number {
  if (mode !== "rename-file" && mode !== "save-as") return name.length;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

export function workspaceFileDialogOwnsFormat(mode: WorkspaceFileDialogMode): boolean {
  return mode === "create-file";
}

export function workspaceFileDialogDescribesFormat(mode: WorkspaceFileDialogMode): boolean {
  return mode === "create-file" || mode === "rename-file" || mode === "save-as";
}

function fileNameExtension(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return name.slice(dot + 1).toLocaleLowerCase();
}
