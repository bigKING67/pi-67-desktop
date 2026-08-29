import { FileText, PackageOpen, Puzzle, RefreshCw, SquareCode } from "lucide-react";
import { Button, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import {
  rendererWorkbenchStore,
  useWorkbenchStore
} from "../workbench/workbench-store.js";
import {
  useDesktopCapabilitySnapshot
} from "./DesktopCapabilityPanels.js";
import { ExtensionManagementWorkspace } from "./ExtensionManagementWorkspace.js";
import { SessionResourcePanel } from "./SessionResourcePanel.js";
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import styles from "./ExtensionSettingsWorkspace.module.css";

type CapabilityState = ReturnType<typeof useDesktopCapabilitySnapshot>;

export function ExtensionSettingsWorkspace() {
  const capability = useDesktopCapabilitySnapshot();
  return (
    <Tabs className={styles.workspace!} defaultSelectedKey="packages" data-testid="extension-settings-workspace">
      <TabList aria-label="扩展管理分类" className={styles.tabList!}>
        <Tab className={styles.tab!} id="packages">
          <PackageOpen aria-hidden="true" size={15} />扩展包
        </Tab>
        <Tab className={styles.tab!} id="bundled">
          <Puzzle aria-hidden="true" size={15} />内置扩展
        </Tab>
        <Tab className={styles.tab!} id="local">
          <SquareCode aria-hidden="true" size={15} />本地扩展
        </Tab>
      </TabList>
      <TabPanel className={`${styles.tabPanel} ${styles.packagePanel}`} id="packages">
        <ExtensionManagementWorkspace capability={capability} />
      </TabPanel>
      <TabPanel className={styles.tabPanel!} id="bundled">
        <BundledExtensionPanel capability={capability} />
      </TabPanel>
      <TabPanel className={styles.tabPanel!} id="local">
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
  const extensions = [...(capability.snapshot?.bundledExtensions ?? [])]
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
  return (
    <SettingsSectionBlock
      actions={<Button
        className="secondary-button"
        isDisabled={capability.phase === "loading"}
        onPress={() => void capability.refresh()}
      >
        <RefreshCw aria-hidden="true" size={14} />
        {capability.phase === "loading" ? "刷新中…" : "刷新状态"}
      </Button>}
      title="内置扩展"
      description="随 Pi-67 Desktop 提供并跟随应用更新；这里显示随附状态，不代表当前会话已经加载。"
    >
      {capability.error ? <SettingsNotice tone="danger">{capability.error}</SettingsNotice> : null}
      {extensions.length > 0 ? <SettingsRows>{extensions.map((extension) => (
        <SettingsRow
          key={`${extension.packageId}:${extension.id}`}
          leading={<span
            className={styles.bundledStatus}
            data-status={extension.installed ? "ready" : "unavailable"}
          />}
          title={extension.displayName}
          description={extension.description}
          value={extension.installed ? "已随应用提供" : "尚未准备"}
          actions={extension.id === "pi-rules-loader" ? <Button
            className="secondary-button"
            onPress={() => rendererWorkbenchStore.getState().selectSettingsSection("rules")}
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
            ? "正在读取 Pi-67 Desktop 内置扩展…"
            : "当前版本没有可显示的内置扩展。"}
        </SettingsNotice>
      )}
      {scope === "project" ? <SettingsNotice className={styles.scopeNotice!}>
        内置扩展由应用统一提供，不随当前项目作用域切换。
      </SettingsNotice> : null}
    </SettingsSectionBlock>
  );
}
