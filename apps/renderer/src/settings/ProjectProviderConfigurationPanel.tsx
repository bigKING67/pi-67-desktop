import { useEffect } from "react";
import { Button } from "react-aria-components";
import { ProviderDefaultModelEditor } from "./ProviderDefaultModelEditor.js";
import {
  ProviderConfigurationEmpty,
  ProviderConfigurationFiles,
  ProviderConfigurationStatusBar
} from "./ProviderConfigurationStatus.js";
import {
  loadProjectProviderConfiguration,
  projectConfigurationKey,
  reloadProjectProviderConfiguration
} from "./provider-configuration-controller.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import { SettingsNotice } from "./SettingsPrimitives.js";
import styles from "./ProviderConfigurationPanel.module.css";

export function ProjectProviderConfigurationPanel({ workspaceId }: { workspaceId: string | undefined }) {
  const snapshot = useProviderConfigurationStore((state) => state.snapshot);
  const phase = useProviderConfigurationStore((state) => state.phase);
  const error = useProviderConfigurationStore((state) => state.error);
  const storeKey = useProviderConfigurationStore((state) => state.workspaceId);
  const expectedKey = workspaceId ? projectConfigurationKey(workspaceId) : undefined;

  useEffect(() => {
    if (workspaceId) void loadProjectProviderConfiguration(workspaceId);
  }, [workspaceId]);

  if (!workspaceId) {
    return <ProviderConfigurationEmpty
      title="未选择 Workspace"
      detail="返回工作台选择一个 Workspace 后再打开项目模型设置。"
    />;
  }
  if (phase === "loading" && (!snapshot || storeKey !== expectedKey)) {
    return <ProviderConfigurationEmpty
      title="正在读取项目 Pi 配置"
      detail="项目覆盖仅在 Workspace 可用且可信时读取。"
    />;
  }
  if (!snapshot || storeKey !== expectedKey) {
    return <ProviderConfigurationEmpty
      title="项目 Pi 配置尚不可用"
      detail={error ?? "请重新确认并信任当前 Workspace。全局模型设置仍可正常使用。"}
      action={<Button className="secondary-button" onPress={() => void loadProjectProviderConfiguration(workspaceId)}>
        重试
      </Button>}
    />;
  }

  return (
    <div className={styles.projectPanel} data-testid="provider-project-configuration-panel">
      <ProviderConfigurationStatusBar
        snapshot={snapshot}
        busy={phase === "saving"}
        onReload={() => void reloadProjectProviderConfiguration(workspaceId)}
      />
      <ProviderDefaultModelEditor scope="project" snapshot={snapshot} workspaceId={workspaceId} />
      <ProviderConfigurationFiles snapshot={snapshot} />
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
    </div>
  );
}
