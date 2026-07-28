import type {
  PiConfigurationHeaderMutation,
  PiModelConfigurationInput,
  PiProviderConfigurationInput,
  PiProviderConfigurationView
} from "@pi67/protocol";
import {
  AlertTriangle,
  Check,
  FileJson2,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, TextArea } from "react-aria-components";
import { useShellStore } from "../shell/shell-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  loadProviderConfiguration,
  reloadProviderConfiguration,
  removeProviderConfiguration,
  saveProviderConfiguration,
  setDefaultModelConfiguration
} from "./provider-configuration-controller.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import styles from "./ProviderConfigurationPanel.module.css";

export function ProviderConfigurationPanel() {
  const workspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId ?? state.currentWorkspaceId);
  const snapshot = useProviderConfigurationStore((state) => state.snapshot);
  const draft = useProviderConfigurationStore((state) => state.draft);
  const selectedProviderId = useProviderConfigurationStore((state) => state.selectedProviderId);
  const dirty = useProviderConfigurationStore((state) => state.dirty);
  const externalConflict = useProviderConfigurationStore((state) => state.externalConflict);
  const phase = useProviderConfigurationStore((state) => state.phase);
  const error = useProviderConfigurationStore((state) => state.error);
  const storeWorkspaceId = useProviderConfigurationStore((state) => state.workspaceId);
  const setCredentialDialogOpen = useShellStore((state) => state.setCredentialDialogOpen);

  useEffect(() => {
    if (!workspaceId) {
      useProviderConfigurationStore.getState().reset();
      return;
    }
    void loadProviderConfiguration(workspaceId);
  }, [workspaceId]);

  if (!workspaceId) {
    return <PanelEmpty title="先打开一个工作区" detail="Pi 配置命令需要明确的 Workspace authority。" />;
  }
  if (phase === "loading" && (!snapshot || storeWorkspaceId !== workspaceId)) {
    return <PanelEmpty title="正在读取 Pi 配置" detail="从 models.json、auth.json 与 settings.json 建立安全投影。" />;
  }
  if (!snapshot || storeWorkspaceId !== workspaceId) {
    return <PanelEmpty
      title="Pi 配置尚不可用"
      detail={error ?? "请确认 Agent Host 已连接，然后重新加载。"}
      action={<Button className="secondary-button" onPress={() => void loadProviderConfiguration(workspaceId)}>重试</Button>}
    />;
  }

  const selectedView = snapshot.providers.find((provider) => provider.id === selectedProviderId);
  const editable = selectedView?.origin === "models.json" || selectedProviderId === undefined;
  const canSave = editable
    && dirty
    && phase !== "saving"
    && Boolean(draft?.id.trim())
    && Boolean(draft?.models.length)
    && draft!.models.every((model) => model.id.trim().length > 0);

  return (
    <div className={styles.panel} data-testid="provider-configuration-panel">
      <ConfigurationStatusBar
        snapshot={snapshot}
        busy={phase === "saving"}
        onNew={() => useProviderConfigurationStore.getState().startProvider()}
        onReload={() => void reloadProviderConfiguration(workspaceId)}
      />
      {externalConflict ? (
        <div className={styles.conflict} role="alert" data-testid="provider-configuration-conflict">
          <AlertTriangle aria-hidden="true" size={17} />
          <span>
            <strong>Pi 配置已在外部修改</strong>
            <small>你的未保存草稿仍被保留。当前草稿基于旧 revision，保存会被阻止。</small>
          </span>
          <Button onPress={() => useProviderConfigurationStore.getState().adoptExternal()}>
            放弃草稿并采用最新配置
          </Button>
        </div>
      ) : null}
      {snapshot.syncState === "invalid" ? (
        <div className={styles.invalid} role="alert">
          <AlertTriangle aria-hidden="true" size={17} />
          <span><strong>Pi 配置文件当前无效</strong><small>Desktop 保留上一次安全投影，不会自动重写文件。</small></span>
        </div>
      ) : null}
      <div className={styles.workspace}>
        <aside className={styles.providerList} aria-label="Pi Provider 列表">
          {snapshot.providers.map((provider) => (
            <button
              className={provider.id === selectedProviderId ? styles.selectedProvider : ""}
              key={provider.id}
              onClick={() => useProviderConfigurationStore.getState().selectProvider(provider.id)}
              type="button"
            >
              <span><strong>{provider.name ?? provider.id}</strong><small>{provider.id}</small></span>
              <em data-configured={provider.configured}>{provider.origin === "builtin" ? "内置" : `${provider.models.length} 模型`}</em>
            </button>
          ))}
          {snapshot.providers.length === 0 ? <p>尚未发现 Provider。</p> : null}
        </aside>
        <main className={styles.editor}>
          {draft ? (
            <>
              <div className={styles.editorHeading}>
                <span>
                  <strong>{selectedProviderId ? (selectedView?.name ?? selectedProviderId) : "新建 Provider"}</strong>
                  <small>{editable ? "保存会原子更新 Pi models.json" : "Pi 内置 Provider 只能管理凭据与默认模型"}</small>
                </span>
                <div>
                  <Button className="secondary-button" onPress={() => setCredentialDialogOpen(true)}>
                    <KeyRound aria-hidden="true" size={14} />管理凭据
                  </Button>
                  {selectedProviderId && editable ? (
                    <Button className={styles.dangerButton!} onPress={() => void removeProviderConfiguration(selectedProviderId, workspaceId)}>
                      <Trash2 aria-hidden="true" size={14} />移除
                    </Button>
                  ) : null}
                  {editable ? (
                    <Button className="primary-button" isDisabled={!canSave} onPress={() => void saveProviderConfiguration(workspaceId)}>
                      <Save aria-hidden="true" size={14} />{phase === "saving" ? "保存中…" : "保存到 Pi"}
                    </Button>
                  ) : null}
                </div>
              </div>
              {editable ? <ProviderEditor draft={draft} selectedView={selectedView} /> : (
                <div className={styles.readOnlyNotice}>内置 Provider 由 Pi 运行时提供，不在 models.json 中创建 Desktop 私有副本。</div>
              )}
            </>
          ) : <PanelEmpty title="选择或新建 Provider" detail="常用字段使用表单，高级兼容项使用 JSON。" />}
        </main>
      </div>
      <DefaultModelEditor snapshot={snapshot} workspaceId={workspaceId} />
      <ConfigurationFiles snapshot={snapshot} />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}

function ProviderEditor({
  draft,
  selectedView
}: {
  draft: PiProviderConfigurationInput;
  selectedView: PiProviderConfigurationView | undefined;
}) {
  const update = (mutation: (draft: PiProviderConfigurationInput) => PiProviderConfigurationInput) => (
    useProviderConfigurationStore.getState().updateDraft(mutation)
  );
  return (
    <div className={styles.formStack}>
      <section className={styles.formSection}>
        <header><strong>常用配置</strong><small>Provider ID、Endpoint 与协议直接对应 Pi models.json。</small></header>
        <div className={styles.fieldGrid}>
          <Field label="Provider ID" detail="写入 providers.<id>">
            <Input disabled={selectedView !== undefined} value={draft.id} onChange={(event) => update((current) => ({ ...current, id: event.target.value }))} />
          </Field>
          <Field label="显示名称">
            <Input value={draft.name ?? ""} onChange={(event) => updateOptionalProvider("name", event.target.value)} />
          </Field>
          <Field label="Base URL">
            <Input value={draft.baseUrl ?? ""} onChange={(event) => updateOptionalProvider("baseUrl", event.target.value)} />
          </Field>
          <Field label="API 协议" detail="如 openai-responses / anthropic-messages">
            <Input value={draft.api ?? ""} onChange={(event) => updateOptionalProvider("api", event.target.value)} />
          </Field>
        </div>
        <div className={styles.checkRow}>
          <label><input checked={draft.authHeader ?? false} onChange={(event) => update((current) => ({ ...current, authHeader: event.target.checked }))} type="checkbox" />使用 Authorization header</label>
          <label><input checked={draft.oauth === "radius"} onChange={(event) => update((current) => {
            const next = { ...current };
            if (event.target.checked) next.oauth = "radius";
            else delete next.oauth;
            return next;
          })} type="checkbox" />启用 Radius OAuth</label>
        </div>
        <HeaderMutationEditor existingNames={selectedView?.headerNames ?? []} />
      </section>
      <ModelEditor draft={draft} selectedView={selectedView} />
      <section className={styles.formSection}>
        <header><strong>Provider 高级 JSON</strong><small>仅接受 compat 与 modelOverrides；apiKey 和 headers 必须走专用写入路径。</small></header>
        <TextArea
          aria-label="Provider 高级 JSON"
          className={styles.codeArea!}
          spellCheck={false}
          value={draft.advancedJson ?? "{}"}
          onChange={(event) => update((current) => ({ ...current, advancedJson: event.target.value }))}
        />
      </section>
    </div>
  );
}

function ModelEditor({
  draft,
  selectedView
}: {
  draft: PiProviderConfigurationInput;
  selectedView: PiProviderConfigurationView | undefined;
}) {
  const update = (mutation: (draft: PiProviderConfigurationInput) => PiProviderConfigurationInput) => (
    useProviderConfigurationStore.getState().updateDraft(mutation)
  );
  return (
    <section className={styles.formSection}>
      <header className={styles.sectionHeaderWithAction}>
        <span><strong>模型</strong><small>每个模型 ID 在当前 Provider 内必须唯一。</small></span>
        <Button className="secondary-button" onPress={() => update((current) => ({
          ...current,
          models: [...current.models, { id: "", input: ["text"], reasoning: false, advancedJson: "{}" }]
        }))}><Plus aria-hidden="true" size={14} />添加模型</Button>
      </header>
      <div className={styles.modelList}>
        {draft.models.map((model, index) => (
          <ModelCard
            existingHeaderNames={selectedView?.models.find((candidate) => candidate.id === model.id)?.headerNames ?? []}
            index={index}
            key={`${index}-${model.id}`}
            model={model}
          />
        ))}
        {draft.models.length === 0 ? <p className={styles.modelEmpty}>至少添加一个模型后才能保存 Provider。</p> : null}
      </div>
    </section>
  );
}

function ModelCard({ model, index, existingHeaderNames }: { model: PiModelConfigurationInput; index: number; existingHeaderNames: string[] }) {
  const update = (mutation: (draft: PiProviderConfigurationInput) => PiProviderConfigurationInput) => (
    useProviderConfigurationStore.getState().updateDraft(mutation)
  );
  const patch = (next: Partial<PiModelConfigurationInput>) => update((current) => ({
    ...current,
    models: current.models.map((candidate, candidateIndex) => {
      if (candidateIndex !== index) return candidate;
      const model = { ...candidate, ...next };
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined) delete model[key as keyof PiModelConfigurationInput];
      }
      return model;
    })
  }));
  return (
    <article className={styles.modelCard}>
      <div className={styles.modelHeading}>
        <strong>{model.name || model.id || `模型 ${index + 1}`}</strong>
        <Button aria-label="移除模型" className={styles.iconButton!} onPress={() => update((current) => ({
          ...current,
          models: current.models.filter((_, candidateIndex) => candidateIndex !== index)
        }))}><Trash2 aria-hidden="true" size={14} /></Button>
      </div>
      <div className={styles.fieldGrid}>
        <Field label="Model ID"><Input value={model.id} onChange={(event) => patch({ id: event.target.value })} /></Field>
        <Field label="显示名称"><Input value={model.name ?? ""} onChange={(event) => patchOptionalModel(patch, "name", event.target.value)} /></Field>
        <Field label="API 覆盖"><Input value={model.api ?? ""} onChange={(event) => patchOptionalModel(patch, "api", event.target.value)} /></Field>
        <Field label="Base URL 覆盖"><Input value={model.baseUrl ?? ""} onChange={(event) => patchOptionalModel(patch, "baseUrl", event.target.value)} /></Field>
        <Field label="Context Window"><Input inputMode="numeric" value={model.contextWindow?.toString() ?? ""} onChange={(event) => patchNumber(patch, "contextWindow", event.target.value)} /></Field>
        <Field label="Max Tokens"><Input inputMode="numeric" value={model.maxTokens?.toString() ?? ""} onChange={(event) => patchNumber(patch, "maxTokens", event.target.value)} /></Field>
      </div>
      <div className={styles.checkRow}>
        <label><input checked={model.input?.includes("text") ?? true} disabled type="checkbox" />文本输入</label>
        <label><input checked={model.input?.includes("image") ?? false} onChange={(event) => patch({ input: event.target.checked ? ["text", "image"] : ["text"] })} type="checkbox" />图片输入</label>
        <label><input checked={model.reasoning ?? false} onChange={(event) => patch({ reasoning: event.target.checked })} type="checkbox" />Reasoning</label>
      </div>
      <HeaderMutationEditor existingNames={existingHeaderNames} modelIndex={index} />
      <details className={styles.advancedDetails}>
        <summary>模型高级 JSON</summary>
        <TextArea
          aria-label={`模型 ${model.id || index + 1} 高级 JSON`}
          className={styles.codeArea!}
          spellCheck={false}
          value={model.advancedJson ?? "{}"}
          onChange={(event) => patch({ advancedJson: event.target.value })}
        />
      </details>
    </article>
  );
}

function HeaderMutationEditor({ existingNames, modelIndex }: { existingNames: string[]; modelIndex?: number }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const update = (mutation: (draft: PiProviderConfigurationInput) => PiProviderConfigurationInput) => (
    useProviderConfigurationStore.getState().updateDraft(mutation)
  );
  const mutations = modelIndex === undefined
    ? useProviderConfigurationStore.getState().draft?.headers ?? []
    : useProviderConfigurationStore.getState().draft?.models[modelIndex]?.headers ?? [];
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
      <span><strong>自定义 Headers</strong><small>界面只回显名称，值只在本次保存请求中发送。</small></span>
      {visibleNames.length ? <div className={styles.headerChips}>{visibleNames.map((header) => (
        <span key={header}>{header}<button aria-label={`移除 ${header}`} onClick={() => apply({ name: header, remove: true })} type="button">×</button></span>
      ))}</div> : null}
      <div className={styles.headerInputs}>
        <Input aria-label="Header 名称" placeholder="Header 名称" value={name} onChange={(event) => setName(event.target.value)} />
        <Input aria-label="Header 值" autoComplete="new-password" placeholder="写入值（不会回显）" type="password" value={value} onChange={(event) => setValue(event.target.value)} />
        <Button isDisabled={!name.trim() || !value} onPress={() => {
          apply({ name: name.trim(), value });
          setName("");
          setValue("");
        }}>写入</Button>
      </div>
    </div>
  );
}

function DefaultModelEditor({ snapshot, workspaceId }: { snapshot: NonNullable<ProviderConfigurationStateSnapshot>; workspaceId: string }) {
  const options = snapshot.providers.flatMap((provider) => provider.models.map((model) => ({
    key: `${provider.id}\u0000${model.id}`,
    label: `${provider.name ?? provider.id} / ${model.name ?? model.id}`,
    selection: { provider: provider.id, model: model.id }
  })));
  return (
    <section className={styles.secondarySection}>
      <header><strong>默认模型</strong><small>全局写入 ~/.pi/agent/settings.json；可信项目写入 &lt;workspace&gt;/.pi/settings.json。</small></header>
      <div className={styles.defaultGrid}>
        <DefaultSelect label="全局默认" value={selectionKey(snapshot.defaults.global)} options={options} onChange={(selection) => void setDefaultModelConfiguration("global", selection, workspaceId)} />
        <DefaultSelect label="项目默认" disabled={!snapshot.defaults.projectTrusted} value={selectionKey(snapshot.defaults.project)} options={options} onChange={(selection) => void setDefaultModelConfiguration("project", selection, workspaceId)} />
        <div className={styles.effectiveDefault}><span>当前生效</span><strong>{snapshot.defaults.effective ? `${snapshot.defaults.effective.provider} / ${snapshot.defaults.effective.model}` : "未设置"}</strong></div>
      </div>
      {!snapshot.defaults.projectTrusted ? <p className={styles.trustNotice}>信任当前 Workspace 后才能读取和修改项目级 Pi settings.json。</p> : null}
    </section>
  );
}

type ProviderConfigurationStateSnapshot = ReturnType<typeof useProviderConfigurationStore.getState>["snapshot"];

function DefaultSelect({ label, value, options, disabled, onChange }: {
  label: string;
  value: string;
  options: Array<{ key: string; label: string; selection: { provider: string; model: string } }>;
  disabled?: boolean;
  onChange: (selection: { provider: string; model: string } | undefined) => void;
}) {
  return <label className={styles.defaultField}><span>{label}</span><select disabled={disabled} value={value} onChange={(event) => onChange(options.find((option) => option.key === event.target.value)?.selection)}><option value="">未设置</option>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>;
}

function ConfigurationFiles({ snapshot }: { snapshot: NonNullable<ProviderConfigurationStateSnapshot> }) {
  return (
    <section className={styles.secondarySection}>
      <header><strong>Pi 文件同步</strong><small>文件是唯一真源；Desktop 监听外部修改并用 revision 防止覆盖。</small></header>
      <div className={styles.fileList}>{snapshot.files.map((file) => (
        <div key={file.kind}>
          <FileJson2 aria-hidden="true" size={15} />
          <span><strong>{file.kind}</strong><small title={file.path}>{file.path}</small></span>
          <em data-valid={file.valid}>{file.valid ? "有效" : "无效"}</em>
        </div>
      ))}</div>
      {snapshot.diagnostics.length ? <ul className={styles.diagnostics}>{snapshot.diagnostics.map((item, index) => <li key={`${item.file}-${index}`}><strong>{item.file}</strong>{item.message}</li>)}</ul> : null}
    </section>
  );
}

function ConfigurationStatusBar({ snapshot, busy, onNew, onReload }: { snapshot: NonNullable<ProviderConfigurationStateSnapshot>; busy: boolean; onNew: () => void; onReload: () => void }) {
  return <div className={styles.statusBar}><span data-current={snapshot.syncState === "current"}>{snapshot.syncState === "current" ? <Check aria-hidden="true" size={14} /> : <AlertTriangle aria-hidden="true" size={14} />}<strong>{snapshot.syncState === "current" ? "已与 Pi 文件同步" : "Pi 文件需要处理"}</strong><small>revision {snapshot.revision.slice(0, 10)}</small></span><div><Button className="secondary-button" isDisabled={busy} onPress={onReload}><RefreshCw aria-hidden="true" size={14} />重新加载</Button><Button className="secondary-button" isDisabled={busy} onPress={onNew}><Plus aria-hidden="true" size={14} />新建 Provider</Button></div></div>;
}

function Field({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}{detail ? <small>{detail}</small> : null}</label>;
}

function PanelEmpty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className={styles.panelEmpty} role="status"><strong>{title}</strong><span>{detail}</span>{action}</div>;
}

function updateOptionalProvider(key: "name" | "baseUrl" | "api", value: string): void {
  useProviderConfigurationStore.getState().updateDraft((draft) => {
    const next = { ...draft };
    if (value.trim()) next[key] = value;
    else delete next[key];
    return next;
  });
}

function patchOptionalModel(update: (patch: Partial<PiModelConfigurationInput>) => void, key: "name" | "api" | "baseUrl", value: string): void {
  update(value.trim() ? { [key]: value } : { [key]: undefined });
}

function patchNumber(update: (patch: Partial<PiModelConfigurationInput>) => void, key: "contextWindow" | "maxTokens", value: string): void {
  const parsed = Number.parseInt(value, 10);
  update(Number.isSafeInteger(parsed) && parsed > 0 ? { [key]: parsed } : { [key]: undefined });
}

function selectionKey(selection?: { provider: string; model: string }): string {
  return selection ? `${selection.provider}\u0000${selection.model}` : "";
}
