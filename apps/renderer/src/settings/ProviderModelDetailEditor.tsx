import type { PiModelConfigurationInput, PiProviderConfigurationInput } from "@pi67/protocol";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button, Input, TextArea } from "react-aria-components";
import { ProviderApiSelect } from "./ProviderApiSelect.js";
import { ProviderHeaderMutationEditor } from "./ProviderHeaderMutationEditor.js";
import { SettingsBackAction, SettingsCheckbox, SettingsDetails } from "./SettingsPrimitives.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import panelStyles from "./ProviderConfigurationPanel.module.css";
import modelStyles from "./ProviderModelWorkspace.module.css";

const styles = { ...panelStyles, ...modelStyles };

export function ModelDetailEditor({
  editable,
  existingHeaderNames,
  focusRequest,
  index,
  model,
  onBack,
  onRemove,
  providerApi
}: {
  editable: boolean;
  existingHeaderNames: string[];
  focusRequest: number;
  index: number;
  model: PiModelConfigurationInput;
  onBack: () => void;
  onRemove: () => void;
  providerApi: string | undefined;
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
        <div className={styles.field}>
          <span>API 协议覆盖</span>
          <ProviderApiSelect
            ariaLabel={`模型 ${title} API 协议覆盖`}
            disabled={!editable}
            onChange={(value) => patchOptionalModel(patch, "api", value ?? "")}
            unsetDetail={providerApi ? `使用 Provider 默认值 ${providerApi}` : "当前 Provider 未设置默认协议"}
            unsetLabel="继承 Provider 默认"
            value={model.api}
          />
        </div>
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
        <SettingsCheckbox isDisabled isSelected={model.input?.includes("text") ?? true} onChange={() => undefined}>文本输入</SettingsCheckbox>
        <SettingsCheckbox isDisabled={!editable} isSelected={model.input?.includes("image") ?? false}
          onChange={(selected) => patch({ input: selected ? ["text", "image"] : ["text"] })}>图片输入</SettingsCheckbox>
        <SettingsCheckbox isDisabled={!editable} isSelected={model.reasoning ?? false}
          onChange={(selected) => patch({ reasoning: selected })}>Reasoning</SettingsCheckbox>
      </div>

      <SettingsDetails summary={existingHeaderNames.length > 0 ? `${existingHeaderNames.length} 项` : ""} title="自定义 Headers">
        <ProviderHeaderMutationEditor existingNames={existingHeaderNames} modelIndex={index} readOnly={!editable} showTitle={false} />
      </SettingsDetails>
      <SettingsDetails summary={hasAdvancedJson(model.advancedJson) ? "已配置" : ""} title="模型高级 JSON">
        <TextArea
          aria-label={`模型 ${model.id || index + 1} 高级 JSON`}
          className={styles.codeArea!}
          readOnly={!editable}
          spellCheck={false}
          value={model.advancedJson ?? "{}"}
          onChange={(event) => patch({ advancedJson: event.target.value })}
        />
      </SettingsDetails>
    </div>
  );
}

function ModelField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}

export function hasAdvancedJson(value: string | undefined): boolean {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== "{}");
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
