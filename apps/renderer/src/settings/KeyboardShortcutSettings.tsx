import { Keyboard, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Input, SearchField } from "react-aria-components";
import {
  formatDesktopShortcut,
  type DesktopActionId,
  type DesktopShortcutContext
} from "../app/desktop-action-registry.js";
import {
  bindingFromKeyboardEvent,
  desktopShortcutIsCustomized,
  effectiveDesktopAction,
  effectiveDesktopActions,
  resetAllDesktopShortcuts,
  resetDesktopShortcut,
  setDesktopShortcut,
  useDesktopShortcutRevision
} from "../app/desktop-shortcut-preferences.js";
import {
  SettingsNotice,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import styles from "./KeyboardShortcutSettings.module.css";

export function KeyboardShortcutSettings() {
  const shortcutRevision = useDesktopShortcutRevision();
  const [query, setQuery] = useState("");
  const [recordingId, setRecordingId] = useState<DesktopActionId>();
  const [message, setMessage] = useState<string>();
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  const actions = useMemo(() => effectiveDesktopActions().filter((action) => (
    !normalized || `${action.label} ${action.detail} ${action.keywords}`
      .normalize("NFKC").toLocaleLowerCase("zh-CN").includes(normalized)
  )), [normalized, shortcutRevision]);

  return (
    <SettingsSectionBlock
      title="键盘快捷键"
      description="只可绑定 Pi-67 allowlist 中的应用动作；不会执行 Shell、Extension command 或项目脚本。"
      actions={<Button className={styles.resetAll!} onPress={() => {
        resetAllDesktopShortcuts();
        setMessage("已恢复全部默认快捷键。");
      }}><RotateCcw size={13} />全部恢复默认</Button>}
    >
      <SearchField aria-label="搜索键盘快捷键" className={styles.search!} value={query} onChange={setQuery}>
        <Search aria-hidden="true" size={14} />
        <Input placeholder="搜索动作或快捷键用途…" />
      </SearchField>
      {message ? <SettingsNotice tone={message.includes("冲突") || message.includes("无效") ? "warning" : "info"}>{message}</SettingsNotice> : null}
      <div className={styles.list}>
        {actions.map((action) => {
          const customized = desktopShortcutIsCustomized(action.id);
          const recording = recordingId === action.id;
          return <div className={styles.row} key={action.id}>
            <span className={styles.icon}><Keyboard aria-hidden="true" size={15} /></span>
            <span className={styles.copy}>
              <strong>{action.label}</strong>
              <small>{action.detail}</small>
              <em>{contextLabel(action.contexts)}</em>
            </span>
            <button
              aria-label={`${recording ? "正在录制" : "修改"}${action.label}快捷键`}
              autoFocus={recording}
              className={styles.recorder}
              data-recording={recording || undefined}
              onClick={() => {
                setMessage(undefined);
                setRecordingId(action.id);
              }}
              onKeyDown={(event) => {
                if (!recording) return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Escape") {
                  setRecordingId(undefined);
                  setMessage("已取消录制。");
                  return;
                }
                const binding = bindingFromKeyboardEvent(event.nativeEvent);
                if (!binding) {
                  setMessage("无效快捷键：请按 Ctrl/Command 加一个字母、数字或支持的符号键。");
                  return;
                }
                const result = setDesktopShortcut(action.id, binding);
                if (result.status === "conflict") {
                  setMessage(`快捷键冲突：已由“${effectiveDesktopAction(result.actionId).label}”使用。`);
                  return;
                }
                if (result.status === "invalid") {
                  setMessage("无效快捷键，未保存任何修改。");
                  return;
                }
                setRecordingId(undefined);
                setMessage(`已保存“${action.label}”快捷键。`);
              }}
              type="button"
            >{recording ? "按下新组合键…" : <kbd>{formatDesktopShortcut(action)}</kbd>}</button>
            <Button
              aria-label={`恢复${action.label}默认快捷键`}
              className={styles.reset!}
              isDisabled={!customized || recording}
              onPress={() => {
                resetDesktopShortcut(action.id);
                setMessage(`已恢复“${action.label}”默认快捷键。`);
              }}
            ><RotateCcw size={13} /></Button>
          </div>;
        })}
        {actions.length === 0 ? <p className={styles.empty}>没有匹配的快捷键动作。</p> : null}
      </div>
    </SettingsSectionBlock>
  );
}

function contextLabel(contexts: readonly DesktopShortcutContext[]): string {
  const labels: Record<DesktopShortcutContext, string> = {
    workspaceOpen: "工作区已打开",
    composerFocus: "输入框聚焦",
    dialogOpen: "对话框打开",
    settingsOpen: "设置打开",
    fileEditorFocus: "文件编辑器聚焦",
    taskRunning: "任务运行中",
    taskIdle: "任务空闲"
  };
  return contexts.map((context) => labels[context]).join(" · ");
}
