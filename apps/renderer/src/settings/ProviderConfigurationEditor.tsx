import type { PiProviderConfigurationInput, PiProviderConfigurationView } from "@pi67/protocol";
import type { ReactNode } from "react";
import { Input, TextArea } from "react-aria-components";
import { ProviderApiSelect } from "./ProviderApiSelect.js";
import { ProviderHeaderMutationEditor } from "./ProviderHeaderMutationEditor.js";
import { ProviderModelDiscovery } from "./ProviderModelDiscovery.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import styles from "./ProviderConfigurationPanel.module.css";

export function ProviderConfigurationEditor({
  apiKey,
  draft,
  hasStoredCredential,
  onApiKeyChange,
  selectedView
}: {
  apiKey: string;
  draft: PiProviderConfigurationInput;
  hasStoredCredential: boolean;
  onApiKeyChange: (value: string) => void;
  selectedView: PiProviderConfigurationView | undefined;
}) {
  const update = (mutation: (draft: PiProviderConfigurationInput) => PiProviderConfigurationInput) => (
    useProviderConfigurationStore.getState().updateDraft(mutation)
  );
  const updateOptional = (key: "name" | "baseUrl" | "api", value: string) => update((current) => {
    const next = { ...current };
    if (value.trim()) next[key] = value;
    else delete next[key];
    return next;
  });
  return (
    <section className={styles.formSection}>
      <header className={styles.sectionIntro}>
        <strong>基本配置</strong>
        <small>一组 Endpoint 与 API Key 可以发现多个协议族；每个模型保存自己的准确 Pi API。</small>
      </header>
      <div className={styles.fieldGrid}>
        <Field label="Provider ID" detail="写入 providers.<id>">
          <Input disabled={selectedView !== undefined} value={draft.id} onChange={(event) => update((current) => ({ ...current, id: event.target.value }))} />
        </Field>
        <Field label="显示名称">
          <Input value={draft.name ?? ""} onChange={(event) => updateOptional("name", event.target.value)} />
        </Field>
        <Field label="Base URL">
          <Input placeholder="https://api.example.com/v1" value={draft.baseUrl ?? ""} onChange={(event) => updateOptional("baseUrl", event.target.value)} />
        </Field>
      </div>
      <ProviderModelDiscovery
        apiKey={apiKey}
        draft={draft}
        hasStoredCredential={hasStoredCredential}
        onApiKeyChange={onApiKeyChange}
      />
      <div className={styles.checkRow}>
        <label title="关闭后，Anthropic 与 Gemini 会分别使用 x-api-key 与 x-goog-api-key 读取目录和发送请求。">
          <input checked={draft.authHeader !== false} onChange={(event) => update((current) => ({ ...current, authHeader: event.target.checked }))} type="checkbox" />
          统一使用 Authorization: Bearer（聚合服务推荐）
        </label>
        <label><input checked={draft.oauth === "radius"} onChange={(event) => update((current) => {
          const next = { ...current };
          if (event.target.checked) next.oauth = "radius";
          else delete next.oauth;
          return next;
        })} type="checkbox" />启用 Radius OAuth</label>
      </div>
      <details className={styles.advancedDetails}>
        <summary>兼容 Provider 默认协议{draft.api ? ` · ${draft.api}` : ""}</summary>
        <p>聚合服务保持未设置，并由每个模型保存协议；这里只用于维护已有的单协议 Provider。</p>
        <div className={styles.legacyApiField}>
          <ProviderApiSelect
            ariaLabel="兼容 Provider 默认 API 协议"
            onChange={(value) => updateOptional("api", value ?? "")}
            unsetDetail="不设置 Provider 默认值；每个模型单独选择协议"
            unsetLabel="由各模型指定"
            value={draft.api}
          />
        </div>
      </details>
      <details className={styles.advancedDetails}>
        <summary>自定义 Headers{selectedView?.headerNames.length ? ` · ${selectedView.headerNames.length} 项` : ""}</summary>
        <ProviderHeaderMutationEditor existingNames={selectedView?.headerNames ?? []} readOnly={false} showTitle={false} />
      </details>
      <details className={styles.advancedDetails}>
        <summary>Provider 高级 JSON{hasAdvancedJson(draft.advancedJson) ? " · 已配置" : ""}</summary>
        <p>仅接受 compat 与 modelOverrides；apiKey 和 headers 必须走专用写入路径。</p>
        <TextArea
          aria-label="Provider 高级 JSON"
          className={styles.codeArea!}
          spellCheck={false}
          value={draft.advancedJson ?? "{}"}
          onChange={(event) => update((current) => ({ ...current, advancedJson: event.target.value }))}
        />
      </details>
    </section>
  );
}

function Field({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}{detail ? <small>{detail}</small> : null}</label>;
}

function hasAdvancedJson(value: string | undefined): boolean {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== "{}");
}
