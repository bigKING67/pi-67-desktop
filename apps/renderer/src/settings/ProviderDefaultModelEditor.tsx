import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover
} from "react-aria-components";
import { setDefaultModelConfiguration } from "./provider-configuration-controller.js";
import styles from "./ProviderDefaultModelEditor.module.css";

interface DefaultModelOption {
  id: string;
  label: string;
  providerLabel: string;
  modelLabel: string;
  providerId: string;
  modelId: string;
  searchText: string;
  unset?: boolean;
}

const DEFAULT_MODEL_RESULT_LIMIT = 100;
const UNSET_MODEL_KEY = "__pi67_unset_default_model__";
const UNSET_MODEL_OPTION: DefaultModelOption = {
  id: UNSET_MODEL_KEY,
  label: "未设置",
  providerLabel: "",
  modelLabel: "未设置",
  providerId: "",
  modelId: "",
  searchText: "未设置",
  unset: true
};

export function ProviderDefaultModelEditor({
  snapshot,
  workspaceId
}: {
  snapshot: PiProviderConfigurationSnapshot;
  workspaceId: string;
}) {
  const options = useMemo<DefaultModelOption[]>(() => snapshot.providers.flatMap((provider) => (
    provider.models.map((model) => {
      const providerLabel = provider.name ?? provider.id;
      const modelLabel = model.name ?? model.id;
      return {
        id: defaultModelKey(provider.id, model.id),
        label: `${providerLabel} / ${modelLabel}`,
        providerLabel,
        modelLabel,
        providerId: provider.id,
        modelId: model.id,
        searchText: normalizeSearch(`${providerLabel} ${provider.id} ${modelLabel} ${model.id}`)
      };
    })
  )), [snapshot.providers]);

  return (
    <section className={styles.section}>
      <header className={styles.sectionIntro}>
        <strong>默认模型</strong>
        <small>按 Provider、模型名称或 Model ID 搜索；全局和项目选择分别写入 Pi settings.json。</small>
      </header>
      <div className={styles.defaultGrid}>
        <DefaultModelCombobox
          label="全局默认"
          onChange={(selection) => void setDefaultModelConfiguration("global", selection, workspaceId)}
          options={options}
          value={snapshot.defaults.global ? defaultModelKey(snapshot.defaults.global.provider, snapshot.defaults.global.model) : UNSET_MODEL_KEY}
        />
        <DefaultModelCombobox
          disabled={!snapshot.defaults.projectTrusted}
          label="项目默认"
          onChange={(selection) => void setDefaultModelConfiguration("project", selection, workspaceId)}
          options={options}
          value={snapshot.defaults.project ? defaultModelKey(snapshot.defaults.project.provider, snapshot.defaults.project.model) : UNSET_MODEL_KEY}
        />
      </div>
      <div className={styles.effectiveDefault}>
        <span>当前生效</span>
        <strong>{snapshot.defaults.effective ? `${snapshot.defaults.effective.provider} / ${snapshot.defaults.effective.model}` : "未设置"}</strong>
        <small>运行中的任务会在当前 Operation 结束后应用目录变更。</small>
      </div>
      {!snapshot.defaults.projectTrusted ? <p className={styles.trustNotice}>信任当前 Workspace 后才能读取和修改项目级 Pi settings.json。</p> : null}
    </section>
  );
}

function DefaultModelCombobox({ label, value, options, disabled, onChange }: {
  label: string;
  value: string;
  options: DefaultModelOption[];
  disabled?: boolean;
  onChange: (selection: { provider: string; model: string } | undefined) => void;
}) {
  const selectedOption = value === UNSET_MODEL_KEY
    ? UNSET_MODEL_OPTION
    : options.find((option) => option.id === value);
  const selectedLabel = selectedOption?.label ?? UNSET_MODEL_OPTION.label;
  const [inputValue, setInputValue] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const normalizedQuery = normalizeSearch(inputValue);
  const matchedOptions = useMemo(() => (
    normalizedQuery.length === 0
      ? options
      : options.filter((option) => option.searchText.includes(normalizedQuery))
  ), [normalizedQuery, options]);
  const visibleOptions = useMemo(() => {
    const limited = matchedOptions.slice(0, DEFAULT_MODEL_RESULT_LIMIT);
    const withUnset = normalizedQuery.length === 0 ? [UNSET_MODEL_OPTION, ...limited] : limited;
    if (selectedOption && !withUnset.some((option) => option.id === selectedOption.id)) {
      return [selectedOption, ...withUnset];
    }
    return withUnset;
  }, [matchedOptions, normalizedQuery.length, selectedOption]);

  useEffect(() => {
    if (!open) setInputValue(selectedLabel);
  }, [open, selectedLabel]);

  return (
    <ComboBox
      allowsEmptyCollection
      className={styles.defaultCombobox!}
      defaultFilter={() => true}
      inputValue={inputValue}
      isDisabled={disabled ?? false}
      items={visibleOptions}
      menuTrigger="focus"
      onInputChange={setInputValue}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        setInputValue(isOpen ? "" : selectedLabel);
      }}
      onSelectionChange={(key) => {
        if (key === null || key === UNSET_MODEL_KEY) {
          onChange(undefined);
          setInputValue(UNSET_MODEL_OPTION.label);
          return;
        }
        const option = options.find((candidate) => candidate.id === key);
        if (!option) return;
        onChange({ provider: option.providerId, model: option.modelId });
        setInputValue(option.label);
      }}
      selectedKey={value}
    >
      <Label>{label}</Label>
      <div className={styles.defaultComboboxControl}>
        <Search aria-hidden="true" size={14} />
        <Input placeholder="搜索 Provider 或模型…" />
        <Button aria-label={`展开${label}模型列表`}>
          <ChevronDown aria-hidden="true" size={14} />
        </Button>
      </div>
      <Popover className={styles.defaultModelPopover!} placement="bottom start">
        <ListBox className={styles.defaultModelList!} renderEmptyState={() => (
          <div className={styles.defaultModelEmpty}>没有匹配的 Provider 或模型。</div>
        )}>
          {(option: DefaultModelOption) => (
            <ListBoxItem className={styles.defaultModelOption!} id={option.id} textValue={option.label}>
              <span>
                <strong>{option.modelLabel}</strong>
                <small>{option.unset ? "移除当前作用域的默认模型" : `${option.providerLabel} · ${option.providerId} / ${option.modelId}`}</small>
              </span>
            </ListBoxItem>
          )}
        </ListBox>
        {matchedOptions.length > DEFAULT_MODEL_RESULT_LIMIT ? (
          <div className={styles.defaultModelLimit}>显示前 {DEFAULT_MODEL_RESULT_LIMIT} 项，继续输入可缩小范围。</div>
        ) : null}
      </Popover>
    </ComboBox>
  );
}

function defaultModelKey(provider: string, model: string): string {
  return `${encodeURIComponent(provider)}::${encodeURIComponent(model)}`;
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}
