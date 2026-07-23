import { Command, DownloadCloud, KeyRound, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { ThemeButton } from "../theme/ThemeButton.js";

export function TitleBar() {
  const runtime = useAppStore((state) => state.runtime);
  const snapshot = useAppStore((state) => state.snapshot);
  const contextVisible = useAppStore((state) => state.contextVisible);
  const setContextVisible = useAppStore((state) => state.setContextVisible);
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const setCredentialDialogOpen = useAppStore((state) => state.setCredentialDialogOpen);
  const setUpdateDialogOpen = useAppStore((state) => state.setUpdateDialogOpen);
  const selectModel = useAppStore((state) => state.selectModel);
  const setThinking = useAppStore((state) => state.setThinking);

  return (
    <header className="title-bar">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">π</span>
        <span>Pi-67</span>
      </div>
      <div className="title-drag-region" aria-hidden="true" />
      {snapshot ? (
        <div className="runtime-controls">
          <label className="compact-field">
            <span className="sr-only">Pi model</span>
            <select
              aria-label="Pi model"
              value={snapshot.selectedModel ? `${snapshot.selectedModel.provider}/${snapshot.selectedModel.id}` : ""}
              onChange={(event) => {
                const [provider, ...modelParts] = event.target.value.split("/");
                if (provider) void selectModel(provider, modelParts.join("/"));
              }}
            >
              <option value="">选择模型</option>
              {snapshot.models.map((model) => (
                <option disabled={!model.configured} key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                  {model.label} · {model.provider}{model.configured ? "" : "（未认证）"}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-field thinking-field">
            <span className="sr-only">Thinking level</span>
            <select aria-label="Thinking level" value={snapshot.thinkingLevel} onChange={(event) => void setThinking(event.target.value)}>
              {snapshot.availableThinkingLevels.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </label>
        </div>
      ) : null}
      <div className="title-actions">
        <span className={`runtime-pill phase-${runtime.phase}`}>
          <span className="status-dot" aria-hidden="true" />
          {runtime.detail}
        </span>
        <Button className="icon-button" aria-label="打开命令面板" onPress={() => setCommandPaletteOpen(true)}>
          <Command size={16} />
        </Button>
        <Button className="icon-button" aria-label="配置本次运行的 Provider API key" onPress={() => setCredentialDialogOpen(true)}>
          <KeyRound size={15} />
        </Button>
        <Button className="icon-button" aria-label="检查 Pi-67 Desktop 更新" onPress={() => setUpdateDialogOpen(true)}>
          <DownloadCloud size={15} />
        </Button>
        <ThemeButton />
        <Button className="icon-button context-toggle" aria-label={contextVisible ? "隐藏上下文" : "显示上下文"} onPress={() => setContextVisible(!contextVisible)}>
          {contextVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </Button>
      </div>
    </header>
  );
}
