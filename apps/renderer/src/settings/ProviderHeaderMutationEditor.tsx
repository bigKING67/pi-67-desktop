import type { PiConfigurationHeaderMutation, PiProviderConfigurationInput } from "@pi67/protocol";
import { useMemo, useState } from "react";
import { Button, Input } from "react-aria-components";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import styles from "./ProviderConfigurationPanel.module.css";

const EMPTY_HEADER_MUTATIONS: PiConfigurationHeaderMutation[] = [];

export function ProviderHeaderMutationEditor({
  existingNames,
  modelIndex,
  readOnly = false,
  showTitle = true
}: {
  existingNames: string[];
  modelIndex?: number;
  readOnly?: boolean;
  showTitle?: boolean;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const mutations = useProviderConfigurationStore((state) => (
    modelIndex === undefined
      ? state.draft?.headers
      : state.draft?.models[modelIndex]?.headers
  )) ?? EMPTY_HEADER_MUTATIONS;
  const update = (mutation: (draft: PiProviderConfigurationInput) => PiProviderConfigurationInput) => (
    useProviderConfigurationStore.getState().updateDraft(mutation)
  );
  const visibleNames = useMemo(() => {
    const removed = new Set(mutations.filter((item) => item.remove).map((item) => item.name));
    return [...new Set([...existingNames, ...mutations.filter((item) => item.value).map((item) => item.name)])]
      .filter((item) => !removed.has(item));
  }, [existingNames, mutations]);
  const apply = (mutation: PiConfigurationHeaderMutation) => update((draft) => {
    const merge = (items: PiConfigurationHeaderMutation[] | undefined) => [
      ...(items ?? []).filter((item) => item.name.toLocaleLowerCase() !== mutation.name.toLocaleLowerCase()),
      mutation
    ];
    if (modelIndex === undefined) return { ...draft, headers: merge(draft.headers) };
    return {
      ...draft,
      models: draft.models.map((model, index) => index === modelIndex ? { ...model, headers: merge(model.headers) } : model)
    };
  });

  return (
    <div className={styles.headersEditor}>
      {showTitle ? (
        <span>
          <strong>自定义 Headers</strong>
          <small>{readOnly ? "Pi 配置中只显示 Header 名称。" : "值只在本次保存请求中发送，保存后不会回显。"}</small>
        </span>
      ) : null}
      {visibleNames.length > 0 ? (
        <div className={styles.headerChips}>
          {visibleNames.map((header) => (
            <span key={header}>
              {header}
              {readOnly ? null : (
                <button aria-label={`移除 ${header}`} onClick={() => apply({ name: header, remove: true })} type="button">×</button>
              )}
            </span>
          ))}
        </div>
      ) : <small className={styles.headerEmpty}>尚未配置自定义 Header。</small>}
      {readOnly ? null : (
        <div className={styles.headerInputs}>
          <Input aria-label="Header 名称" placeholder="Header 名称" value={name} onChange={(event) => setName(event.target.value)} />
          <Input
            aria-label="Header 值"
            autoComplete="new-password"
            placeholder="写入值（不会回显）"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button isDisabled={!name.trim() || !value} onPress={() => {
            apply({ name: name.trim(), value });
            setName("");
            setValue("");
          }}>写入</Button>
        </div>
      )}
    </div>
  );
}
