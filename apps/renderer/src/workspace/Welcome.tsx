import { FolderOpen, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";

export function Welcome() {
  const connected = useAppStore((state) => state.connected);
  const openWorkspace = useAppStore((state) => state.openWorkspace);

  return (
    <main className="welcome-screen">
      <section className="welcome-copy">
        <div className="welcome-eyebrow"><Sparkles size={14} /> Pi-first desktop workspace</div>
        <h1>把真实的 Pi 会话，放进一个清晰的工作面。</h1>
        <p>
          复用现有模型、认证、Skills、Prompts、Extensions 和 JSONL sessions。
          Desktop 不启动内部服务器，也不会创建第二套 agent runtime。
        </p>
        <Button className="primary-button welcome-action" onPress={() => void openWorkspace()}>
          <FolderOpen size={17} />
          选择工作区
        </Button>
        <div className="welcome-facts">
          <div><ShieldCheck size={17} /><span><strong>边界明确</strong>项目资源与工具审批分离</span></div>
          <div><span className="fact-glyph">{`</>`}</span><span><strong>Pi SDK 0.81.1</strong>{connected ? "Agent Host 已连接" : "选择工作区后按需启动"}</span></div>
        </div>
      </section>
      <aside className="welcome-preview" aria-label="Product structure preview">
        <div className="preview-toolbar"><span /><span /><span /></div>
        <div className="preview-layout">
          <div className="preview-nav"><i /><i /><i /><i /></div>
          <div className="preview-main"><b /><p /><p /><b /><p /><em /></div>
          <div className="preview-context"><i /><i /><i /></div>
        </div>
      </aside>
    </main>
  );
}
