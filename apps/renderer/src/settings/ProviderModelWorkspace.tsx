import type {
  PiDefaultModelConfiguration, PiModelConfigurationInput,
  PiModelConfigurationView,
  PiProviderConfigurationInput,
  PiProviderConfigurationView
} from "@pi67/protocol";
import { Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "react-aria-components";
import { hasAdvancedJson, ModelDetailEditor } from "./ProviderModelDetailEditor.js";
import { SettingsCatalog, SettingsCatalogRow, SettingsIconAction } from "./SettingsPrimitives.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import { modelCapabilityView } from "./provider-model-capabilities.js";
import panelStyles from "./ProviderConfigurationPanel.module.css";
import modelStyles from "./ProviderModelWorkspace.module.css";

const styles = { ...panelStyles, ...modelStyles };

type ModelFilter = "all" | "image" | "reasoning" | "native-search" | "custom";

interface ModelRow {
  index: number;
  model: PiModelConfigurationInput;
  existingView: PiModelConfigurationView | undefined;
}

const MODEL_FILTERS: Array<{ id: ModelFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "image", label: "支持图片" },
  { id: "reasoning", label: "支持推理" },
  { id: "native-search", label: "原生搜索" },
  { id: "custom", label: "自定义覆盖" }
];

export function ProviderModelWorkspace({
  draft,
  selectedView,
  defaults,
  editable
}: {
  draft: PiProviderConfigurationInput;
  selectedView: PiProviderConfigurationView | undefined;
  defaults: PiDefaultModelConfiguration;
  editable: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ModelFilter>("all");
  const [preferredModelIndex, setPreferredModelIndex] = useState<number | undefined>(draft.models.length > 0 ? 0 : undefined);
  const [detailOpen, setDetailOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const modelSectionRef = useRef<HTMLElement>(null);
  const catalogScrollTopRef = useRef(0);
  const restoreCatalogScrollRef = useRef(false);
  const modelRowsRef = useRef<HTMLDivElement>(null);
  const [focusAfterRemoval, setFocusAfterRemoval] = useState<number>();
  const update = (mutation: (draft: PiProviderConfigurationInput) => PiProviderConfigurationInput) => (
    useProviderConfigurationStore.getState().updateDraft(mutation)
  );

  useEffect(() => {
    if (draft.models.length === 0) {
      setPreferredModelIndex(undefined);
      setDetailOpen(false);
      return;
    }
    setPreferredModelIndex((current) => current === undefined || current >= draft.models.length
      ? draft.models.length - 1
      : current);
  }, [draft.models.length]);

  useLayoutEffect(() => {
    const scrollRegion = modelSectionRef.current?.closest<HTMLElement>('[data-testid="settings-scroll-region"]');
    if (!scrollRegion) return;
    if (detailOpen) {
      scrollRegion.scrollTop = 0;
      return;
    }
    if (!restoreCatalogScrollRef.current) return;
    scrollRegion.scrollTop = catalogScrollTopRef.current;
    restoreCatalogScrollRef.current = false;
  }, [detailOpen]);

  // Removing a row unmounts its focused button: hand focus to the action now at that position.
  useEffect(() => {
    if (focusAfterRemoval === undefined) return;
    setFocusAfterRemoval(undefined);
    const actions = modelRowsRef.current?.querySelectorAll<HTMLElement>('[data-model-action="remove"] button');
    if (!actions || actions.length === 0) return;
    actions[Math.min(focusAfterRemoval, actions.length - 1)]?.focus();
  }, [focusAfterRemoval, draft.models]);

  const rows = useMemo<ModelRow[]>(() => draft.models.map((model, index) => ({
    index,
    model,
    existingView: modelViewFor(selectedView, model, index)
  })), [draft.models, selectedView]);
  const normalizedQuery = normalizeSearch(query);
  const filteredRows = useMemo(() => rows.filter((row) => (
    matchesModelQuery(row.model, normalizedQuery)
    && matchesModelFilter(row, filter, selectedView?.id ?? draft.id, draft.api)
  )), [draft.api, draft.id, filter, normalizedQuery, rows, selectedView?.id]);
  const activeRow = filteredRows.find((row) => row.index === preferredModelIndex) ?? filteredRows[0];
  const providerId = selectedView?.id ?? draft.id;

  const selectModel = (index: number) => {
    const scrollRegion = modelSectionRef.current?.closest<HTMLElement>('[data-testid="settings-scroll-region"]');
    catalogScrollTopRef.current = scrollRegion?.scrollTop ?? 0;
    restoreCatalogScrollRef.current = false;
    setPreferredModelIndex(index);
    setDetailOpen(true);
  };
  const addModel = () => {
    const scrollRegion = modelSectionRef.current?.closest<HTMLElement>('[data-testid="settings-scroll-region"]');
    catalogScrollTopRef.current = scrollRegion?.scrollTop ?? 0;
    restoreCatalogScrollRef.current = false;
    const nextIndex = draft.models.length;
    update((current) => ({
      ...current,
      models: [...current.models, { id: "", input: ["text"], reasoning: false, advancedJson: "{}" }]
    }));
    setQuery("");
    setFilter("all");
    setPreferredModelIndex(nextIndex);
    setDetailOpen(true);
    setFocusRequest((current) => current + 1);
  };
  const removeModel = (index: number) => {
    const nextLength = Math.max(0, draft.models.length - 1);
    update((current) => ({
      ...current,
      models: current.models.filter((_, candidateIndex) => candidateIndex !== index)
    }));
    if (nextLength === 0) {
      setPreferredModelIndex(undefined);
      setDetailOpen(false);
      return;
    }
    setPreferredModelIndex(Math.min(index, nextLength - 1));
    restoreCatalogScrollRef.current = true;
    setDetailOpen(false);
  };
  const removeCatalogModel = (index: number, position: number) => {
    update((current) => ({
      ...current,
      models: current.models.filter((_, candidateIndex) => candidateIndex !== index)
    }));
    setPreferredModelIndex((current) => current !== undefined && current > index ? current - 1 : current);
    setFocusAfterRemoval(position);
  };
  const closeDetail = () => {
    restoreCatalogScrollRef.current = true;
    setDetailOpen(false);
  };

  return (
    <section
      className={styles.modelSection}
      aria-label="模型管理"
      data-view={detailOpen ? "detail" : "catalog"}
      ref={modelSectionRef}
    >
      {!detailOpen ? (
        <div className={styles.modelCatalog}>
          {editable ? (
            <header className={styles.sectionHeaderWithAction}>
              <Button className="secondary-button" onPress={addModel}>
                <Plus aria-hidden="true" size={14} />添加模型
              </Button>
            </header>
          ) : null}
          <div className={styles.modelToolbar}>
            <div className={styles.modelSearch}>
              <Search aria-hidden="true" size={15} />
              <Input
                aria-label="搜索模型"
                autoComplete="off"
                placeholder="搜索模型名称或 Model ID…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query.length > 0 ? (
                <Button aria-label="清除模型搜索" className={styles.modelSearchClear!} onPress={() => setQuery("")}>
                  <X aria-hidden="true" size={14} />
                </Button>
              ) : null}
            </div>
            <div className={styles.modelFilters} aria-label="模型能力筛选" role="group">
              {MODEL_FILTERS.map((item) => (
                <Button
                  aria-pressed={filter === item.id}
                  className={filter === item.id ? styles.selectedModelFilter! : ""}
                  key={item.id}
                  onPress={() => setFilter(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
          <div className={styles.modelResultsSummary} aria-live="polite">
            <span>{filteredRows.length === rows.length ? `${rows.length} 个模型` : `${filteredRows.length} / ${rows.length} 个模型`}</span>
            {preferredModelIndex !== undefined && !activeRow && filteredRows.length === 0 ? <small>清除筛选后会恢复之前选择的模型。</small> : null}
          </div>
          <div className={styles.modelRows} data-testid="provider-model-list" ref={modelRowsRef}>
            <SettingsCatalog label="模型目录">
            {filteredRows.map((row, position) => {
              const isDefault = isDefaultModel(defaults, providerId, row.model.id);
              const isSelected = row.index === activeRow?.index;
              const capability = modelCapabilityView(
                providerId,
                row.model,
                row.existingView,
                draft.api
              );
              const capabilities = [
                isDefault ? "默认" : undefined,
                `协议 ${capability.protocol}`,
                capability.image ? "图片" : "仅文本",
                capability.reasoning ? "推理" : "无推理",
                capability.search === "native-declared" ? "原生搜索 · 已声明" : "原生搜索 · 不可用",
                hasCustomOverrides(row) ? "覆盖" : undefined
              ].filter((item): item is string => item !== undefined);
              const title = row.model.name || row.model.id || `未命名模型 ${row.index + 1}`;
              return (
                <SettingsCatalogRow
                  actions={editable ? <span data-model-action="remove" className={styles.modelRowAction}>
                    <SettingsIconAction
                      icon={<Trash2 aria-hidden="true" size={14} />}
                      label={`删除模型 ${title}`}
                      onPress={() => removeCatalogModel(row.index, position)}
                    />
                  </span> : undefined}
                  description={row.model.id || "等待填写 Model ID"}
                  key={`${row.index}-${row.model.id}`}
                  onSelect={() => selectModel(row.index)}
                  selected={isSelected}
                  testId="provider-model-row"
                  title={title}
                  trailing={capabilities.length > 0 ? <span className={styles.modelCapabilities}>
                    {capabilities.join(" · ")}
                  </span> : undefined}
                />
              );
            })}
            {rows.length === 0 ? (
              <div className={styles.modelEmpty}>
                <strong>还没有模型</strong>
                <span>{editable ? "添加一个模型后即可保存 Provider。" : "这个 Provider 当前没有可用模型。"}</span>
              </div>
            ) : null}
            {rows.length > 0 && filteredRows.length === 0 ? (
              <div className={styles.modelEmpty}>
                <strong>没有匹配的模型</strong>
                <span>尝试更换搜索词或能力筛选。</span>
                <Button className="secondary-button" onPress={() => {
                  setQuery("");
                  setFilter("all");
                }}>清除筛选</Button>
              </div>
            ) : null}
            </SettingsCatalog>
          </div>
        </div>
      ) : (
        <div className={styles.modelDetail} data-testid="provider-model-detail">
          {activeRow ? (
            <ModelDetailEditor
              editable={editable}
              existingHeaderNames={activeRow.existingView?.headerNames ?? []}
              focusRequest={focusRequest}
              index={activeRow.index}
              model={activeRow.model}
              onBack={closeDetail}
              onRemove={() => removeModel(activeRow.index)}
              providerApi={draft.api}
            />
          ) : (
            <div className={styles.modelDetailEmpty}>
              <strong>{filteredRows.length === 0 && rows.length > 0 ? "没有符合条件的模型" : "选择一个模型"}</strong>
              <span>{filteredRows.length === 0 && rows.length > 0 ? "清除搜索或筛选后继续编辑。" : "从左侧模型目录打开详情。"}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function modelViewFor(
  provider: PiProviderConfigurationView | undefined,
  model: PiModelConfigurationInput,
  index: number
): PiModelConfigurationView | undefined {
  return provider?.models.find((candidate) => candidate.id === model.id) ?? provider?.models[index];
}

function matchesModelQuery(model: PiModelConfigurationInput, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return normalizeSearch(model.name ?? "").includes(normalizedQuery)
    || normalizeSearch(model.id).includes(normalizedQuery);
}

function matchesModelFilter(
  row: ModelRow,
  filter: ModelFilter,
  providerId: string,
  providerApi: string | undefined
): boolean {
  if (filter === "image") return row.model.input?.includes("image") ?? false;
  if (filter === "reasoning") return row.model.reasoning ?? false;
  if (filter === "native-search") {
    return modelCapabilityView(providerId, row.model, row.existingView, providerApi).search
      === "native-declared";
  }
  if (filter === "custom") return hasCustomOverrides(row);
  return true;
}

function hasCustomOverrides(row: ModelRow): boolean {
  return Boolean(
    row.model.api?.trim()
    || row.model.baseUrl?.trim()
    || row.model.headers?.length
    || row.existingView?.headerNames.length
    || hasAdvancedJson(row.model.advancedJson)
  );
}

function isDefaultModel(
  defaults: PiDefaultModelConfiguration,
  provider: string,
  model: string
): boolean {
  return [defaults.global, defaults.project, defaults.effective].some((selection) => (
    selection?.provider === provider && selection.model === model
  ));
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}
