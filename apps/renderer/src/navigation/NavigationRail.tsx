import { FileInput, FilePlus2, FolderOpen, RefreshCw, Settings2 } from "lucide-react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { ThemeButton } from "../theme/ThemeButton.js";

export function NavigationRail() {
  const workspace = useAppStore((state) => state.workspace);
  const sessions = useAppStore((state) => state.sessions);
  const activePath = useAppStore((state) => state.snapshot?.sessionPath);
  const snapshot = useAppStore((state) => state.snapshot);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const openWorkspace = useAppStore((state) => state.openWorkspace);
  const createSession = useAppStore((state) => state.createSession);
  const openSession = useAppStore((state) => state.openSession);
  const importSessionFile = useAppStore((state) => state.importSessionFile);
  const refreshSessions = useAppStore((state) => state.refreshSessions);
  const saveDiagnostics = useAppStore((state) => state.saveDiagnostics);

  return (
    <aside className="navigation-rail">
      <div className="workspace-switcher">
        <div>
          <span className="section-label">工作区</span>
          <strong title={workspace}>{basename(workspace ?? "")}</strong>
        </div>
        <Button className="icon-button" aria-label="切换工作区" onPress={() => void openWorkspace()}><FolderOpen size={15} /></Button>
      </div>
      <div className="navigation-heading">
        <span className="section-label">会话</span>
        <div>
          <Button className="icon-button" aria-label="刷新会话" isDisabled={sessionTransitionPending} onPress={() => void refreshSessions()}><RefreshCw size={14} /></Button>
          <Button className="icon-button" aria-label="导入 Pi session 到当前工作区" isDisabled={sessionTransitionPending} onPress={() => void importSessionFile()}><FileInput size={14} /></Button>
          <Button className="icon-button" aria-label="新建会话" isDisabled={sessionTransitionPending} onPress={() => void createSession()}><FilePlus2 size={15} /></Button>
        </div>
      </div>
      <nav className="session-list" aria-label="Pi sessions">
        {sessions.length === 0 ? <p className="navigation-empty">还没有保存的 Pi 会话。</p> : null}
        {sessions.map((session) => (
          <button
            type="button"
            className={`session-item ${session.path === activePath ? "is-active" : ""}`}
            disabled={sessionTransitionPending}
            key={session.path}
            onClick={() => void openSession(session.path)}
          >
            <span>{session.name}</span>
            <small>{session.messageCount} 条 · {formatRelative(session.modifiedAt)}</small>
          </button>
        ))}
      </nav>
      <footer className="navigation-footer">
        <div className="runtime-summary">
          <span>{snapshot?.models.filter((model) => model.configured).length ?? 0} 个可用模型</span>
          <span>{snapshot?.resources.length ?? 0} 个资源</span>
        </div>
        <ThemeButton variant="navigation" />
        <Button className="navigation-action" onPress={() => void saveDiagnostics()}>
          <Settings2 size={15} /> 导出脱敏诊断
        </Button>
      </footer>
    </aside>
  );
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function formatRelative(timestamp: number): string {
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(timestamp);
}
