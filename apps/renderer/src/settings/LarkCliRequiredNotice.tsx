import { Download, Sparkles } from "lucide-react";
import { Button } from "react-aria-components";
import { useSettingsNavigation } from "./SettingsDraftGuard.js";
import { SettingsInfo, SettingsNotice } from "./SettingsPrimitives.js";
import styles from "./LarkCliRequiredNotice.module.css";

export function LarkCliRequiredNotice({ canInstall, installing, onInstall }: {
  canInstall: boolean;
  installing: boolean;
  onInstall: () => void;
}) {
  const navigate = useSettingsNavigation();
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
        onPress={() => navigate("skills")}
      >
        <Sparkles aria-hidden="true" size={14} />
        前往技能
      </Button>
    </span>}
    tone="warning"
  >
    <strong>需要先安装 Lark CLI</strong> 安装后，官方办公技能会对 Pi TUI、Desktop 和其他兼容 Agent 共享。
    <SettingsInfo label="Lark CLI 安装位置">
      安装会启用当前用户的 Lark CLI，并将官方办公 Skills 放入 ~/.agents/skills。
    </SettingsInfo>
  </SettingsNotice>;
}
