import type { SettingsSection } from "@pi67/domain";
import {
  Activity,
  ArrowLeft,
  Blocks,
  Bot,
  DownloadCloud,
  FileDown,
  Info,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Sun,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  SearchField
} from "react-aria-components";
import type { ReactNode } from "react";
import piIconUrl from "../assets/pi-icon-64.png";
import { saveRuntimeDiagnostics } from "../doctor/runtime-diagnostics-controller.js";
import { ExtensionCatalog } from "../extension-ui/ExtensionCatalog.js";
import { useCommittedExtensionCatalog } from "../extension-ui/extension-ui-store.js";
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
import { ProviderConfigurationPanel } from "./ProviderConfigurationPanel.js";

interface SettingsNavigationItem {
  id: SettingsSection;
  label: string;
  summary: string;
  searchTerms: readonly string[];
  icon: typeof SlidersHorizontal;
}

const SETTINGS_GROUPS: ReadonlyArray<{
  label: string;
  items: readonly SettingsNavigationItem[];
}> = [
  {
    label: "个人",
    items: [{
      id: "account",
      label: "账户",
      summary: "管理登录状态、账户同步与本地数据边界。",
      searchTerms: ["登录", "未登录", "同步", "企业", "本地模式", "account", "sign in"],
      icon: UserRound
    }]
  },
  {
    label: "应用",
    items: [{
      id: "general",
      label: "通用",
      summary: "调整外观、语言和桌面交互偏好。",
      searchTerms: ["外观", "主题", "深色", "浅色", "系统", "语言", "交互", "appearance", "theme"],
      icon: SlidersHorizontal
    }]
  },
  {
    label: "Pi",
    items: [
      {
        id: "providers",
        label: "Provider 与模型",
        summary: "管理 Pi Provider、模型、认证与思考级别。",
        searchTerms: ["提供商", "认证", "密钥", "思考级别", "provider", "model", "api key"],
        icon: Bot
      },
      {
        id: "extensions",
        label: "Extensions",
        summary: "安装、更新、启用、停用和卸载 Pi Extensions。",
        searchTerms: ["扩展", "插件", "安装", "更新", "启用", "停用", "卸载", "npm", "git", "path", "extension"],
        icon: Blocks
      },
      {
        id: "resources",
        label: "Skills 与 Prompts",
        summary: "查看 Pi 资源以及全局和项目继承关系。",
        searchTerms: ["技能", "提示词", "资源", "上下文", "skill", "prompt", "resource"],
        icon: Sparkles
      },
      {
        id: "runtime",
        label: "Runtime 与 Session",
        summary: "查看并发、恢复、会话和 Pi 运行服务状态。",
        searchTerms: ["运行", "会话", "并发", "恢复", "诊断", "runtime", "session"],
        icon: Activity
      }
    ]
  },
  {
    label: "支持",
    items: [
      {
        id: "updates",
        label: "更新与诊断",
        summary: "检查版本更新并导出脱敏运行诊断。",
        searchTerms: ["版本", "检查更新", "导出", "诊断", "update", "version", "doctor"],
        icon: RefreshCw
      },
      {
        id: "about",
        label: "关于",
        summary: "查看 π 的产品边界、版本与运行架构。",
        searchTerms: ["版本", "架构", "pi", "jsonl", "electron", "about"],
        icon: Info
      }
    ]
  }
];

const SECTIONS = SETTINGS_GROUPS.flatMap((group) => group.items);

export function SettingsWorkbench() {
  const section = useWorkbenchStore((state) => state.settingsSection);
  const scope = useWorkbenchStore((state) => state.settingsScope);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const currentWorkspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const workspace = useWorkbenchStore((state) => (
    currentWorkspaceId ? state.workspaces[currentWorkspaceId] : undefined
  ));
  const currentSection = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]!;
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
            <span>尝试搜索主题、模型、扩展或更新。</span>
            <Button onPress={() => setQuery("")}>清除搜索</Button>
          </div> : null}
        </nav>
      </aside>
      <div className={styles.content}>
        <header className={styles.contentHeader}>
          <div className={styles.contentHeading}>
            <h1>{currentSection.label}</h1>
            <p>{currentSection.summary}</p>
          </div>
          {projectScopeAvailable ? <div aria-label="设置作用域" className={styles.scope} role="group">
            <Button
              className={scope === "global" ? styles.scopeSelected! : ""}
              onPress={() => rendererWorkbenchStore.getState().setSettingsScope("global")}
            >全局</Button>
            <Button
              className={scope === "project" ? styles.scopeSelected! : ""}
              isDisabled={!workspace}
              onPress={() => rendererWorkbenchStore.getState().setSettingsScope("project")}
            >{workspace ? workspace.displayName : "当前项目"}</Button>
          </div> : null}
        </header>
        <div className={styles.scrollRegion}>
          <SettingsSectionContent section={section} />
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
  if (section === "resources") return <ResourceSettings />;
  if (section === "runtime") return <RuntimeSettings />;
  if (section === "updates") return <UpdateSettings />;
  return <AboutSettings />;
}

function AccountSettings() {
  return (
    <SettingsGroup title="登录状态" description="π 当前以本地模式运行；工作区、会话和凭据不会因为未登录而离开本机。">
      <div className={styles.actionRow}>
        <div>
          <UserRound aria-hidden="true" size={18} />
          <span><strong>未登录</strong><small>账户同步尚未连接，不影响本地使用 Pi。</small></span>
        </div>
        <span className={styles.accountState}>本地模式</span>
      </div>
    </SettingsGroup>
  );
}

function GeneralSettings() {
  const theme = useThemeSnapshot();
  return (
    <SettingsGroup title="外观" description="默认跟随操作系统；选择只影响 Desktop，不会启动 Pi 运行服务。">
      <div className={styles.appearanceOptions}>
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <Button
              className={theme.preference === option.id ? styles.appearanceSelected! : ""}
              key={option.id}
              onPress={() => setThemePreference(option.id)}
            >
              <Icon aria-hidden="true" size={17} />
              <span><strong>{option.label}</strong><small>{option.detail}</small></span>
            </Button>
          );
        })}
      </div>
      {theme.persistence === "memory" ? <p className={styles.warning}>主题存储不可用，选择仅在本次运行有效。</p> : null}
    </SettingsGroup>
  );
}

function ProviderSettings() {
  return <ProviderConfigurationPanel />;
}

function ExtensionSettings() {
  const catalog = useCommittedExtensionCatalog();
  return (
    <>
      <SettingsGroup title="Extension 管理" description="Extension 由 Pi SettingsManager 和 DefaultPackageManager 管理；项目级变更受当前工作区信任控制。">
        <div className={styles.notice}>
          <strong>安装来源</strong>
          <span>支持 npm、git 和本地 path。安装、更新、启停与卸载必须等待对应作用域的运行任务进入安全状态。</span>
        </div>
      </SettingsGroup>
      <ExtensionPackageManager />
      <div className={styles.catalogSurface}><ExtensionCatalog catalog={catalog} /></div>
    </>
  );
}

function ResourceSettings() {
  const resources = useSessionProjectionStore(selectSessionResources);
  return (
    <SettingsGroup title="Skills、Prompts 与上下文" description="显示当前 Pi Session 实际加载的资源；项目覆盖和全局继承保持可区分。">
      <div className={styles.groupActions}>
        <Button className="secondary-button" onPress={() => void reloadSessionResources()}>
          <RefreshCw aria-hidden="true" size={14} />重新加载 Pi 资源
        </Button>
      </div>
      <div className={styles.resourceList}>
        {resources?.length ? resources.map((resource) => (
          <div key={`${resource.kind}-${resource.id}`}>
            <span className={styles.resourceStatus} data-status={resource.status} />
            <span><strong>{resource.label}</strong><small>{resource.kind}{resource.detail ? ` · ${resource.detail}` : ""}</small></span>
          </div>
        )) : <p className={styles.empty}>当前任务尚未同步可显示的 Pi 资源。</p>}
      </div>
    </SettingsGroup>
  );
}

function RuntimeSettings() {
  const setDoctorDialogOpen = useShellStore((state) => state.setDoctorDialogOpen);
  return (
    <SettingsGroup title="Pi 运行服务" description="活动会话拥有独立 Pi Runtime；切换工作区或会话不会停止后台运行。">
      <div className={styles.factGrid}>
        <div><strong>4</strong><span>全应用运行名额</span></div>
        <div><strong>∞</strong><span>可浏览本地会话</span></div>
        <div><strong>1</strong><span>同一 Session live writer</span></div>
      </div>
      <div className={styles.groupActions}>
        <Button className="secondary-button" onPress={() => setDoctorDialogOpen(true)}>
          <Stethoscope aria-hidden="true" size={14} />运行环境诊断
        </Button>
      </div>
    </SettingsGroup>
  );
}

function UpdateSettings() {
  const setUpdateDialogOpen = useShellStore((state) => state.setUpdateDialogOpen);
  return (
    <SettingsGroup title="更新与诊断" description="更新检查不携带 Workspace、Session、Provider 或凭据信息；诊断导出默认脱敏。">
      <div className={styles.actionList}>
        <Button onPress={() => setUpdateDialogOpen(true)}><DownloadCloud aria-hidden="true" size={17} /><span><strong>检查更新</strong><small>查看当前版本和 Unsigned Preview 状态</small></span></Button>
        <Button onPress={() => void saveRuntimeDiagnostics()}><FileDown aria-hidden="true" size={17} /><span><strong>导出脱敏诊断</strong><small>不包含 Prompt、源码正文或凭据</small></span></Button>
      </div>
    </SettingsGroup>
  );
}

function AboutSettings() {
  return (
    <SettingsGroup title="π" description="一个 Pi-first、local-first 的 Windows 与 macOS 桌面工作台。">
      <div className={styles.aboutBrand}><img alt="" aria-hidden="true" src={piIconUrl} /><span><strong>π</strong><small>Pi-first Desktop Workbench</small></span></div>
      <dl className={styles.aboutList}>
        <div><dt>Agent Runtime</dt><dd>@earendil-works/pi-coding-agent</dd></div>
        <div><dt>Session 真源</dt><dd>Pi JSONL</dd></div>
        <div><dt>Renderer</dt><dd>Electron sandbox + contextIsolation</dd></div>
        <div><dt>网络边界</dt><dd>生产环境无本地 HTTP 服务或业务网络监听</dd></div>
      </dl>
    </SettingsGroup>
  );
}

function sectionSupportsProjectScope(section: SettingsSection): boolean {
  return section === "providers"
    || section === "extensions"
    || section === "resources"
    || section === "runtime";
}

function matchesSettingsQuery(item: SettingsNavigationItem, query: string): boolean {
  if (!query) return true;
  return [item.label, item.summary, ...item.searchTerms]
    .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
}

function SettingsGroup({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.group}>
      <header><h3>{title}</h3><p>{description}</p></header>
      {children}
    </section>
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
