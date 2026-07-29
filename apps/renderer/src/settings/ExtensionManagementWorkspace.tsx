import type { DesktopRecommendedPackage, ExtensionPackageEntry } from "@pi67/domain";
import {
  CheckCircle2,
  Download,
  PackagePlus,
  RefreshCw,
  Search,
  ShieldCheck
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  Tab,
  TabList,
  TabPanel,
  Tabs
} from "react-aria-components";
import { ExtensionCatalog } from "../extension-ui/ExtensionCatalog.js";
import { useCommittedExtensionCatalog } from "../extension-ui/extension-ui-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { useDesktopCapabilitySnapshot } from "./DesktopCapabilityPanels.js";
import {
  checkExtensionPackageUpdates,
  installExtensionPackage,
  loadExtensionPackages,
  restoreExtensionPackageInheritance,
  setExtensionPackageEnabled,
  uninstallExtensionPackage,
  updateExtensionPackage
} from "./extension-package-controller.js";
import { useExtensionPackageStore } from "./extension-package-store.js";
import { PackageDetails, PackageList } from "./ExtensionPackageBrowser.js";
import type { ConfirmedAction, PackageFilter } from "./extension-management-model.js";
import {
  buildPackageRows,
  filterPackageRows,
  inferSourceKind,
  packageResourceEnabled,
  packageRowEnabled,
  sourceKindLabel
} from "./extension-management-model.js";
import styles from "./ExtensionManagementWorkspace.module.css";

type ExtensionView = "installed" | "discover" | "runtime";

const FILTERS: ReadonlyArray<{ id: PackageFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "enabled", label: "已启用" },
  { id: "disabled", label: "已停用" },
  { id: "updates", label: "可更新" }
];

export function ExtensionManagementWorkspace() {
  const scope = useWorkbenchStore((state) => state.settingsScope);
  const workspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId ?? state.currentWorkspaceId);
  const workspace = useWorkbenchStore((state) => (
    workspaceId ? state.workspaces[workspaceId] : undefined
  ));
  const items = useExtensionPackageStore((state) => state.items);
  const updates = useExtensionPackageStore((state) => state.updates);
  const phase = useExtensionPackageStore((state) => state.phase);
  const packageError = useExtensionPackageStore((state) => state.error);
  const capability = useDesktopCapabilitySnapshot();
  const catalog = useCommittedExtensionCatalog();
  const [view, setView] = useState<ExtensionView>("installed");
  const [filter, setFilter] = useState<PackageFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [updatesChecked, setUpdatesChecked] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [pending, setPending] = useState<ConfirmedAction>();
  const workspaceRef = useRef<HTMLElement>(null);
  const catalogScrollTopRef = useRef(0);
  const restoreCatalogScrollRef = useRef(false);
  const busy = phase === "loading" || phase === "checking" || phase === "mutating";

  useEffect(() => {
    if (workspaceId) void loadExtensionPackages(workspaceId);
    setUpdatesChecked(false);
    setSelectedKey(undefined);
    setDetailOpen(false);
    catalogScrollTopRef.current = 0;
    restoreCatalogScrollRef.current = false;
  }, [workspaceId]);

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
    capability.snapshot?.packages ?? [],
    updates,
    scope
  ), [capability.snapshot?.packages, items, scope, updates]);
  const visibleRows = useMemo(() => filterPackageRows(rows, filter, query), [filter, query, rows]);
  const selected = selectedKey === undefined
    ? undefined
    : visibleRows.find((row) => row.key === selectedKey);
  const enabledCount = rows.filter(packageRowEnabled).length;
  const disabledCount = rows.length - enabledCount;
  const updateCount = rows.filter((row) => row.kind === "configured" && row.update !== undefined).length;

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
  const confirmPackageAction = async () => {
    if (!pending || !workspaceId) return;
    const completed = pending.kind === "update"
      ? await updateExtensionPackage(pending.entry.source, pending.entry.scope, workspaceId)
      : await uninstallExtensionPackage(pending.entry.source, pending.entry.scope, workspaceId);
    if (completed) setPending(undefined);
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
    <section className={styles.workspace} data-testid="extension-management-workspace" ref={workspaceRef}>
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
          <TabList aria-label="Extension 管理视图" className={styles.tabList!}>
            <Tab className={styles.tab!} id="installed">已安装 <span>{rows.length}</span></Tab>
            <Tab className={styles.tab!} id="discover">
              发现 <span>{capability.snapshot?.recommendedExternal.length ?? 0}</span>
            </Tab>
            <Tab className={styles.tab!} id="runtime">当前会话 <span>{catalog?.total ?? "-"}</span></Tab>
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
              <PackagePlus aria-hidden="true" size={14} />安装扩展
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
                aria-label="搜索已安装扩展"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索名称、来源或作用域"
                type="search"
                value={query}
              />
            </label>
            <div aria-label="筛选已安装扩展" className={styles.filters} role="group">
              {FILTERS.map((item) => (
                <Button
                  aria-pressed={filter === item.id}
                  className={styles.filterButton!}
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
              rows={visibleRows}
              selectedKey={selectedKey}
            />
            <PackageDetails
              onBack={closeDetails}
              row={selected}
              updatesChecked={updatesChecked}
              workspaceName={workspace?.displayName}
              onPending={setPending}
              onRestore={(entry) => void restoreExtensionPackageInheritance(entry.source, workspaceId)}
              onToggle={(entry, inherited) => void setExtensionPackageEnabled(
                entry.source,
                inherited ? "project" : entry.scope,
                !packageResourceEnabled(entry),
                workspaceId,
                "extension"
              )}
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

        <TabPanel className={styles.tabPanel!} id="runtime">
          <section className={styles.runtimeSurface}>
            <header>
              <span className={styles.eyebrow}>运行时投影</span>
              <h2>当前 Session 实际加载的能力</h2>
              <p>这里显示 Pi Runtime 已发现的 Commands、Tools 与 UI 能力，不等同于已安装目录。</p>
            </header>
            <ExtensionCatalog catalog={catalog} variant="flat" />
          </section>
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
          error={phase === "failed" ? packageError : undefined}
          onCancel={() => setPending(undefined)}
          onConfirm={() => void confirmPackageAction()}
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
        <h2>推荐扩展</h2>
        <p>推荐项不会自动安装。安装前仍会确认来源、作用域和运行权限。</p>
      </header>
      {error ? <p className={styles.errorBanner} role="alert">{error}</p> : null}
      {loading && entries.length === 0 ? <p className={styles.panelEmpty}>正在读取推荐目录…</p> : null}
      {!loading && entries.length === 0 ? <p className={styles.panelEmpty}>当前安装包没有推荐第三方扩展。</p> : null}
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

function InstallExtensionDialog({ source, scopeLabel, error, busy, onSourceChange, onCancel, onConfirm }: {
  source: string;
  scopeLabel: string;
  error: string | undefined;
  busy: boolean;
  onSourceChange: (source: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const sourceKind = source.trim().length === 0 ? undefined : inferSourceKind(source);
  return (
    <ModalOverlay className="modal-overlay" isDismissable={!busy} isOpen onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label="安装 Extension" className={styles.dialog!}>
          <span className="dialog-eyebrow">Pi Package</span>
          <Heading slot="title">安装 Extension</Heading>
          <p className={styles.dialogIntro}>输入 npm 包、Git URL 或本地目录。Pi 会在执行前验证来源格式。</p>
          <label className={styles.sourceField}>
            <span>npm 包、Git URL 或本地目录</span>
            <input
              autoFocus
              disabled={busy}
              maxLength={4_096}
              onChange={(event) => onSourceChange(event.currentTarget.value)}
              placeholder="npm:@scope/package、https://…git 或 /absolute/path"
              value={source}
            />
          </label>
          <dl className={styles.dialogFacts}>
            <div><dt>识别类型</dt><dd>{sourceKind ? sourceKindLabel(sourceKind) : "等待输入"}</dd></div>
            <div><dt>安装到</dt><dd>{scopeLabel}</dd></div>
          </dl>
          <div className={styles.permissionNotice}>
            <ShieldCheck aria-hidden="true" size={17} />
            <span>Extension 在 Pi 运行环境中拥有与 Agent 相同的运行权限，安装可能访问网络并加载代码。</span>
          </div>
          {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <Button className="secondary-button" isDisabled={busy} onPress={onCancel}>取消</Button>
            <Button
              className="primary-button"
              isDisabled={busy || source.trim().length === 0}
              onPress={onConfirm}
            >{busy ? "安装中…" : "确认安装"}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function PackageActionDialog({ action, error, onCancel, onConfirm }: {
  action: ConfirmedAction;
  error: string | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const uninstall = action.kind === "uninstall";
  const title = uninstall ? "卸载 Extension？" : "更新 Extension？";
  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label={title} className={styles.dialog!}>
          <span className="dialog-eyebrow">Pi Extension 管理</span>
          <Heading slot="title">{title}</Heading>
          <dl className={styles.dialogFacts}>
            <div><dt>来源</dt><dd className={styles.codeValue}>{action.entry.source}</dd></div>
            <div><dt>作用域</dt><dd>{action.entry.scope === "global" ? "全局" : "当前项目"}</dd></div>
          </dl>
          <p className={styles.dialogIntro}>{uninstall
            ? "npm/Git 安装内容会由 Pi 移除；本地目录只移除配置引用，不删除用户目录。"
            : "更新可能访问网络并加载新的 Extension 代码。现有配置会保留在当前作用域。"}</p>
          {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <Button autoFocus className="secondary-button" onPress={onCancel}>取消</Button>
            <Button className={uninstall ? styles.confirmDanger! : "primary-button"} onPress={onConfirm}>
              {uninstall ? "确认卸载" : "确认更新"}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
