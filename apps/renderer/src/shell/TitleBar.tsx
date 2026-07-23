import { Command, DownloadCloud, KeyRound, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { ThemeButton } from "../theme/ThemeButton.js";

export function TitleBar() {
  const runtime = useAppStore((state) => state.runtime);
  const workspace = useAppStore((state) => state.workspace);
  const snapshot = useAppStore((state) => state.snapshot);
  const contextVisible = useAppStore((state) => state.contextVisible);
  const setContextVisible = useAppStore((state) => state.setContextVisible);
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const setCredentialDialogOpen = useAppStore((state) => state.setCredentialDialogOpen);
  const setUpdateDialogOpen = useAppStore((state) => state.setUpdateDialogOpen);
  const selectModel = useAppStore((state) => state.selectModel);
  const setThinking = useAppStore((state) => state.setThinking);
  const selectedModelValue = snapshot?.selectedModel
    ? `${snapshot.selectedModel.provider}/${snapshot.selectedModel.id}`
    : "";
  const visibleModels = snapshot?.models.filter((model) => (
    model.configured || `${model.provider}/${model.id}` === selectedModelValue
  )) ?? [];

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
              value={selectedModelValue}
              onChange={(event) => {
                const [provider, ...modelParts] = event.target.value.split("/");
                if (provider) void selectModel(provider, modelParts.join("/"));
              }}
            >
              <option value="">{visibleModels.length > 0 ? "选择模型" : "没有可用模型 · 配置 Provider"}</option>
              {visibleModels.map((model) => (
                <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                  {model.label} · {model.provider}{model.configured ? "" : "（当前模型未认证）"}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-field thinking-field">
            <span className="sr-only">Pi 思考级别</span>
            <select aria-label="Pi 思考级别" value={snapshot.thinkingLevel} onChange={(event) => void setThinking(event.target.value)}>
              {snapshot.availableThinkingLevels.map((level) => (
                <option key={level} value={level}>{thinkingLevelLabel(level)}</option>
              ))}
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
        <Button className="icon-button" aria-label="管理 Provider 与凭据" onPress={() => setCredentialDialogOpen(true)}>
          <KeyRound size={15} />
        </Button>
        <Button className="icon-button" aria-label="检查 Pi-67 Desktop 更新" onPress={() => setUpdateDialogOpen(true)}>
          <DownloadCloud size={15} />
        </Button>
        {!workspace ? <ThemeButton /> : null}
        <Button className="icon-button context-toggle" aria-label={contextVisible ? "隐藏上下文" : "显示上下文"} onPress={() => setContextVisible(!contextVisible)}>
          {contextVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </Button>
      </div>
    </header>
  );
}

const THINKING_LEVEL_LABELS: Readonly<Record<string, string>> = {
  off: "思考：关闭",
  minimal: "思考：最低",
  low: "思考：低",
  medium: "思考：中",
  high: "思考：高",
  xhigh: "思考：很高",
  max: "思考：最高"
};

function thinkingLevelLabel(level: string): string {
  return THINKING_LEVEL_LABELS[level] ?? `思考：${level}`;
}
