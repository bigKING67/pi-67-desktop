import type { PiProviderConfigurationView } from "@pi67/protocol";
import { Plus, Search, X } from "lucide-react";
import { Button, Input } from "react-aria-components";
import { SettingsCatalog, SettingsCatalogRow } from "./SettingsPrimitives.js";
import styles from "./ProviderCatalog.module.css";

export type ProviderCatalogView = "configured" | "available" | "custom";

const PROVIDER_CATALOG_VIEWS: ReadonlyArray<{ id: ProviderCatalogView; label: string }> = [
  { id: "configured", label: "已配置" },
  { id: "available", label: "可配置" },
  { id: "custom", label: "自定义" }
];

export function ProviderCatalog({
  providers,
  selectedProviderId,
  query,
  view,
  busy,
  onNew,
  onQueryChange,
  onSelect,
  onViewChange
}: {
  providers: readonly PiProviderConfigurationView[];
  selectedProviderId: string | undefined;
  query: string;
  view: ProviderCatalogView;
  busy: boolean;
  onNew: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (providerId: string) => void;
  onViewChange: (view: ProviderCatalogView) => void;
}) {
  const providerCounts = countProviderCatalogViews(providers);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredProviders = providers.filter((provider) => (
    providerMatchesCatalogView(provider, view)
    && (normalizedQuery.length === 0
      || (provider.name ?? provider.id).toLocaleLowerCase().includes(normalizedQuery)
      || provider.id.toLocaleLowerCase().includes(normalizedQuery))
  ));

  return (
    <section className={styles.providerCatalog} aria-label="Pi Provider 导航">
      <header className={styles.catalogIntro}>
        <strong>模型服务目录</strong>
        <small>先按当前任务查看模型服务，再进入配置；自定义服务可以同时出现在“已配置”和“自定义”中。</small>
      </header>
      <div className={styles.catalogCommandBand}>
        <nav aria-label="模型服务分类" className={styles.catalogTabs} role="tablist">
          {PROVIDER_CATALOG_VIEWS.map((item) => (
            <button
              aria-selected={view === item.id}
              className={view === item.id ? styles.selectedCatalogTab : ""}
              key={item.id}
              onClick={() => onViewChange(item.id)}
              role="tab"
              type="button"
            >
              {item.label} <span>{providerCounts[item.id]}</span>
            </button>
          ))}
        </nav>
        {view === "custom" ? (
          <Button className="primary-button" isDisabled={busy} onPress={onNew}>
            <Plus aria-hidden="true" size={14} />新建模型服务
          </Button>
        ) : null}
      </div>
      <div className={styles.providerCatalogControls}>
        <div className={styles.providerSearch}>
          <Search aria-hidden="true" size={15} />
          <Input
            aria-label="搜索 Pi Provider"
            autoComplete="off"
            placeholder="搜索名称或 ID…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query.length > 0 ? (
            <Button
              aria-label="清除 Provider 搜索"
              className={styles.providerSearchClear!}
              onPress={() => onQueryChange("")}
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </Button>
          ) : null}
        </div>
      </div>
      <div className={styles.providerList} data-testid="provider-configuration-list">
        {filteredProviders.length > 0 ? (
          <SettingsCatalog label={`${providerCatalogViewLabel(view)}模型服务列表`}>
            {filteredProviders.map((provider) => (
              <SettingsCatalogRow
                description={provider.id}
                key={provider.id}
                onSelect={() => onSelect(provider.id)}
                selected={provider.id === selectedProviderId}
                title={provider.name ?? provider.id}
                trailing={<span className={styles.providerMeta}>
                  <strong data-configured={provider.configured}>{provider.configured ? "已配置" : "待配置"}</strong>
                  <small>{provider.origin === "builtin" ? "内置" : "自定义"} · {provider.modelCount} 个模型</small>
                </span>}
              />
            ))}
          </SettingsCatalog>
        ) : <ProviderCatalogEmpty hasQuery={normalizedQuery.length > 0} view={view} />}
      </div>
    </section>
  );
}

export function defaultProviderCatalogView(
  providers: readonly PiProviderConfigurationView[]
): ProviderCatalogView {
  if (providers.some((provider) => providerMatchesCatalogView(provider, "configured"))) return "configured";
  if (providers.some((provider) => providerMatchesCatalogView(provider, "available"))) return "available";
  return "custom";
}

function ProviderCatalogEmpty({ view, hasQuery }: {
  view: ProviderCatalogView;
  hasQuery: boolean;
}) {
  if (hasQuery) {
    return <div className={styles.providerListEmpty} role="status">
      <strong>“{providerCatalogViewLabel(view)}”中没有匹配的模型服务</strong>
      <small>搜索会保留；可以切换分类继续查找。</small>
    </div>;
  }
  if (view === "configured") {
    return <div className={styles.providerListEmpty} role="status">
      <strong>尚未配置任何模型服务</strong>
      <small>前往“可配置”添加认证信息，配置完成后会出现在这里。</small>
    </div>;
  }
  if (view === "available") {
    return <div className={styles.providerListEmpty} role="status">
      <strong>没有待配置的 Pi 内置服务</strong>
      <small>当前内置服务已经全部配置，或者 Pi 尚未提供可配置目录。</small>
    </div>;
  }
  return <div className={styles.providerListEmpty} role="status">
    <strong>尚未创建自定义模型服务</strong>
    <small>自定义定义只写入 Pi models.json，不会复制内置 Provider。</small>
  </div>;
}

function providerMatchesCatalogView(
  provider: PiProviderConfigurationView,
  view: ProviderCatalogView
): boolean {
  if (view === "configured") return provider.configured;
  if (view === "available") return provider.origin === "builtin" && !provider.configured;
  return provider.origin === "models.json";
}

function countProviderCatalogViews(
  providers: readonly PiProviderConfigurationView[]
): Record<ProviderCatalogView, number> {
  return {
    configured: providers.filter((provider) => providerMatchesCatalogView(provider, "configured")).length,
    available: providers.filter((provider) => providerMatchesCatalogView(provider, "available")).length,
    custom: providers.filter((provider) => providerMatchesCatalogView(provider, "custom")).length
  };
}

function providerCatalogViewLabel(view: ProviderCatalogView): string {
  return PROVIDER_CATALOG_VIEWS.find((item) => item.id === view)?.label ?? "模型服务";
}
