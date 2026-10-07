import { FileText, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { useSettingsNavigation } from "./SettingsDraftGuard.js";
import {
  useDesktopCapabilitySnapshot
} from "./DesktopCapabilityPanels.js";
import { ExtensionManagementWorkspace, type ExtensionPackageView } from "./ExtensionManagementWorkspace.js";
import { SessionResourcePanel } from "./SessionResourcePanel.js";
import {
  SettingsIconAction,
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock,
  SettingsStatus
} from "./SettingsPrimitives.js";
import styles from "./ExtensionSettingsWorkspace.module.css";
import tabStyles from "./SettingsPrimitives.module.css";

type CapabilityState = ReturnType<typeof useDesktopCapabilitySnapshot>;
type ExtensionSettingsView = ExtensionPackageView | "bundled" | "local";

export function ExtensionSettingsWorkspace() {
  const capability = useDesktopCapabilitySnapshot();
  const [view, setView] = useState<ExtensionSettingsView>("installed");
  // One tab level for the page: the two third-party Package views sit beside bundled and local Extensions.
  return (
    <Tabs
      className={styles.workspace!}
      data-testid="extension-settings-workspace"
      selectedKey={view}
      onSelectionChange={(key) => setView(String(key) as ExtensionSettingsView)}
    >
      <TabList aria-label="扩展管理分类" className={tabStyles.tabList!}>
        <Tab className={tabStyles.tab!} id="installed">已安装</Tab>
        <Tab className={tabStyles.tab!} id="market">扩展市场</Tab>
        <Tab className={tabStyles.tab!} id="bundled">
          内置扩展
        </Tab>
        <Tab className={tabStyles.tab!} id="local">
          本地扩展
        </Tab>
      </TabList>
      {(["installed", "market"] as const).map((packageView) => (
        <TabPanel className={`${tabStyles.tabPanel} ${styles.packagePanel}`} id={packageView} key={packageView}>
          <ExtensionManagementWorkspace
            capability={capability}
            view={packageView}
            onShowInstalled={() => setView("installed")}
          />
        </TabPanel>
      ))}
      <TabPanel className={tabStyles.tabPanel!} id="bundled">
        <BundledExtensionPanel capability={capability} />
      </TabPanel>
      <TabPanel className={tabStyles.tabPanel!} id="local">
        <SessionResourcePanel
          kind="extension"
          origin="top-level"
          title="本地扩展"
          description="直接从全局扩展目录、当前项目的 .pi/extensions 或 settings.json 中配置的 extensions 路径加载；扩展包内容不会在这里重复出现。"
          empty="尚未发现本地扩展。可以将扩展放入 ~/.pi/agent/extensions 或当前项目的 .pi/extensions。"
        />
      </TabPanel>
    </Tabs>
  );
}

function BundledExtensionPanel({ capability }: { capability: CapabilityState }) {
  const scope = useWorkbenchStore((state) => state.settingsScope);
  const navigateSettings = useSettingsNavigation();
  const extensions = [...(capability.snapshot?.bundledExtensions ?? [])]
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
  return (
    <SettingsSectionBlock
      actions={<SettingsIconAction
        icon={<RefreshCw aria-hidden="true" size={14} />}
        isDisabled={capability.phase === "loading"}
        label={capability.phase === "loading" ? "刷新中…" : "刷新状态"}
        onPress={() => void capability.refresh()}
      />}
      title="内置扩展"
      description="随 New Money 提供并跟随应用更新；这里显示随附状态，不代表当前会话已经加载。"
    >
      {capability.error ? <SettingsNotice tone="danger">{capability.error}</SettingsNotice> : null}
      {extensions.length > 0 ? <SettingsRows>{extensions.map((extension) => (
        <SettingsRow
          key={`${extension.packageId}:${extension.id}`}
          title={extension.displayName}
          description={extension.description}
          value={<SettingsStatus tone={extension.installed ? "success" : "neutral"}>{extension.installed ? "已随应用提供" : "尚未准备"}</SettingsStatus>}
          actions={extension.id === "pi-rules-loader" ? <Button
            className="secondary-button"
            onPress={() => navigateSettings("rules")}
          >
            <FileText aria-hidden="true" size={14} />
            查看工作规则
          </Button> : undefined}
        >
          <span className={styles.bundledMeta}>
            <code>{extension.id}</code>
            <span aria-hidden="true">·</span>
            <span>{extension.packageDisplayName} {extension.version}</span>
          </span>
        </SettingsRow>
      ))}</SettingsRows> : (
        <SettingsNotice>
          {capability.snapshot === undefined || capability.phase === "loading"
            ? "正在读取 New Money 内置扩展…"
            : "当前版本没有可显示的内置扩展。"}
        </SettingsNotice>
      )}
      {scope === "project" ? <SettingsNotice className={styles.scopeNotice!}>
        内置扩展由应用统一提供，不随当前项目作用域切换。
      </SettingsNotice> : null}
    </SettingsSectionBlock>
  );
}
