import type { PiProviderConfigurationInput } from "@pi67/protocol";
import { useEffect } from "react";
import { Button } from "react-aria-components";
import {
  rendererWorkbenchStore,
  useWorkbenchStore
} from "../workbench/workbench-store.js";
import {
  GLOBAL_PROVIDER_CONFIGURATION_KEY,
  loadProjectProviderConfiguration,
  loadProviderConfiguration,
  projectConfigurationKey,
  reloadProjectProviderConfiguration,
  reloadProviderConfiguration
} from "./provider-configuration-controller.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import {
  ProviderConfigurationEmpty,
  ProviderConfigurationStatusBar
} from "./ProviderConfigurationStatus.js";
import { ProviderVisionAssistantEditor } from "./ProviderVisionAssistantEditor.js";
import { SettingsNotice } from "./SettingsPrimitives.js";
import styles from "./VisionAssistantSettings.module.css";

export function VisionAssistantSettings() {
  const scope = useWorkbenchStore((state) => state.settingsScope);
  const workspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId);
  const snapshot = useProviderConfigurationStore((state) => state.snapshot);
  const phase = useProviderConfigurationStore((state) => state.phase);
  const error = useProviderConfigurationStore((state) => state.error);
  const storeKey = useProviderConfigurationStore((state) => state.workspaceId);
  const expectedKey = scope === "global"
    ? GLOBAL_PROVIDER_CONFIGURATION_KEY
    : workspaceId
      ? projectConfigurationKey(workspaceId)
      : undefined;

  useEffect(() => {
    if (scope === "global") {
      void loadProviderConfiguration();
      return;
    }
    if (workspaceId) void loadProjectProviderConfiguration(workspaceId);
  }, [scope, workspaceId]);

  if (scope === "project" && !workspaceId) {
    return <ProviderConfigurationEmpty
      title="未选择 Workspace"
      detail="返回工作台选择一个 Workspace 后再配置项目视觉辅助。"
    />;
  }
  if (phase === "loading" && (!snapshot || storeKey !== expectedKey)) {
    return <ProviderConfigurationEmpty
      title={scope === "global" ? "正在读取视觉辅助配置" : "正在读取项目视觉辅助配置"}
      detail={scope === "global"
        ? "从 Pi Provider 与 settings.json 建立安全投影。"
        : "项目覆盖仅在 Workspace 可用且可信时读取。"}
    />;
  }
  if (!snapshot || storeKey !== expectedKey) {
    return <ProviderConfigurationEmpty
      title="视觉辅助配置尚不可用"
      detail={error ?? (scope === "global"
        ? "请确认 Agent Host 已连接，然后重新加载。"
        : "请重新确认并信任当前 Workspace。全局视觉辅助仍可正常使用。")}
      action={<Button className="secondary-button" onPress={() => {
        if (scope === "global") {
          void loadProviderConfiguration();
        } else if (workspaceId) {
          void loadProjectProviderConfiguration(workspaceId);
        }
      }}>重试</Button>}
    />;
  }

  return (
    <div className={styles.settings} data-testid="vision-assistant-settings">
      <ProviderConfigurationStatusBar
        snapshot={snapshot}
        busy={phase === "saving"}
        onReload={() => {
          if (scope === "global") {
            void reloadProviderConfiguration();
          } else if (workspaceId) {
            void reloadProjectProviderConfiguration(workspaceId);
          }
        }}
      />
      <ProviderVisionAssistantEditor
        snapshot={snapshot}
        scope={scope}
        {...(workspaceId === undefined ? {} : { workspaceId })}
        {...(scope === "global" ? { onUsePreset: openProviderPreset } : {})}
      />
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
    </div>
  );

  function openProviderPreset(preset: PiProviderConfigurationInput): void {
    const provider = snapshot?.providers.find((candidate) => candidate.id === preset.id);
    const store = useProviderConfigurationStore.getState();
    if (provider) {
      store.selectProvider(provider.id);
      store.requestProviderEditor(
        GLOBAL_PROVIDER_CONFIGURATION_KEY,
        provider.origin === "builtin" && !provider.configured ? "configuration" : "models"
      );
    } else {
      store.startProvider(preset);
      store.requestProviderEditor(GLOBAL_PROVIDER_CONFIGURATION_KEY, "configuration");
    }
    rendererWorkbenchStore.getState().selectSettingsSection("providers");
  }
}
