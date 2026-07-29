import type {
  PiDefaultModelConfiguration,
  PiModelConfigurationInput,
  PiModelConfigurationView,
  PiProviderConfigurationInput,
  PiProviderConfigurationView
} from "@pi67/protocol";
import { Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Input, TextArea } from "react-aria-components";
import { ProviderHeaderMutationEditor } from "./ProviderHeaderMutationEditor.js";
import {
  SettingsBackAction,
  SettingsCatalog,
  SettingsCatalogRow
} from "./SettingsPrimitives.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import panelStyles from "./ProviderConfigurationPanel.module.css";
import modelStyles from "./ProviderModelWorkspace.module.css";

const styles = { ...panelStyles, ...modelStyles };

type ModelFilter = "all" | "image" | "reasoning" | "custom";

interface ModelRow {
  index: number;
  model: PiModelConfigurationInput;
  existingView: PiModelConfigurationView | undefined;
}

const MODEL_FILTERS: Array<{ id: ModelFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "image", label: "支持图片" },
  { id: "reasoning", label: "支持推理" },
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

  const rows = useMemo<ModelRow[]>(() => draft.models.map((model, index) => ({
    index,
    model,
    existingView: modelViewFor(selectedView, model, index)
  })), [draft.models, selectedView]);
  const normalizedQuery = normalizeSearch(query);
  const filteredRows = useMemo(() => rows.filter((row) => (
    matchesModelQuery(row.model, normalizedQuery)
    && matchesModelFilter(row, filter)
  )), [filter, normalizedQuery, rows]);
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
          <header className={styles.sectionHeaderWithAction}>
            <span>
              <strong>模型目录</strong>
              <small>搜索或筛选模型，同一时间只编辑一个模型。</small>
            </span>
            {editable ? (
              <Button className="secondary-button" onPress={addModel}>
                <Plus aria-hidden="true" size={14} />添加模型
              </Button>
            ) : null}
          </header>
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
          <div className={styles.modelRows} data-testid="provider-model-list">
            <SettingsCatalog label="模型目录">
            {filteredRows.map((row) => {
              const isDefault = isDefaultModel(defaults, providerId, row.model.id);
              const isSelected = row.index === activeRow?.index;
              const capabilities = [
                isDefault ? "默认" : undefined,
                row.model.input?.includes("image") ? "图片" : undefined,
                row.model.reasoning ? "推理" : undefined,
                hasCustomOverrides(row) ? "覆盖" : undefined
              ].filter((item): item is string => item !== undefined);
              return (
                <SettingsCatalogRow
                  description={row.model.id || "等待填写 Model ID"}
                  key={`${row.index}-${row.model.id}`}
                  onSelect={() => selectModel(row.index)}
                  selected={isSelected}
                  testId="provider-model-row"
                  title={row.model.name || row.model.id || `未命名模型 ${row.index + 1}`}
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

function ModelDetailEditor({
  editable,
  existingHeaderNames,
  focusRequest,
  index,
  model,
  onBack,
  onRemove
}: {
  editable: boolean;
  existingHeaderNames: string[];
  focusRequest: number;
  index: number;
  model: PiModelConfigurationInput;
  onBack: () => void;
  onRemove: () => void;
}) {
  const modelIdInputRef = useRef<HTMLInputElement>(null);
  const update = (mutation: (draft: PiProviderConfigurationInput) => PiProviderConfigurationInput) => (
    useProviderConfigurationStore.getState().updateDraft(mutation)
  );
  const patch = (next: Partial<PiModelConfigurationInput>) => update((current) => ({
    ...current,
    models: current.models.map((candidate, candidateIndex) => {
      if (candidateIndex !== index) return candidate;
      const nextModel = { ...candidate, ...next };
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined) delete nextModel[key as keyof PiModelConfigurationInput];
      }
      return nextModel;
    })
  }));

  useEffect(() => {
    if (focusRequest > 0) modelIdInputRef.current?.focus();
  }, [focusRequest]);

  const title = model.name || model.id || `未命名模型 ${index + 1}`;
  return (
    <div className={styles.modelDetailContent}>
      <SettingsBackAction label="返回模型列表" onPress={onBack}>模型列表</SettingsBackAction>
      <div className={styles.modelDetailHeading}>
        <span>
          <small>模型详情</small>
          <strong>{title}</strong>
          <em>{editable ? "修改会保留在当前 Provider 草稿中，保存后写入 Pi。" : "Pi 内置模型，只读。"}</em>
        </span>
        {editable ? (
          <Button aria-label={`删除模型 ${title}`} className={styles.modelDeleteButton!} onPress={onRemove}>
            <Trash2 aria-hidden="true" size={14} />删除模型
          </Button>
        ) : null}
      </div>

      <div className={styles.fieldGrid}>
        <ModelField label="Model ID">
          <Input ref={modelIdInputRef} disabled={!editable} value={model.id} onChange={(event) => patch({ id: event.target.value })} />
        </ModelField>
        <ModelField label="显示名称">
          <Input disabled={!editable} value={model.name ?? ""} onChange={(event) => patchOptionalModel(patch, "name", event.target.value)} />
        </ModelField>
        <ModelField label="API 覆盖">
          <Input disabled={!editable} value={model.api ?? ""} onChange={(event) => patchOptionalModel(patch, "api", event.target.value)} />
        </ModelField>
        <ModelField label="Base URL 覆盖">
          <Input disabled={!editable} value={model.baseUrl ?? ""} onChange={(event) => patchOptionalModel(patch, "baseUrl", event.target.value)} />
        </ModelField>
        <ModelField label="Context Window">
          <Input disabled={!editable} inputMode="numeric" value={model.contextWindow?.toString() ?? ""} onChange={(event) => patchNumber(patch, "contextWindow", event.target.value)} />
        </ModelField>
        <ModelField label="Max Tokens">
          <Input disabled={!editable} inputMode="numeric" value={model.maxTokens?.toString() ?? ""} onChange={(event) => patchNumber(patch, "maxTokens", event.target.value)} />
        </ModelField>
      </div>

      <div className={styles.checkRow}>
        <label><input checked={model.input?.includes("text") ?? true} disabled type="checkbox" />文本输入</label>
        <label><input checked={model.input?.includes("image") ?? false} disabled={!editable} onChange={(event) => patch({ input: event.target.checked ? ["text", "image"] : ["text"] })} type="checkbox" />图片输入</label>
        <label><input checked={model.reasoning ?? false} disabled={!editable} onChange={(event) => patch({ reasoning: event.target.checked })} type="checkbox" />Reasoning</label>
      </div>

      <details className={styles.advancedDetails}>
        <summary>自定义 Headers{existingHeaderNames.length > 0 ? ` · ${existingHeaderNames.length} 项` : ""}</summary>
        <ProviderHeaderMutationEditor existingNames={existingHeaderNames} modelIndex={index} readOnly={!editable} showTitle={false} />
      </details>
      <details className={styles.advancedDetails}>
        <summary>模型高级 JSON{hasAdvancedJson(model.advancedJson) ? " · 已配置" : ""}</summary>
        <TextArea
          aria-label={`模型 ${model.id || index + 1} 高级 JSON`}
          className={styles.codeArea!}
          readOnly={!editable}
          spellCheck={false}
          value={model.advancedJson ?? "{}"}
          onChange={(event) => patch({ advancedJson: event.target.value })}
        />
      </details>
    </div>
  );
}

function ModelField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
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

function matchesModelFilter(row: ModelRow, filter: ModelFilter): boolean {
  if (filter === "image") return row.model.input?.includes("image") ?? false;
  if (filter === "reasoning") return row.model.reasoning ?? false;
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

function hasAdvancedJson(value: string | undefined): boolean {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== "{}");
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

function patchOptionalModel(
  update: (patch: Partial<PiModelConfigurationInput>) => void,
  key: "name" | "api" | "baseUrl",
  value: string
): void {
  update(value.trim() ? { [key]: value } : { [key]: undefined });
}

function patchNumber(
  update: (patch: Partial<PiModelConfigurationInput>) => void,
  key: "contextWindow" | "maxTokens",
  value: string
): void {
  const parsed = Number.parseInt(value, 10);
  update(Number.isSafeInteger(parsed) && parsed > 0 ? { [key]: parsed } : { [key]: undefined });
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}
