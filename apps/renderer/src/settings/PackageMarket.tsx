import {
  nativeCapabilityReplacementLabel,
  packageMarketNpmUrl,
  type DesktopRecommendedPackage,
  type PackageMarketBrowseResult,
  type PackageMarketDetailResult,
  type PackageMarketSearchResult,
  type PackageMarketSort,
  type PackageMarketUnavailableReason
} from "@pi67/domain";
import { Download, ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "react-aria-components";
import {
  SettingsBackAction,
  SettingsCatalog,
  SettingsCatalogRow,
  SettingsDetailHeader,
  SettingsEmpty,
  SettingsIconAction,
  SettingsInfo,
  SettingsNotice,
  SettingsSectionBlock,
  SettingsSelect,
  SettingsStatus
} from "./SettingsPrimitives.js";
import {
  PACKAGE_MARKET_SORT_LABELS,
  PACKAGE_MARKET_STEP,
  browsePackageMarket,
  buildPackageMarketRows,
  formatIndexAge,
  getPackageMarketDetail,
  searchPackageMarket,
  type PackageMarketRow
} from "./package-market-model.js";
import workspaceStyles from "./ExtensionManagementWorkspace.module.css";
import styles from "./PackageMarket.module.css";

const SEARCH_DELAY_MS = 300;
const BROWSE_SORTS: readonly PackageMarketSort[] = ["popular", "updated", "name"];
const SEARCH_SORTS: readonly PackageMarketSort[] = ["relevance", "popular", "updated", "name"];
const RESOURCE_LABELS = { extension: "扩展", skill: "技能", prompt: "提示词模板", theme: "主题" } as const;

type Load<T> = { phase: "loading" } | { phase: "done"; result: T };

export function PackageMarket({ curated, installedSources, installDisabled, onInstall }: {
  curated: readonly DesktopRecommendedPackage[];
  installedSources: readonly string[];
  installDisabled: boolean;
  onInstall: (source: string) => void;
}) {
  const [browse, setBrowse] = useState<Load<PackageMarketBrowseResult>>({ phase: "loading" });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Load<PackageMarketSearchResult>>();
  const [browseSort, setBrowseSort] = useState<PackageMarketSort>("popular");
  const [searchSort, setSearchSort] = useState<PackageMarketSort>("relevance");
  const [visible, setVisible] = useState(PACKAGE_MARKET_STEP);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [selected, setSelected] = useState<PackageMarketRow>();
  const browseRequest = useRef(0);
  const searchRequest = useRef(0);
  const now = Date.now();
  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;
  const sort = searching ? searchSort : browseSort;

  const loadBrowse = (refresh: boolean) => {
    const request = ++browseRequest.current;
    setBrowse({ phase: "loading" });
    void browsePackageMarket(refresh)
      .catch((): PackageMarketBrowseResult => ({ status: "unavailable", reason: "network" }))
      .then((result) => { if (request === browseRequest.current) setBrowse({ phase: "done", result }); });
  };

  useEffect(() => { loadBrowse(false); }, []);

  // A new search starts by relevance; refining the query keeps the chosen order.
  useEffect(() => { if (searching) setSearchSort("relevance"); }, [searching]);

  useEffect(() => {
    const request = ++searchRequest.current;
    setVisible(PACKAGE_MARKET_STEP);
    if (!searching) {
      setSearch(undefined);
      return;
    }
    setSearch({ phase: "loading" });
    const timer = window.setTimeout(() => {
      void searchPackageMarket(trimmedQuery)
        .catch((): PackageMarketSearchResult => ({ status: "unavailable", query: trimmedQuery, reason: "network" }))
        .then((result) => { if (request === searchRequest.current) setSearch({ phase: "done", result }); });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [searching, trimmedQuery, searchAttempt]);

  const browseResult = browse.phase === "done" ? browse.result : undefined;
  const searchResult = search?.phase === "done" ? search.result : undefined;
  const entries = searching
    ? searchResult?.status === "ready" ? searchResult.entries : []
    : browseResult?.status === "ready" ? browseResult.index.entries : [];
  // `now` only ages labels, so it does not invalidate the rows.
  const rows = useMemo(() => buildPackageMarketRows({
    curated,
    entries,
    installedSources,
    sort,
    query: trimmedQuery,
    now
  }), [curated, entries, installedSources, sort, trimmedQuery]);

  if (selected) {
    return (
      <PackageMarketDetail
        installDisabled={installDisabled}
        row={rows.curated.concat(rows.community).find((row) => row.key === selected.key) ?? selected}
        onBack={() => setSelected(undefined)}
        onInstall={onInstall}
      />
    );
  }

  const loading = searching ? search?.phase !== "done" : browse.phase !== "done";
  const unavailable = searching
    ? searchResult?.status === "unavailable" ? searchResult.reason : undefined
    : browseResult?.status === "unavailable" ? browseResult.reason : undefined;
  const sortOptions = (searching ? SEARCH_SORTS : BROWSE_SORTS).map((id) => ({ id, label: PACKAGE_MARKET_SORT_LABELS[id] }));
  const communityTotal = searching
    ? searchResult?.status === "ready" ? searchResult.total : undefined
    : browseResult?.status === "ready" ? browseResult.index.total : undefined;

  return (
    <div className={styles.market} data-testid="package-market">
      <div className={`${workspaceStyles.installedToolbar} ${styles.toolbar}`}>
        <label className={workspaceStyles.packageSearch}>
          <Search aria-hidden="true" size={15} />
          <input
            aria-label="搜索扩展市场"
            maxLength={100}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索扩展名称或用途"
            type="search"
            value={query}
          />
          {query.length > 0 ? (
            <Button aria-label="清除搜索" className={styles.clearSearch!} onPress={() => setQuery("")}>
              <X aria-hidden="true" size={14} />
            </Button>
          ) : null}
        </label>
        <div className={styles.toolbarActions}>
          <SettingsSelect
            className={styles.sort!}
            label="排序"
            onChange={(value) => {
              setVisible(PACKAGE_MARKET_STEP);
              if (searching) setSearchSort(value);
              else setBrowseSort(value);
            }}
            options={sortOptions}
            testId="package-market-sort"
            value={sort}
          />
          <SettingsInfo label="关于排序">
            按每月下载量、最近发布时间或名称排序，范围是最热门的 500 个扩展包；输入关键词后按相关度搜索全部扩展包。生态中没有评分数据。
          </SettingsInfo>
          <SettingsIconAction
            icon={<RefreshCw aria-hidden="true" size={15} />}
            isDisabled={browse.phase === "loading"}
            label="刷新扩展市场"
            onPress={() => loadBrowse(true)}
          />
        </div>
      </div>

      {!searching && browseResult?.status === "ready" && browseResult.stale ? (
        <StaleIndexNotice
          fetchedAt={browseResult.index.fetchedAt}
          now={now}
          reason={browseResult.notice}
          onRetry={() => loadBrowse(true)}
        />
      ) : null}

      {rows.curated.length > 0 ? (
        <SettingsSectionBlock title="桌面已适配">
          <SettingsCatalog label="桌面已适配扩展包">
            {rows.curated.map((row) => (
              <MarketRow
                installDisabled={installDisabled}
                key={row.key}
                onInstall={onInstall}
                onSelect={() => setSelected(row)}
                row={row}
              />
            ))}
          </SettingsCatalog>
        </SettingsSectionBlock>
      ) : null}

      <SettingsSectionBlock
        info={(
          <SettingsInfo label="关于社区扩展">
            来自 npm 上带 pi-package 关键字的公开扩展包（与 pi.dev 相同）。社区扩展未经 Desktop 适配，部分只在终端中可用；扩展会以你的权限执行代码，安装前请确认来源。
          </SettingsInfo>
        )}
        title={communityTotal ? `社区扩展 · ${communityTotal.toLocaleString("zh-CN")}` : "社区扩展"}
      >
        {loading ? <PlaceholderRows /> : unavailable ? (
          <UnavailableState reason={unavailable} searching={searching} onRetry={() => (
            searching ? setSearchAttempt((attempt) => attempt + 1) : loadBrowse(true)
          )} />
        ) : rows.community.length === 0 ? (
          <SettingsEmpty>{searching ? `没有找到与“${trimmedQuery}”相关的扩展包。` : "扩展市场暂无内容。"}</SettingsEmpty>
        ) : (
          <>
            <SettingsCatalog label="社区扩展包">
              {rows.community.slice(0, visible).map((row) => (
                <MarketRow
                  installDisabled={installDisabled}
                  key={row.key}
                  onInstall={onInstall}
                  onSelect={() => setSelected(row)}
                  row={row}
                />
              ))}
            </SettingsCatalog>
            {rows.community.length > visible ? (
              <Button className={`secondary-button ${styles.moreButton}`} onPress={() => setVisible((count) => count + PACKAGE_MARKET_STEP)}>
                显示更多 <span className={styles.count}>{visible} / {rows.community.length}</span>
              </Button>
            ) : null}
          </>
        )}
      </SettingsSectionBlock>
    </div>
  );
}

function MarketRow({ row, installDisabled, onInstall, onSelect }: {
  row: PackageMarketRow;
  installDisabled: boolean;
  onInstall: (source: string) => void;
  onSelect: () => void;
}) {
  const installable = row.availability.kind === "installable";
  return (
    <SettingsCatalogRow
      actions={installable ? (
        <span className={styles.endSlot}>
          <Button
            aria-label={`安装 ${row.name}`}
            className={`secondary-button ${styles.installButton}`}
            isDisabled={installDisabled}
            onPress={() => onInstall(row.source)}
          >安装</Button>
        </span>
      ) : undefined}
      description={row.description ? <span lang={descriptionLang(row.description)}>{row.description}</span> : undefined}
      onSelect={onSelect}
      testId={`package-market-row-${row.name}`}
      title={row.name}
      trailing={(
        <>
          {installable ? <RowStatus row={row} /> : null}
          <span className={styles.meta}>{row.meta}</span>
          {/* Without an install button the status takes the button's end slot, so meta stays aligned. */}
          {installable ? null : <span className={`${styles.endSlot} ${styles.statusEnd}`}><RowStatus row={row} /></span>}
        </>
      )}
    />
  );
}

function RowStatus({ row }: { row: PackageMarketRow }) {
  if (row.availability.kind === "installed") return <span className={styles.installed}>已安装</span>;
  if (row.availability.kind === "native-replaced") return <SettingsStatus tone="neutral">原生能力替代</SettingsStatus>;
  if (row.availability.kind === "memory-conflict") return <SettingsStatus tone="danger">与记忆服务冲突</SettingsStatus>;
  if (row.stale) return <SettingsStatus tone="warning">长期未更新</SettingsStatus>;
  return null;
}

function PackageMarketDetail({ row, installDisabled, onBack, onInstall }: {
  row: PackageMarketRow;
  installDisabled: boolean;
  onBack: () => void;
  onInstall: (source: string) => void;
}) {
  const [detail, setDetail] = useState<Load<PackageMarketDetailResult>>();
  const backRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    backRef.current?.querySelector<HTMLElement>("button")?.focus();
    if (!row.registryName) return;
    let current = true;
    setDetail({ phase: "loading" });
    void getPackageMarketDetail(row.registryName)
      .catch((): PackageMarketDetailResult => ({ status: "unavailable", name: row.registryName!, reason: "network" }))
      .then((result) => { if (current) setDetail({ phase: "done", result }); });
    return () => { current = false; };
  }, [row.registryName]);

  const ready = detail?.phase === "done" && detail.result.status === "ready" ? detail.result.detail : undefined;
  const metaLine = [ready ? `v${ready.version}` : undefined, ready?.license, row.meta].filter(Boolean).join(" · ");
  const repositoryUrl = ready?.repositoryUrl;
  const description = ready?.description && row.description === ready.description.slice(0, row.description.length)
    ? ready.description
    : row.description;

  return (
    <section aria-label={`${row.name} 详情`} className={styles.detail} data-testid="package-market-detail">
      <SettingsDetailHeader
        actions={row.availability.kind === "installable" ? (
          <Button className="primary-button" isDisabled={installDisabled} onPress={() => onInstall(row.source)}>
            <Download aria-hidden="true" size={14} />安装
          </Button>
        ) : undefined}
        back={<div ref={backRef}><SettingsBackAction label="返回扩展市场" onPress={onBack}>扩展市场</SettingsBackAction></div>}
        detail={row.source}
        meta={metaLine}
        status={<RowStatus row={row} />}
        title={row.name}
      />
      {row.availability.kind === "native-replaced" ? (
        <SettingsNotice>{nativeCapabilityReplacementLabel(row.availability.replacement)}，Desktop 不会加载这个扩展包。</SettingsNotice>
      ) : null}
      {row.availability.kind === "memory-conflict" ? (
        <SettingsNotice tone="danger">OpenViking 是 Desktop 唯一的记忆服务，这个扩展包会与它冲突，因此不提供安装。</SettingsNotice>
      ) : null}
      {description ? <p className={styles.description} lang={descriptionLang(description)}>{description}</p> : null}
      <dl className={styles.facts}>
        <div>
          <dt>提供能力</dt>
          <dd>
            {!row.registryName ? "安装后在扩展包详情中显示"
              : detail?.phase !== "done" ? "正在读取…"
                : ready ? (ready.resourceTypes.length > 0 ? ready.resourceTypes.map((type) => RESOURCE_LABELS[type]).join("、") : "未声明")
                  : "暂时无法读取"}
          </dd>
        </div>
        <div><dt>安装来源</dt><dd className={styles.code}>{row.source}</dd></div>
      </dl>
      <div className={styles.links}>
        {row.registryName ? (
          <Button className="secondary-button" onPress={() => void window.pi67.system.requestOpenExternal(packageMarketNpmUrl(row.registryName!))}>
            <ExternalLink aria-hidden="true" size={14} />npm 页面
          </Button>
        ) : null}
        {repositoryUrl ? (
          <Button className="secondary-button" onPress={() => void window.pi67.system.requestOpenExternal(repositoryUrl)}>
            <ExternalLink aria-hidden="true" size={14} />源码仓库
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function StaleIndexNotice({ fetchedAt, now, reason, onRetry }: {
  fetchedAt: string;
  now: number;
  reason: PackageMarketUnavailableReason | undefined;
  onRetry: () => void;
}) {
  const age = formatIndexAge(fetchedAt, now);
  if (reason === "network") {
    return (
      <SettingsNotice actions={<Button className="secondary-button" onPress={onRetry}>重试</Button>} tone="warning">
        暂时无法连接 npm，正在显示 {age}的扩展目录。
      </SettingsNotice>
    );
  }
  return <p className={styles.hint}>{reason === "offline" ? "下载源已设为离线" : "当前下载源仅使用镜像"}，正在显示 {age}的扩展目录。</p>;
}

function UnavailableState({ reason, searching, onRetry }: {
  reason: PackageMarketUnavailableReason;
  searching: boolean;
  onRetry: () => void;
}) {
  if (reason === "offline") return <SettingsEmpty>下载源已设为离线，扩展市场暂不可用。可在“下载源与网络”中调整。</SettingsEmpty>;
  if (reason === "mirror-only") {
    return <SettingsEmpty>公共镜像不提供扩展搜索。可在“下载源与网络”中把 npm 下载源改为自动或官方源。</SettingsEmpty>;
  }
  return (
    <SettingsNotice actions={<Button className="secondary-button" onPress={onRetry}>重试</Button>} tone="danger">
      {searching ? "搜索失败，" : "无法读取扩展市场，"}请检查网络或代理设置后重试。
    </SettingsNotice>
  );
}

function PlaceholderRows() {
  return (
    <div aria-busy="true" aria-label="正在读取扩展市场" className={styles.placeholder} role="status">
      {Array.from({ length: 6 }, (_, index) => (
        <div className={styles.placeholderRow} key={index}>
          <span className={styles.placeholderTitle} />
          <span className={styles.placeholderLine} />
        </div>
      ))}
    </div>
  );
}

const HAN_TEXT = /[\u3400-\u9fff]/u;

/** Reviewed copy is Chinese; an author's untranslated text keeps its own language for assistive tech. */
function descriptionLang(text: string): string | undefined {
  return HAN_TEXT.test(text) ? undefined : "en";
}
