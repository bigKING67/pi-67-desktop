import { Download, Sparkles } from "lucide-react";
import { Button } from "react-aria-components";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { SettingsNotice } from "./SettingsPrimitives.js";
import styles from "./LarkCliRequiredNotice.module.css";

export function LarkCliRequiredNotice({ canInstall, installing, onInstall }: {
  canInstall: boolean;
  installing: boolean;
  onInstall: () => void;
}) {
  return <SettingsNotice
    actions={<span className={styles.actions}>
      <Button
        className="primary-button"
        isDisabled={!canInstall || installing}
        onPress={onInstall}
      >
        <Download aria-hidden="true" size={14} />
        {installing ? "安装中…" : canInstall ? "安装 Lark CLI" : "正在准备安装"}
      </Button>
      <Button
        className="secondary-button"
        isDisabled={installing}
        onPress={() => rendererWorkbenchStore.getState().openSettings("skills")}
      >
        <Sparkles aria-hidden="true" size={14} />
        前往技能
      </Button>
    </span>}
    tone="warning"
  >
    <strong>需要先安装 Lark CLI</strong><br />
    安装会同时启用当前用户的 Lark CLI，并将官方办公 Skills 放入 <code>~/.agents/skills</code>，供 Pi-67 与其他兼容 Agent 共享。
  </SettingsNotice>;
}
