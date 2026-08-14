import type {
  DesktopRecommendedPackage,
  ExtensionPackageEntry,
  ExtensionPackageOnboardingState
} from "@pi67/domain";
import {
  CheckCircle2,
  Download,
  PackagePlus,
  RefreshCw,
  Search
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Tab,
  TabList,
  TabPanel,
  Tabs
} from "react-aria-components";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { useDesktopCapabilitySnapshot } from "./DesktopCapabilityPanels.js";
import {
  approveObservedExtensionPackage,
  checkExtensionPackageUpdates,
  declineExtensionPackageOnboarding,
  getExtensionPackageOnboarding,
  installExtensionPackage,
  loadExtensionPackages,
  restoreExtensionPackageInheritance,
  setExtensionPackageEnabled,
  uninstallExtensionPackage,
  updateExtensionPackage
} from "./extension-package-controller.js";
import { useExtensionPackageStore } from "./extension-package-store.js";
import { PackageDetails, PackageList } from "./ExtensionPackageBrowser.js";
import {
  InstallExtensionDialog,
  ObservationalMemoryOnboardingDialog,
  PackageActionDialog
} from "./ExtensionManagementDialogs.js";
import type { ConfirmedAction, PackageFilter, PackageRow } from "./extension-management-model.js";
import {
  buildPackageRows,
  filterPackageRows,
  packageResourceEnabled,
  packageRowEnabled
} from "./extension-management-model.js";
import styles from "./ExtensionManagementWorkspace.module.css";

type ExtensionView = "installed" | "discover";
type PackageFocusTarget = { action: "details" | "update"; key: string }
  | { action: "detail-back" | "updates-filter" };

const FILTERS: ReadonlyArray<{ id: PackageFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "enabled", label: "已启用" },
  { id: "disabled", label: "已停用" },
  { id: "updates", label: "可更新" }
];

export function ExtensionManagementWorkspace({ capability }: {
  capability: ReturnType<typeof useDesktopCapabilitySnapshot>;
}) {
  const scope = useWorkbenchStore((state) => state.settingsScope);
  const workspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId ?? state.currentWorkspaceId);
  const workspace = useWorkbenchStore((state) => (
    workspaceId ? state.workspaces[workspaceId] : undefined
  ));
  const items = useExtensionPackageStore((state) => state.items);
  const updates = useExtensionPackageStore((state) => state.updates);
  const phase = useExtensionPackageStore((state) => state.phase);
  const packageError = useExtensionPackageStore((state) => state.error);
  const [view, setView] = useState<ExtensionView>("installed");
  const [filter, setFilter] = useState<PackageFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [updatesChecked, setUpdatesChecked] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [pending, setPending] = useState<ConfirmedAction>();
  const [onboardingState, setOnboardingState] = useState<ExtensionPackageOnboardingState>();
  const [focusTarget, setFocusTarget] = useState<PackageFocusTarget>();
  const workspaceRef = useRef<HTMLElement>(null);
  const catalogScrollTopRef = useRef(0);
  const restoreCatalogScrollRef = useRef(false);
  const busy = phase === "loading" || phase === "checking" || phase === "mutating";
  const promptOncePackage = capability.snapshot?.recommendedExternal.find((entry) => (
    entry.installPolicy === "prompt-once"
  ));

  useEffect(() => {
    if (workspaceId) void loadExtensionPackages(workspaceId);
    setUpdatesChecked(false);
    setSelectedKey(undefined);
    setDetailOpen(false);
    catalogScrollTopRef.current = 0;
    restoreCatalogScrollRef.current = false;
  }, [workspaceId]);

  useEffect(() => {
    let current = true;
    setOnboardingState(undefined);
    if (!workspaceId || !promptOncePackage) return () => { current = false; };
    void getExtensionPackageOnboarding(promptOncePackage.source, "global", workspaceId)
      .then((state) => { if (current) setOnboardingState(state); });
    return () => { current = false; };
  }, [promptOncePackage?.source, workspaceId]);

  useLayoutEffect(() => {
    const scrollRegion = workspaceRef.current?.closest<HTMLElement>('[data-testid="settings-scroll-region"]');
    if (!scrollRegion) return;
    if (detailOpen) {
      scrollRegion.scrollTop = 0;
      return;
    }
    if (!restoreCatalogScrollRef.current) return;
    scrollRegion.scrollTop = catalogScrollTopRef.current;
    restoreCatalogScrollRef.current = false;
  }, [detailOpen]);

  const rows = useMemo(() => buildPackageRows(
    items,
    updates,
    scope
  ), [items, scope, updates]);
  const visibleRows = useMemo(() => filterPackageRows(rows, filter, query), [filter, query, rows]);
  const selected = selectedKey === undefined
    ? undefined
    : visibleRows.find((row) => row.key === selectedKey);
  const enabledCount = rows.filter(packageRowEnabled).length;
  const disabledCount = rows.length - enabledCount;
  const updateCount = rows.filter((row) => row.update !== undefined).length;

  useEffect(() => {
    if (!focusTarget || pending) return;
    const action = focusTarget.action === "updates-filter" ? "filter" : focusTarget.action;
    const candidates = workspaceRef.current?.querySelectorAll<HTMLElement>(`[data-package-focus-action="${action}"]`);
    const target = focusTarget.action === "details" || focusTarget.action === "update"
      ? Array.from(candidates ?? []).find((element) => element.dataset.packageFocusKey === focusTarget.key)
      : candidates?.item(0);
    if (!target) return;
    target.focus();
    setFocusTarget(undefined);
  }, [focusTarget, pending, visibleRows]);

  const checkUpdates = async () => {
    if (!workspaceId) return;
    const completed = await checkExtensionPackageUpdates(workspaceId);
    if (completed) setUpdatesChecked(true);
  };
  const openInstall = (source = "") => {
    setInstallSource(source);
    setInstallOpen(true);
  };
  const confirmInstall = async () => {
    if (!workspaceId || installSource.trim().length === 0) return;
    const completed = await installExtensionPackage(installSource.trim(), scope, workspaceId);
    if (!completed) return;
    setInstallOpen(false);
    setInstallSource("");
    setView("installed");
  };
  const confirmOnboardingInstall = async () => {
    if (!workspaceId || !promptOncePackage) return;
    setOnboardingState("installing");
    const completed = await installExtensionPackage(promptOncePackage.source, "global", workspaceId);
    const next = await getExtensionPackageOnboarding(promptOncePackage.source, "global", workspaceId);
    setOnboardingState(next ?? (completed ? "installed" : "install-failed"));
  };
  const declineOnboarding = async () => {
    if (!workspaceId || !promptOncePackage) return;
    const next = await declineExtensionPackageOnboarding(promptOncePackage.source, "global", workspaceId);
    if (next) setOnboardingState(next);
  };
  const confirmPackageAction = async () => {
    if (!pending || !workspaceId || phase === "mutating") return;
    const nextFocus = pending.kind === "update" ? packageFocusAfterUpdate(visibleRows, filter, pending.entry, detailOpen) : undefined;
    const completed = pending.kind === "update"
      ? await updateExtensionPackage(pending.entry.source, pending.entry.scope, workspaceId)
      : await uninstallExtensionPackage(pending.entry.source, pending.entry.scope, workspaceId);
    if (completed) {
      setFocusTarget(nextFocus);
      setPending(undefined);
    }
  };
  const openDetails = (key: string) => {
    const scrollRegion = workspaceRef.current?.closest<HTMLElement>('[data-testid="settings-scroll-region"]');
    catalogScrollTopRef.current = scrollRegion?.scrollTop ?? 0;
    restoreCatalogScrollRef.current = false;
    setSelectedKey(key);
    setDetailOpen(true);
  };
  const closeDetails = () => {
    restoreCatalogScrollRef.current = true;
    setDetailOpen(false);
  };

  return (
    <section
      className={styles.workspace}
      data-package-update-check={phase === "failed" ? "failed" : updatesChecked ? "completed" : phase}
      data-testid="extension-management-workspace"
      ref={workspaceRef}
    >
      <Tabs
        className={styles.tabs!}
        selectedKey={view}
        onSelectionChange={(key) => {
          const nextView = String(key) as ExtensionView;
          setView(nextView);
          setDetailOpen(false);
          restoreCatalogScrollRef.current = false;
        }}
      >
        <div className={styles.commandBand}>
          <TabList aria-label="Pi 扩展包管理视图" className={styles.tabList!}>
            <Tab className={styles.tab!} id="installed">已安装 <span>{rows.length}</span></Tab>
            <Tab className={styles.tab!} id="discover">
              发现扩展包 <span>{capability.snapshot?.recommendedExternal.length ?? 0}</span>
            </Tab>
          </TabList>
          <div className={styles.primaryActions}>
            <Button
              className="secondary-button"
              isDisabled={!workspaceId || busy}
              onPress={() => void checkUpdates()}
            >
              <RefreshCw aria-hidden="true" size={14} />
              {phase === "checking" ? "检查中…" : updateCount > 0 ? `更新可用 ${updateCount}` : "检查更新"}
            </Button>
            <Button
              className="primary-button"
              isDisabled={!workspaceId || busy}
              onPress={() => openInstall()}
            >
              <PackagePlus aria-hidden="true" size={14} />安装扩展包
            </Button>
          </div>
        </div>

        <TabPanel
          className={`${styles.tabPanel} ${styles.installedPanel}`}
          data-detail-open={detailOpen || undefined}
          id="installed"
        >
          <div className={styles.installedToolbar}>
            <label className={styles.packageSearch}>
              <Search aria-hidden="true" size={15} />
              <input
                aria-label="搜索已安装扩展包"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索名称、来源或作用域"
                type="search"
                value={query}
              />
            </label>
            <div aria-label="筛选已安装扩展包" className={styles.filters} role="group">
              {FILTERS.map((item) => (
                <Button
                  aria-pressed={filter === item.id}
                  className={styles.filterButton!}
                  data-package-focus-action={item.id === "updates" ? "filter" : undefined}
                  key={item.id}
                  onPress={() => setFilter(item.id)}
                >
                  {item.label}
                  {item.id === "all" ? <span>{rows.length}</span> : null}
                  {item.id === "enabled" ? <span>{enabledCount}</span> : null}
                  {item.id === "disabled" ? <span>{disabledCount}</span> : null}
                  {item.id === "updates" ? <span>{updateCount}</span> : null}
                </Button>
              ))}
            </div>
          </div>

          <div className={styles.installedFeedback}>
            {packageError ? <p className={styles.errorBanner} role="alert">{packageError}</p> : null}
            {capability.error ? <p className={styles.errorBanner} role="alert">{capability.error}</p> : null}
          </div>
          <div className={styles.managementSurface} data-detail-open={detailOpen || undefined}>
            <PackageList
              loading={phase === "loading" || capability.phase === "loading"}
              onSelect={openDetails}
              onUpdate={(entry) => setPending({ kind: "update", entry })}
              rows={visibleRows}
              selectedKey={selectedKey}
              updateDisabled={busy}
            />
            <PackageDetails
              onApprove={(entry) => void approveObservedExtensionPackage(
                entry.source,
                entry.scope,
                workspaceId
              )}
              onBack={closeDetails}
              row={selected}
              updatesChecked={updatesChecked}
              workspaceName={workspace?.displayName}
              onPending={setPending}
              onRestore={(entry) => void restoreExtensionPackageInheritance(entry.source, workspaceId)}
              onToggle={(entry, inherited, resourceType) => void setExtensionPackageEnabled(
                entry.source,
                inherited ? "project" : entry.scope,
                !packageResourceEnabled(entry, resourceType),
                workspaceId,
                resourceType
              )}
              updateDisabled={busy}
            />
          </div>
        </TabPanel>

        <TabPanel className={styles.tabPanel!} id="discover">
          <DiscoverExtensions
            entries={capability.snapshot?.recommendedExternal ?? []}
            error={capability.error}
            installed={items}
            loading={capability.phase === "loading"}
            onInstall={openInstall}
          />
        </TabPanel>

      </Tabs>

      {installOpen ? (
        <InstallExtensionDialog
          busy={phase === "mutating"}
          error={phase === "failed" ? packageError : undefined}
          scopeLabel={scope === "global" ? "全局" : `项目 · ${workspace?.displayName ?? "当前项目"}`}
          source={installSource}
          onCancel={() => setInstallOpen(false)}
          onConfirm={() => void confirmInstall()}
          onSourceChange={setInstallSource}
        />
      ) : null}
      {pending ? (
        <PackageActionDialog
          action={pending}
          busy={phase === "mutating"}
          error={phase === "failed" ? packageError : undefined}
          onCancel={() => setPending(undefined)}
          onConfirm={() => void confirmPackageAction()}
        />
      ) : null}
      {!installOpen && !pending && promptOncePackage && (
        onboardingState === "unseen" || onboardingState === "install-failed"
      ) ? (
        <ObservationalMemoryOnboardingDialog
          entry={promptOncePackage}
          failed={onboardingState === "install-failed"}
          busy={phase === "mutating"}
          onDecline={() => void declineOnboarding()}
          onInstall={() => void confirmOnboardingInstall()}
        />
      ) : null}
    </section>
  );
}

function DiscoverExtensions({ entries, installed, loading, error, onInstall }: {
  entries: DesktopRecommendedPackage[];
  installed: ExtensionPackageEntry[];
  loading: boolean;
  error: string | undefined;
  onInstall: (source: string) => void;
}) {
  return (
    <section className={styles.discoverSurface}>
      <header>
        <span className={styles.eyebrow}>可信来源目录</span>
        <h2>推荐扩展包</h2>
        <p>推荐项不会自动安装。安装前仍会确认来源、作用域和运行权限。</p>
      </header>
      {error ? <p className={styles.errorBanner} role="alert">{error}</p> : null}
      {loading && entries.length === 0 ? <p className={styles.panelEmpty}>正在读取推荐目录…</p> : null}
      {!loading && entries.length === 0 ? <p className={styles.panelEmpty}>当前目录没有推荐的第三方扩展包。</p> : null}
      <ul className={styles.discoveryList}>
        {entries.map((entry) => {
          const isInstalled = installed.some((item) => item.source === entry.source && item.installed);
          return (
            <li key={entry.id}>
              <span className={styles.discoveryIdentity}>
                <strong>{entry.id}</strong>
                <small>{entry.source}</small>
              </span>
              <span className={styles.recommendedVersion}>
                {entry.recommendedVersion ? `推荐 ${entry.recommendedVersion}` : `commit ≥ ${entry.minimumCommit?.slice(0, 10)}`}
              </span>
              {isInstalled
                ? <span className={styles.installedLabel}><CheckCircle2 aria-hidden="true" size={14} />已安装</span>
                : <Button className="secondary-button" onPress={() => onInstall(entry.source)}>
                    <Download aria-hidden="true" size={14} />安装
                  </Button>}
            </li>
          );
        })}
      </ul>
      <p className={styles.discoveryFootnote}>
        npm 与 Git 可使用下载源设置中的公共镜像；包完整性、固定 commit 和最终运行时状态仍独立校验。
      </p>
    </section>
  );
}

function packageFocusAfterUpdate(
  rows: PackageRow[], filter: PackageFilter, entry: ExtensionPackageEntry, detailOpen: boolean
): PackageFocusTarget {
  if (detailOpen) return { action: "detail-back" };
  const index = rows.findIndex((row) => (
    row.entry.source === entry.source && row.entry.scope === entry.scope
  ));
  if (filter !== "updates") {
    return { action: "details", key: rows[index]?.key ?? rows[0]?.key ?? "" };
  }
  const next = rows[index + 1] ?? rows[index - 1];
  return next ? { action: "update", key: next.key } : { action: "updates-filter" };
}
