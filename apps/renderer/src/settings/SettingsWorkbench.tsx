import type { SettingsSection } from "@pi67/domain";
import {
  ArrowLeft,
  DownloadCloud,
  FileDown,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Stethoscope,
  Sun,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  SearchField
} from "react-aria-components";
import piIconUrl from "../assets/pi-icon-64.png";
import { saveRuntimeDiagnostics } from "../doctor/runtime-diagnostics-controller.js";
import { messages } from "../localization/message-catalog.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSessionResources } from "../session/session-projection-selectors.js";
import { reloadSessionResources } from "../session/session-control-controller.js";
import { useShellStore } from "../shell/shell-store.js";
import {
  setThemePreference,
  type ThemePreference,
  useThemeSnapshot
} from "../theme/theme-controller.js";
import {
  rendererWorkbenchStore,
  useWorkbenchStore
} from "../workbench/workbench-store.js";
import styles from "./SettingsWorkbench.module.css";
import { ExtensionPackageManager } from "./ExtensionPackageManager.js";
import { ExtensionManagementWorkspace } from "./ExtensionManagementWorkspace.js";
import {
  Browser67IntegrationPanel,
  BundledCapabilityList,
  ManagedRulePanel
} from "./DesktopCapabilityPanels.js";
import { PackageNetworkPanel } from "./PackageNetworkPanel.js";
import { ProviderConfigurationPanel } from "./ProviderConfigurationPanel.js";
import {
  SettingsNotice,
  SettingsPageHeader,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  matchesSettingsQuery,
  sectionSupportsProjectScope
} from "./settings-navigation.js";

export function SettingsWorkbench() {
  const section = useWorkbenchStore((state) => state.settingsSection);
  const scope = useWorkbenchStore((state) => state.settingsScope);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const currentWorkspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const workspace = useWorkbenchStore((state) => (
    currentWorkspaceId ? state.workspaces[currentWorkspaceId] : undefined
  ));
  const currentSection = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]!;
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleGroups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => matchesSettingsQuery(item, normalizedQuery))
  })).filter((group) => group.items.length > 0);
  const projectScopeAvailable = sectionSupportsProjectScope(section);

  useEffect(() => {
    if (!projectScopeAvailable && scope !== "global") {
      rendererWorkbenchStore.getState().setSettingsScope("global");
    }
  }, [projectScopeAvailable, scope]);

  useLayoutEffect(() => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) return;
    scrollRegion.scrollTop = 0;
    scrollRegion.scrollLeft = 0;
  }, [section]);

  useEffect(() => {
    const focusSettingsSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "f") return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", focusSettingsSearch);
    return () => window.removeEventListener("keydown", focusSettingsSearch);
  }, []);

  return (
    <section aria-label="π 设置" className={styles.workbench} data-testid="settings-workbench">
      <aside className={styles.sidebar}>
        <div className={styles.sidebarControls}>
          <Button
            aria-label="返回工作台"
            className={styles.backButton!}
            onPress={() => rendererWorkbenchStore.getState().closeSettings()}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            <span>返回工作台</span>
          </Button>
          <SearchField
            aria-label="搜索设置"
            className={styles.search!}
            value={query}
            onChange={setQuery}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !query) return;
              event.preventDefault();
              setQuery("");
            }}
          >
            <Search aria-hidden="true" size={15} />
            <Input
              className={styles.searchInput!}
              placeholder="搜索设置…"
              ref={searchInputRef}
            />
            {query ? <Button
              aria-label="清除设置搜索"
              className={styles.clearSearch!}
              onPress={() => setQuery("")}
            ><X aria-hidden="true" size={13} /></Button> : null}
          </SearchField>
        </div>
        <nav aria-label="设置分类" className={styles.navigation}>
          {visibleGroups.map((group) => (
            <div aria-label={group.label} className={styles.navigationGroup} key={group.label} role="group">
              <span className={styles.navigationGroupLabel}>{group.label}</span>
              <div className={styles.navigationGroupItems}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Button
                      aria-current={section === item.id ? "page" : false}
                      className={`${styles.navigationItem} ${section === item.id ? styles.selected : ""}`}
                      key={item.id}
                      onPress={() => {
                        const store = rendererWorkbenchStore.getState();
                        store.selectSettingsSection(item.id);
                        if (!sectionSupportsProjectScope(item.id)) store.setSettingsScope("global");
                      }}
                    >
                      <Icon aria-hidden="true" size={16} />
                      <span>{item.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
          {visibleGroups.length === 0 ? <div className={styles.emptySearch} role="status">
            <strong>没有匹配的设置</strong>
            <span>{messages.settings.emptySearchSuggestion}</span>
            <Button onPress={() => setQuery("")}>清除搜索</Button>
          </div> : null}
        </nav>
      </aside>
      <div className={styles.content}>
        <div
          className={styles.scrollRegion}
          data-layout="document"
          data-testid="settings-scroll-region"
          ref={scrollRegionRef}
        >
          <div className={styles.documentBody}>
            <SettingsPageHeader
              title={currentSection.label}
              description={currentSection.summary}
              actions={projectScopeAvailable ? <div aria-label="设置作用域" className={styles.scope} role="group">
                <Button
                  className={scope === "global" ? styles.scopeSelected! : ""}
                  onPress={() => rendererWorkbenchStore.getState().setSettingsScope("global")}
                >全局</Button>
                <Button
                  className={scope === "project" ? styles.scopeSelected! : ""}
                  isDisabled={!workspace}
                  onPress={() => rendererWorkbenchStore.getState().setSettingsScope("project")}
                >{workspace ? `项目 · ${workspace.displayName}` : "当前项目"}</Button>
              </div> : undefined}
            />
            <div className={styles.pageContent}>
              <SettingsSectionContent section={section} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SettingsSectionContent({ section }: { section: SettingsSection }) {
  if (section === "account") return <AccountSettings />;
  if (section === "general") return <GeneralSettings />;
  if (section === "providers") return <ProviderSettings />;
  if (section === "extensions") return <ExtensionSettings />;
  if (section === "skills") return <SkillSettings />;
  if (section === "prompts") return <PromptSettings />;
  if (section === "rules") return <RuleSettings />;
  if (section === "integrations") return <IntegrationSettings />;
  if (section === "runtime") return <RuntimeSettings />;
  if (section === "network") return <PackageNetworkPanel />;
  if (section === "updates") return <UpdateSettings />;
  return <AboutSettings />;
}

function AccountSettings() {
  return (
    <SettingsSectionBlock title="登录状态" description="π 当前以本地模式运行；工作区、会话和凭据不会因为未登录而离开本机。">
      <SettingsRows>
        <SettingsRow
          leading={<UserRound aria-hidden="true" size={17} />}
          title="未登录"
          description="账户服务尚未连接，不影响本地使用 Pi。"
          value="本地模式"
        />
        <SettingsRow title="账户同步" description="企业和团队同步将在接入真实账户服务后提供。" value="未连接" />
        <SettingsRow title="本地数据" description="工作区、会话、模型配置和凭据继续保留在本机。" value="仅本机" />
      </SettingsRows>
    </SettingsSectionBlock>
  );
}

function GeneralSettings() {
  const theme = useThemeSnapshot();
  return (
    <SettingsSectionBlock title="外观" description="默认跟随操作系统；选择只影响 Desktop，不会启动 Pi 运行服务。">
      <SettingsRows>
        <SettingsRow
          leading={<Monitor aria-hidden="true" size={17} />}
          title="应用外观"
          description={THEME_OPTIONS.find((option) => option.id === theme.preference)?.detail}
          actions={<div aria-label="应用外观" className={styles.themeSegmented} role="group">
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <Button
                  aria-pressed={theme.preference === option.id}
                  className={theme.preference === option.id ? styles.themeSelected! : ""}
                  key={option.id}
                  onPress={() => setThemePreference(option.id)}
                >
                  <Icon aria-hidden="true" size={14} />{option.label}
                </Button>
              );
            })}
          </div>}
        />
      </SettingsRows>
      {theme.persistence === "memory" ? <SettingsNotice tone="warning">主题存储不可用，选择仅在本次运行有效。</SettingsNotice> : null}
    </SettingsSectionBlock>
  );
}

function ProviderSettings() {
  return <ProviderConfigurationPanel />;
}

function ExtensionSettings() {
  return <ExtensionManagementWorkspace />;
}

function SkillSettings() {
  const resources = useSessionProjectionStore(selectSessionResources);
  return (
    <>
      <BundledCapabilityList resourceType="skill" />
      <ExtensionPackageManager resourceType="skill" />
      <SettingsSectionBlock
        actions={<Button className="secondary-button" onPress={() => void reloadSessionResources()}>
          <RefreshCw aria-hidden="true" size={14} />重新加载 Pi 资源
        </Button>}
        title="当前会话已加载资源"
        description="这是当前 Pi 会话的运行状态投影，不等同于已安装目录。"
      >
        {resources?.length ? <SettingsRows>{resources.map((resource) => (
          <SettingsRow
            key={`${resource.kind}-${resource.id}`}
            leading={<span className={styles.resourceStatus} data-status={resource.status} />}
            title={resource.label}
            description={`${resource.kind}${resource.detail ? ` · ${resource.detail}` : ""}`}
            value={resource.status === "ready" ? "已加载" : resource.status === "failed" ? "失败" : "检查中"}
          />
        ))}</SettingsRows> : <SettingsNotice>当前任务尚未同步可显示的 Pi 资源。</SettingsNotice>}
      </SettingsSectionBlock>
    </>
  );
}

function PromptSettings() {
  return (
    <>
      <BundledCapabilityList resourceType="prompt" />
      <ExtensionPackageManager resourceType="prompt" />
    </>
  );
}

function RuleSettings() {
  return <ManagedRulePanel />;
}

function IntegrationSettings() {
  return <Browser67IntegrationPanel />;
}

function RuntimeSettings() {
  const setDoctorDialogOpen = useShellStore((state) => state.setDoctorDialogOpen);
  return (
    <SettingsSectionBlock title="Pi 运行服务" description="每个活动任务拥有独立的 Pi 运行服务；切换工作区或会话不会停止后台任务。">
      <SettingsRows>
        <SettingsRow title="同时运行的任务" description="全应用 accepted、running 和等待输入状态共享同一运行名额。" value="最多 4 个" />
        <SettingsRow title="可浏览的本地会话" description="会话目录按需加载，Pi JSONL 始终是唯一真源。" value="不设上限" />
        <SettingsRow title="单个会话写入实例" description="同一 Session 路径不会同时绑定两个 live writer。" value="1 个" />
        <SettingsRow
          leading={<Stethoscope aria-hidden="true" size={17} />}
          title="运行环境诊断"
          description="检查内置 Node、Pi SDK、SQLite、Shell 和 Git。"
          actions={<Button aria-label="运行环境诊断" className="secondary-button" onPress={() => setDoctorDialogOpen(true)}>打开诊断</Button>}
        />
      </SettingsRows>
    </SettingsSectionBlock>
  );
}

function UpdateSettings() {
  const setUpdateDialogOpen = useShellStore((state) => state.setUpdateDialogOpen);
  return (
    <SettingsSectionBlock title="更新与诊断" description="更新检查不携带工作区、会话、模型服务或凭据信息；诊断导出默认脱敏。">
      <SettingsRows>
        <SettingsRow
          leading={<DownloadCloud aria-hidden="true" size={17} />}
          title="检查更新"
          description="查看当前版本、可用更新和 Unsigned Preview 状态。"
          actions={<Button className="secondary-button" onPress={() => setUpdateDialogOpen(true)}>检查更新</Button>}
        />
        <SettingsRow
          leading={<FileDown aria-hidden="true" size={17} />}
          title="导出脱敏诊断"
          description="不包含提示词、源码正文、凭据或原始工具载荷。"
          actions={<Button aria-label="导出脱敏诊断" className="secondary-button" onPress={() => void saveRuntimeDiagnostics()}>导出</Button>}
        />
      </SettingsRows>
    </SettingsSectionBlock>
  );
}

function AboutSettings() {
  return (
    <SettingsSectionBlock title="π" description="一个 Pi-first、local-first 的 Windows 与 macOS 桌面工作台。">
      <SettingsRows>
        <SettingsRow
          leading={<img alt="" aria-hidden="true" className={styles.aboutIcon} src={piIconUrl} />}
          title="π"
          description="Pi-first Desktop Workbench"
          value="Pi-67 Desktop"
        />
        <SettingsRow title="Agent 运行组件" value="@earendil-works/pi-coding-agent" />
        <SettingsRow title="会话真源" value="Pi JSONL" />
        <SettingsRow title="渲染进程" value="Electron sandbox + contextIsolation" />
        <SettingsRow title="网络边界" value="生产环境无本地 HTTP 服务或业务网络监听" />
      </SettingsRows>
    </SettingsSectionBlock>
  );
}

const THEME_OPTIONS: ReadonlyArray<{
  id: ThemePreference;
  label: string;
  detail: string;
  icon: typeof Monitor;
}> = [
  { id: "system", label: "跟随系统", detail: "自动匹配操作系统外观", icon: Monitor },
  { id: "light", label: "浅色", detail: "明亮、克制的工作界面", icon: Sun },
  { id: "dark", label: "深色", detail: "低眩光的深色工作界面", icon: Moon }
];
