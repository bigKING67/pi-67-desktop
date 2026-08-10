import type { SettingsSection } from "@pi67/domain";
import {
  ArrowLeft,
  DownloadCloud,
  FileDown,
  Monitor,
  Moon,
  Search,
  Sun,
  UserRound,
  X
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  SearchField
} from "react-aria-components";
import { saveRuntimeDiagnostics } from "../doctor/runtime-diagnostics-controller.js";
import { useShellStore } from "../shell/shell-store.js";
import type { UpdateState } from "../updates/update-state.js";
import { checkForUpdatesNow, useUpdateStore } from "../updates/update-store.js";
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
import { ExtensionSettingsWorkspace } from "./ExtensionSettingsWorkspace.js";
import { Browser67IntegrationPanel } from "./DesktopCapabilityPanels.js";
import { PackageNetworkPanel } from "./PackageNetworkPanel.js";
import { ProviderConfigurationPanel } from "./ProviderConfigurationPanel.js";
import { RuleSettingsWorkspace } from "./RuleSettingsWorkspace.js";
import { SessionResourcePanel } from "./SessionResourcePanel.js";
import { SkillSettingsWorkspace } from "./SkillSettingsWorkspace.js";
import { SettingsDiscardDialog } from "./SettingsActionDialogs.js";
import { SettingsCategoryNavigation } from "./SettingsCategoryNavigation.js";
import {
  SettingsDraftGuardContext,
  type SettingsDraftRegistration,
  type SettingsDraftRegistrar
} from "./SettingsDraftGuard.js";
import { AboutSettings, RuntimeSettings } from "./SettingsSystemPanels.js";
import { KeyboardShortcutSettings } from "./KeyboardShortcutSettings.js";
import { LarkOfficeSettings } from "./LarkOfficeSettings.js";
import { UsageSettings } from "./UsageSettings.js";
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
  const activeSection = section === "packages" ? "extensions" : section;
  const scope = useWorkbenchStore((state) => state.settingsScope);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const currentWorkspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const workspace = useWorkbenchStore((state) => (
    currentWorkspaceId ? state.workspaces[currentWorkspaceId] : undefined
  ));
  const currentSection = SETTINGS_SECTIONS.find((item) => item.id === activeSection) ?? SETTINGS_SECTIONS[0]!;
  const currentGroup = SETTINGS_GROUPS.find((group) => group.items.some((item) => item.id === activeSection))
    ?? SETTINGS_GROUPS[0]!;
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleGroups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => matchesSettingsQuery(item, normalizedQuery))
  })).filter((group) => group.items.length > 0);
  const projectScopeAvailable = sectionSupportsProjectScope(activeSection);
  const [draftRegistration, setDraftRegistration] = useState<SettingsDraftRegistration>();
  const draftRegistrationRef = useRef<SettingsDraftRegistration | undefined>(undefined);
  const [pendingNavigation, setPendingNavigation] = useState<
    | { kind: "close" }
    | { kind: "section"; section: SettingsSection }
    | { kind: "scope"; scope: "global" | "project" }
  >();

  const registerDraft = useCallback<SettingsDraftRegistrar>((registration) => {
    draftRegistrationRef.current = registration;
    setDraftRegistration(registration);
    return () => {
      if (draftRegistrationRef.current !== registration) return;
      draftRegistrationRef.current = undefined;
      setDraftRegistration(undefined);
    };
  }, []);

  const performNavigation = useCallback((navigation: NonNullable<typeof pendingNavigation>) => {
    const store = rendererWorkbenchStore.getState();
    if (navigation.kind === "close") {
      store.closeSettings();
      return;
    }
    if (navigation.kind === "scope") {
      store.setSettingsScope(navigation.scope);
      return;
    }
    store.selectSettingsSection(navigation.section);
    if (!sectionSupportsProjectScope(navigation.section)) store.setSettingsScope("global");
  }, []);

  const requestNavigation = (navigation: NonNullable<typeof pendingNavigation>) => {
    if (navigation.kind === "section" && navigation.section === activeSection) return;
    if (navigation.kind === "scope" && navigation.scope === scope) return;
    if (draftRegistrationRef.current?.dirty) {
      setPendingNavigation(navigation);
      return;
    }
    performNavigation(navigation);
  };

  useEffect(() => {
    if (section === "packages") rendererWorkbenchStore.getState().selectSettingsSection("extensions");
  }, [section]);

  useEffect(() => {
    if (!projectScopeAvailable && scope !== "global") {
      rendererWorkbenchStore.getState().setSettingsScope("global");
    }
  }, [projectScopeAvailable, scope]);

  useEffect(() => {
    if (!pendingNavigation || !draftRegistration || draftRegistration.dirty) return;
    setPendingNavigation(undefined);
    performNavigation(pendingNavigation);
  }, [draftRegistration, pendingNavigation, performNavigation]);

  useLayoutEffect(() => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) return;
    scrollRegion.scrollTop = 0;
    scrollRegion.scrollLeft = 0;
  }, [activeSection]);

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
    <>
    <section aria-label="π 设置" className={styles.workbench} data-testid="settings-workbench">
      <aside className={styles.sidebar}>
        <div className={styles.sidebarControls}>
          <Button
            aria-label="返回工作台"
            className={styles.backButton!}
            onPress={() => requestNavigation({ kind: "close" })}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            <span>返回工作台</span>
          </Button>
          <SearchField
            aria-label="搜索设置分类"
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
              placeholder="搜索设置分类…"
              ref={searchInputRef}
            />
            {query ? <Button
              aria-label="清除设置分类搜索"
              className={styles.clearSearch!}
              onPress={() => setQuery("")}
            ><X aria-hidden="true" size={13} /></Button> : null}
          </SearchField>
        </div>
        <SettingsCategoryNavigation
          activeSection={activeSection}
          currentGroupLabel={currentGroup.label}
          currentSectionLabel={currentSection.label}
          groups={visibleGroups}
          onClearSearch={() => setQuery("")}
          onSelect={(nextSection) => requestNavigation({ kind: "section", section: nextSection })}
        />
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
                  onPress={() => requestNavigation({ kind: "scope", scope: "global" })}
                >全局</Button>
                <Button
                  className={scope === "project" ? styles.scopeSelected! : ""}
                  isDisabled={!workspace}
                  onPress={() => requestNavigation({ kind: "scope", scope: "project" })}
                >{workspace ? `项目 · ${workspace.displayName}` : "当前项目"}</Button>
              </div> : undefined}
            />
            <div className={styles.pageContent}>
              <SettingsDraftGuardContext.Provider value={registerDraft}>
                <SettingsSectionContent section={activeSection} />
              </SettingsDraftGuardContext.Provider>
            </div>
          </div>
        </div>
      </div>
    </section>
    <SettingsDiscardDialog
      busy={draftRegistration?.busy ?? false}
      open={pendingNavigation !== undefined}
      subject={draftRegistration?.subject ?? "当前设置"}
      onCancel={() => setPendingNavigation(undefined)}
      onDiscard={() => {
        const navigation = pendingNavigation;
        draftRegistrationRef.current?.discard();
        setPendingNavigation(undefined);
        if (navigation) performNavigation(navigation);
      }}
    />
    </>
  );
}

function SettingsSectionContent({ section }: { section: SettingsSection }) {
  if (section === "account") return <AccountSettings />;
  if (section === "general") return <GeneralSettings />;
  if (section === "providers") return <ProviderSettings />;
  if (section === "packages" || section === "extensions") return <ExtensionSettings />;
  if (section === "skills") return <SkillSettings />;
  if (section === "prompts") return <PromptSettings />;
  if (section === "rules") return <RuleSettingsWorkspace />;
  if (section === "lark") return <LarkOfficeSettings />;
  if (section === "integrations") return <Browser67IntegrationPanel />;
  if (section === "runtime") return <RuntimeSettings />;
  if (section === "usage") return <UsageSettings />;
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
  return (<>
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
    <KeyboardShortcutSettings />
  </>);
}

function ProviderSettings() {
  return <ProviderConfigurationPanel />;
}

function ExtensionSettings() {
  return <ExtensionSettingsWorkspace />;
}

function SkillSettings() {
  return <SkillSettingsWorkspace />;
}

function PromptSettings() {
  return (
    <SessionResourcePanel
      kind="prompt"
      title="当前会话可用的提示词模板"
      description="通过 /名称 手动调用；不会自动成为会话规则。"
      empty="当前作用域没有可用的提示词模板。"
    />
  );
}

function UpdateSettings() {
  const setUpdateDialogOpen = useShellStore((state) => state.setUpdateDialogOpen);
  const update = useUpdateStore((state) => state.update);
  const initialized = useUpdateStore((state) => state.initialized);
  const [checking, setChecking] = useState(false);
  const handleUpdateAction = async (): Promise<void> => {
    if (!initialized) return;
    if (update.phase === "available" || update.phase === "disabled") {
      setUpdateDialogOpen(true);
      return;
    }
    setChecking(true);
    try {
      const result = await checkForUpdatesNow();
      if (result.phase === "available") setUpdateDialogOpen(true);
    } finally {
      setChecking(false);
    }
  };
  return (
    <SettingsSectionBlock title="更新与诊断" description="更新检查不携带工作区、会话、模型服务或凭据信息；诊断导出默认脱敏。">
      <SettingsRows>
        <SettingsRow
          leading={<DownloadCloud aria-hidden="true" size={17} />}
          title="自动检查更新"
          description="打包版启动 10 秒后自动检查；持续运行时每天最多检查一次，不会自动下载或安装。"
          value={initialized ? (update.automaticChecks ? "已开启" : "仅打包版可用") : "正在读取…"}
        />
        <SettingsRow
          title="更新状态"
          description={updateSettingsDescription(update, initialized)}
          value={updateSettingsStatus(update, initialized)}
          actions={<Button
            className="secondary-button"
            isDisabled={checking || !initialized}
            onPress={() => void handleUpdateAction()}
          >
            {!initialized
              ? "正在读取…"
              : checking
              ? "正在检查…"
              : update.phase === "available"
                ? "查看更新"
                : update.phase === "disabled"
                  ? "查看说明"
                  : "立即检查"}
          </Button>}
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

function updateSettingsStatus(update: UpdateState, initialized: boolean): string {
  if (!initialized) return "正在读取…";
  if (update.phase === "available") return `新版本 ${update.version}`;
  if (update.phase === "current") return "已是最新版本";
  if (update.phase === "error") return "检查未完成";
  if (update.phase === "disabled") return "开发构建";
  return "等待首次检查";
}

function updateSettingsDescription(update: UpdateState, initialized: boolean): string {
  if (!initialized) return "正在读取当前版本和更新设置。";
  const checkedAt = update.checkedAt
    ? `上次检查：${new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(update.checkedAt))}。`
    : "";
  if (update.phase === "available") {
    return `当前版本 ${update.currentVersion}，可用版本 ${update.version}。${checkedAt}`;
  }
  if (update.phase === "current") return `当前版本 ${update.currentVersion}。${checkedAt}`;
  if (update.phase === "error") return `上次检查未完成，可以手动重试。${checkedAt}`;
  if (update.phase === "disabled") return "开发构建不会请求 GitHub Release。";
  return `当前版本 ${update.currentVersion}；等待启动后的首次自动检查。`;
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
