import { useEffect } from "react";
import { CommandPalette } from "../command-palette/CommandPalette.js";
import { Composer } from "../composer/Composer.js";
import { ContextPane } from "../context/ContextPane.js";
import { DoctorDialog } from "../doctor/DoctorDialog.js";
import { ExtensionDialog } from "../extension-ui/ExtensionDialog.js";
import { NavigationRail } from "../navigation/NavigationRail.js";
import { TitleBar } from "../shell/TitleBar.js";
import { CredentialDialog } from "../settings/CredentialDialog.js";
import { Transcript } from "../transcript/Transcript.js";
import { UpdateDialog } from "../updates/UpdateDialog.js";
import { TrustBanner } from "../workspace/TrustBanner.js";
import { Welcome } from "../workspace/Welcome.js";
import { subscribeToAgentConnections } from "../bridge/agent-connection.js";
import { useAppStore } from "./app-store.js";

export function App() {
  const workspace = useAppStore((state) => state.workspace);
  const contextVisible = useAppStore((state) => state.contextVisible);
  const setClient = useAppStore((state) => state.setClient);
  const notices = useAppStore((state) => state.notices);
  const dismissNotice = useAppStore((state) => state.dismissNotice);

  useEffect(() => {
    return subscribeToAgentConnections(setClient);
  }, [setClient]);

  useEffect(() => window.pi67.system.onAgentHostFailed((state) => {
    useAppStore.setState((current) => ({
      connected: false,
      credentialDialogOpen: false,
      notices: [
        ...current.notices.slice(-2),
        {
          id: `agent-host-restart-${Date.now()}`,
          level: "warning",
          message: "Agent Host 已退出；任何仅在本次运行内存中的 Provider API key 均已清除。"
        }
      ],
      runtime: {
        phase: state.recoverable ? "recovering" : "failed",
        detail: state.recoverable
          ? `Agent Host 已退出，正在进行第 ${state.attempt ?? 1} 次恢复`
          : "Agent Host 连续退出，自动恢复已停止",
        recoverable: state.recoverable,
        ...(state.attempt === undefined ? {} : { attempt: state.attempt })
      }
    }));
  }), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        useAppStore.getState().setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="application-shell">
      <TitleBar />
      {!workspace ? (
        <Welcome />
      ) : (
        <main className={`workspace-grid ${contextVisible ? "has-context" : "context-hidden"}`}>
          <NavigationRail />
          <section className="conversation-region" aria-label="Pi conversation">
            <TrustBanner />
            <Transcript />
            <Composer />
          </section>
          {contextVisible ? <ContextPane /> : null}
        </main>
      )}
      <div className="notice-stack" aria-live="polite" aria-atomic="false">
        {notices.map((notice) => (
          <button
            className={`notice notice-${notice.level}`}
            key={notice.id}
            onClick={() => dismissNotice(notice.id)}
            type="button"
          >
            <span>{notice.message}</span>
            <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      <ExtensionDialog />
      <DoctorDialog />
      <CredentialDialog />
      <UpdateDialog />
      <CommandPalette />
    </div>
  );
}
