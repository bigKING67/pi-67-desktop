export type DesktopActionId =
  | "settings"
  | "command-palette"
  | "new-session"
  | "toggle-navigation"
  | "toggle-context"
  | "find-current-conversation"
  | "find-workspace-conversations"
  | "find-workspace-content"
  | "keyboard-shortcuts";

export interface DesktopShortcutBinding {
  key: string;
  shift?: boolean;
  alt?: boolean;
}

export type DesktopShortcutContext =
  | "workspaceOpen"
  | "composerFocus"
  | "dialogOpen"
  | "settingsOpen"
  | "fileEditorFocus"
  | "taskRunning"
  | "taskIdle";

export interface DesktopActionDescriptor {
  id: DesktopActionId;
  label: string;
  detail: string;
  keywords: string;
  requiresWorkspace: boolean;
  contexts: readonly DesktopShortcutContext[];
  bindings: readonly DesktopShortcutBinding[];
}

export const DESKTOP_ACTIONS: readonly DesktopActionDescriptor[] = [
  {
    id: "settings",
    label: "打开设置",
    detail: "管理应用、模型、Pi 与支持选项",
    keywords: "settings preferences 配置 设置",
    requiresWorkspace: false,
    contexts: [
      "workspaceOpen",
      "composerFocus",
      "dialogOpen",
      "settingsOpen",
      "fileEditorFocus",
      "taskRunning",
      "taskIdle"
    ],
    bindings: [{ key: "," }]
  },
  {
    id: "command-palette",
    label: "打开命令面板",
    detail: "搜索会话、Pi 操作和应用命令",
    keywords: "command palette 命令 面板",
    requiresWorkspace: false,
    contexts: [
      "workspaceOpen",
      "composerFocus",
      "settingsOpen",
      "fileEditorFocus",
      "taskRunning",
      "taskIdle"
    ],
    bindings: [{ key: "k" }]
  },
  {
    id: "new-session",
    label: "新建会话",
    detail: "在当前工作区创建一个待发送的会话",
    keywords: "new session conversation 新建 会话",
    requiresWorkspace: true,
    contexts: ["workspaceOpen", "composerFocus", "fileEditorFocus", "taskRunning", "taskIdle"],
    bindings: [{ key: "n" }, { key: "t" }]
  },
  {
    id: "toggle-navigation",
    label: "显示或隐藏会话导航",
    detail: "切换左侧工作区与会话列表",
    keywords: "navigation sidebar left 侧栏 导航",
    requiresWorkspace: true,
    contexts: ["workspaceOpen", "composerFocus", "fileEditorFocus", "taskRunning", "taskIdle"],
    bindings: [{ key: "b" }]
  },
  {
    id: "toggle-context",
    label: "显示或隐藏任务检查器",
    detail: "切换右侧文件、Changes 与上下文面板",
    keywords: "context inspector right 任务 检查器",
    requiresWorkspace: true,
    contexts: ["workspaceOpen", "composerFocus", "fileEditorFocus", "taskRunning", "taskIdle"],
    bindings: [{ key: "b", shift: true }]
  },
  {
    id: "find-current-conversation",
    label: "查找当前对话正文",
    detail: "只查找当前 Pi 会话的可见正文",
    keywords: "find search current message 查找 当前 对话",
    requiresWorkspace: true,
    contexts: ["workspaceOpen", "composerFocus", "taskRunning", "taskIdle"],
    bindings: [{ key: "f" }]
  },
  {
    id: "find-workspace-conversations",
    label: "查找工作区对话正文",
    detail: "跨当前工作区的 Pi JSONL 会话查找正文",
    keywords: "find search workspace messages 查找 工作区 对话",
    requiresWorkspace: true,
    contexts: ["workspaceOpen", "composerFocus", "taskRunning", "taskIdle"],
    bindings: [{ key: "f", shift: true }]
  },
  {
    id: "find-workspace-content",
    label: "在工作区文件中查找",
    detail: "在可信工作区内有界搜索文本内容并定位到行",
    keywords: "find search workspace files content 查找 工作区 文件 内容",
    requiresWorkspace: true,
    contexts: ["workspaceOpen", "composerFocus", "fileEditorFocus", "taskRunning", "taskIdle"],
    bindings: [{ key: "f", alt: true }]
  },
  {
    id: "keyboard-shortcuts",
    label: "查看键盘快捷键",
    detail: "打开 Pi-67 Desktop 快捷键帮助",
    keywords: "keyboard shortcuts help 键盘 快捷键 帮助",
    requiresWorkspace: false,
    contexts: [
      "workspaceOpen",
      "composerFocus",
      "dialogOpen",
      "settingsOpen",
      "fileEditorFocus",
      "taskRunning",
      "taskIdle"
    ],
    bindings: [{ key: "/" }]
  }
] as const;

export function desktopAction(id: DesktopActionId): DesktopActionDescriptor {
  return DESKTOP_ACTIONS.find((action) => action.id === id)!;
}

export function matchDesktopAction(
  event: KeyboardEvent,
  actions: readonly DesktopActionDescriptor[] = DESKTOP_ACTIONS
): DesktopActionDescriptor | undefined {
  if (!(event.metaKey || event.ctrlKey)) return undefined;
  const key = event.key.toLocaleLowerCase();
  return actions.find((action) => action.bindings.some((binding) => (
    binding.key === key
    && Boolean(binding.shift) === event.shiftKey
    && Boolean(binding.alt) === event.altKey
  )));
}

export function formatDesktopShortcut(
  action: DesktopActionDescriptor,
  platform: "darwin" | "win32" = currentDesktopPlatform()
): string {
  return action.bindings.map((binding) => {
    const modifier = platform === "darwin" ? "⌘" : "Ctrl+";
    const alt = binding.alt ? (platform === "darwin" ? "⌥" : "Alt+") : "";
    const shift = binding.shift ? (platform === "darwin" ? "⇧" : "Shift+") : "";
    return `${modifier}${alt}${shift}${displayKey(binding.key)}`;
  }).join(" / ");
}

export function desktopShortcutAriaKeys(action: DesktopActionDescriptor): string {
  return action.bindings.flatMap((binding) => {
    const suffix = `${binding.alt ? "Alt+" : ""}${binding.shift ? "Shift+" : ""}${ariaKey(binding.key)}`;
    return [`Control+${suffix}`, `Meta+${suffix}`];
  }).join(" ");
}

function currentDesktopPlatform(): "darwin" | "win32" {
  return document.documentElement.dataset.platform === "darwin" ? "darwin" : "win32";
}

function displayKey(key: string): string {
  if (key === ",") return ",";
  if (key === "/") return "/";
  return key.toLocaleUpperCase();
}

function ariaKey(key: string): string {
  if (key === ",") return "Comma";
  if (key === "/") return "Slash";
  return key.toLocaleUpperCase();
}
