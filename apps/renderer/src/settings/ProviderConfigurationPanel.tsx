import type {
  PiProviderConfigurationInput,
  PiProviderConfigurationSnapshot,
  PiProviderConfigurationView
} from "@pi67/protocol";
import {
  AlertTriangle,
  Check,
  FileJson2,
  KeyRound,
  RefreshCw,
  Save,
  Trash2
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, TextArea } from "react-aria-components";
import { useShellStore } from "../shell/shell-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { ProviderDefaultModelEditor } from "./ProviderDefaultModelEditor.js";
import {
  defaultProviderCatalogView,
  ProviderCatalog,
  type ProviderCatalogView
} from "./ProviderCatalog.js";
import { ProviderHeaderMutationEditor } from "./ProviderHeaderMutationEditor.js";
import { ProviderModelWorkspace } from "./ProviderModelWorkspace.js";
import {
  SettingsBackAction,
  SettingsNotice,
  SettingsToolbar
} from "./SettingsPrimitives.js";
import {
  loadProviderConfiguration,
  reloadProviderConfiguration,
  removeProviderConfiguration,
  saveProviderConfiguration
} from "./provider-configuration-controller.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import styles from "./ProviderConfigurationPanel.module.css";

type ProviderSection = "configuration" | "models" | "defaults" | "diagnostics";

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
  const [providerQuery, setProviderQuery] = useState("");
  const [providerCatalogView, setProviderCatalogView] = useState<ProviderCatalogView>("configured");
  const [section, setSection] = useState<ProviderSection>("models");
  const [providerDetailOpen, setProviderDetailOpen] = useState(false);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>();
  const panelRef = useRef<HTMLDivElement>(null);
  const catalogScrollTopRef = useRef(0);
  const catalogViewWorkspaceRef = useRef<string | undefined>(undefined);
  const restoreCatalogScrollRef = useRef(false);

  useEffect(() => {
    setProviderQuery("");
    setProviderCatalogView("configured");
    setSection("models");
    setProviderDetailOpen(false);
    setPendingProviderId(undefined);
    catalogScrollTopRef.current = 0;
    catalogViewWorkspaceRef.current = undefined;
    restoreCatalogScrollRef.current = false;
    if (!workspaceId) {
      useProviderConfigurationStore.getState().reset();
      return;
    }
    void loadProviderConfiguration(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !snapshot || storeWorkspaceId !== workspaceId) return;
    if (catalogViewWorkspaceRef.current === workspaceId) return;
    catalogViewWorkspaceRef.current = workspaceId;
    setProviderCatalogView(defaultProviderCatalogView(snapshot.providers));
  }, [snapshot, storeWorkspaceId, workspaceId]);

  useLayoutEffect(() => {
    const scrollRegion = panelRef.current?.closest<HTMLElement>('[data-testid="settings-scroll-region"]');
    if (!scrollRegion) return;
    if (providerDetailOpen) {
      scrollRegion.scrollTop = 0;
      return;
    }
    if (!restoreCatalogScrollRef.current) return;
    scrollRegion.scrollTop = catalogScrollTopRef.current;
    restoreCatalogScrollRef.current = false;
  }, [providerDetailOpen]);

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
  const enterProvider = (providerId: string | null) => {
    setPendingProviderId(undefined);
    if (providerId === null) {
      if (selectedProviderId !== undefined || !draft) {
        useProviderConfigurationStore.getState().startProvider();
      }
      setSection("configuration");
    } else if (providerId !== selectedProviderId) {
      useProviderConfigurationStore.getState().selectProvider(providerId);
      setSection("models");
    }
    setProviderDetailOpen(true);
  };
  const requestProvider = (providerId: string | null) => {
    const scrollRegion = panelRef.current?.closest<HTMLElement>('[data-testid="settings-scroll-region"]');
    catalogScrollTopRef.current = scrollRegion?.scrollTop ?? 0;
    restoreCatalogScrollRef.current = false;
    const switchesDraft = providerId === null
      ? selectedProviderId !== undefined
      : providerId !== selectedProviderId;
    if (dirty && switchesDraft) {
      setPendingProviderId(providerId);
      return;
    }
    enterProvider(providerId);
  };
  const closeProvider = () => {
    restoreCatalogScrollRef.current = true;
    setProviderDetailOpen(false);
  };

  return (
    <div
      className={styles.panel}
      data-testid="provider-configuration-panel"
      data-view={providerDetailOpen ? "detail" : "catalog"}
      ref={panelRef}
    >
      <ConfigurationStatusBar
        snapshot={snapshot}
        busy={phase === "saving"}
        onReload={() => void reloadProviderConfiguration(workspaceId)}
      />
      {externalConflict ? (
        <SettingsNotice
          tone="warning"
          testId="provider-configuration-conflict"
          actions={<Button className="secondary-button" onPress={() => useProviderConfigurationStore.getState().adoptExternal()}>
            放弃草稿并采用最新配置
          </Button>}
        >
          <strong>Pi 配置已在外部修改。</strong> 你的未保存草稿仍被保留；当前草稿基于旧 revision，保存会被阻止。
        </SettingsNotice>
      ) : null}
      {snapshot.syncState === "invalid" ? (
        <SettingsNotice tone="danger"><strong>Pi 配置文件当前无效。</strong> Desktop 保留上一次安全投影，不会自动重写文件。</SettingsNotice>
      ) : null}
      {pendingProviderId !== undefined ? (
        <SettingsNotice
          tone="warning"
          actions={<>
            <Button className="secondary-button" onPress={() => enterProvider(selectedProviderId ?? null)}>继续编辑当前草稿</Button>
            <Button className="secondary-button" onPress={() => enterProvider(pendingProviderId)}>放弃草稿并切换</Button>
          </>}
        >
          当前模型服务有未保存草稿。只有明确放弃后才能切换到其他模型服务。
        </SettingsNotice>
      ) : null}
      {!providerDetailOpen ? (
        <ProviderCatalog
          busy={phase === "saving"}
          onNew={() => requestProvider(null)}
          onQueryChange={setProviderQuery}
          onSelect={requestProvider}
          onViewChange={setProviderCatalogView}
          providers={snapshot.providers}
          query={providerQuery}
          selectedProviderId={selectedProviderId}
          view={providerCatalogView}
        />
      ) : (
        <main className={styles.editor} data-testid="provider-configuration-editor">
            {draft ? (
              <>
                <div className={styles.editorHeading}>
                  <SettingsBackAction label="返回模型服务列表" onPress={closeProvider}>模型服务</SettingsBackAction>
                  <span>
                    <strong>{selectedProviderId ? (selectedView?.name ?? selectedProviderId) : "新建模型服务"}</strong>
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
                <ProviderSectionTabs
                  activeSection={section}
                  modelCount={draft.models.length}
                  onChange={setSection}
                />
                <div className={styles.editorBody} data-section={section}>
                  {section === "configuration" ? (
                    <ProviderConfigurationEditor draft={draft} editable={editable} selectedView={selectedView} />
                  ) : null}
                  {section === "models" ? (
                    <ProviderModelWorkspace
                      key={selectedProviderId ?? "new-provider"}
                      defaults={snapshot.defaults}
                      draft={draft}
                      editable={editable}
                      selectedView={selectedView}
                    />
                  ) : null}
                  {section === "defaults" ? <ProviderDefaultModelEditor snapshot={snapshot} workspaceId={workspaceId} /> : null}
                  {section === "diagnostics" ? <ConfigurationFiles snapshot={snapshot} /> : null}
                </div>
              </>
            ) : <PanelEmpty title="选择或新建模型服务" detail="常用字段使用表单，高级兼容项使用 JSON。" />}
        </main>
      )}
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
    </div>
  );
}

function ProviderSectionTabs({
  activeSection,
  modelCount,
  onChange
}: {
  activeSection: ProviderSection;
  modelCount: number;
  onChange: (section: ProviderSection) => void;
}) {
  const items: Array<{ id: ProviderSection; label: string }> = [
    { id: "configuration", label: "基本配置" },
    { id: "models", label: `模型 ${modelCount}` },
    { id: "defaults", label: "默认模型" },
    { id: "diagnostics", label: "文件与诊断" }
  ];
  return (
    <nav aria-label="Provider 设置分区" className={styles.sectionTabs} role="tablist">
      {items.map((item) => (
        <button
          aria-selected={activeSection === item.id}
          className={activeSection === item.id ? styles.selectedSectionTab : ""}
          key={item.id}
          onClick={() => onChange(item.id)}
          role="tab"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function ProviderConfigurationEditor({
  draft,
  editable,
  selectedView
}: {
  draft: PiProviderConfigurationInput;
  editable: boolean;
  selectedView: PiProviderConfigurationView | undefined;
}) {
  const update = (mutation: (draft: PiProviderConfigurationInput) => PiProviderConfigurationInput) => (
    useProviderConfigurationStore.getState().updateDraft(mutation)
  );
  return (
    <section className={styles.formSection}>
      <header className={styles.sectionIntro}>
        <strong>基本配置</strong>
        <small>{editable ? "Provider ID、Endpoint 与协议直接对应 Pi models.json。" : "Pi 内置 Provider 由运行时提供，Desktop 不创建私有副本。"}</small>
      </header>
      <div className={styles.fieldGrid}>
        <Field label="Provider ID" {...(editable ? { detail: "写入 providers.<id>" } : {})}>
          <Input disabled={!editable || selectedView !== undefined} value={draft.id} onChange={(event) => update((current) => ({ ...current, id: event.target.value }))} />
        </Field>
        <Field label="显示名称">
          <Input disabled={!editable} value={draft.name ?? ""} onChange={(event) => updateOptionalProvider("name", event.target.value)} />
        </Field>
        <Field label="Base URL">
          <Input disabled={!editable} value={draft.baseUrl ?? ""} onChange={(event) => updateOptionalProvider("baseUrl", event.target.value)} />
        </Field>
        <Field label="API 协议" detail="如 openai-responses / anthropic-messages">
          <Input disabled={!editable} value={draft.api ?? ""} onChange={(event) => updateOptionalProvider("api", event.target.value)} />
        </Field>
      </div>
      <div className={styles.checkRow}>
        <label><input checked={draft.authHeader ?? false} disabled={!editable} onChange={(event) => update((current) => ({ ...current, authHeader: event.target.checked }))} type="checkbox" />使用 Authorization header</label>
        <label><input checked={draft.oauth === "radius"} disabled={!editable} onChange={(event) => update((current) => {
          const next = { ...current };
          if (event.target.checked) next.oauth = "radius";
          else delete next.oauth;
          return next;
        })} type="checkbox" />启用 Radius OAuth</label>
      </div>
      <details className={styles.advancedDetails}>
        <summary>自定义 Headers{selectedView?.headerNames.length ? ` · ${selectedView.headerNames.length} 项` : ""}</summary>
        <ProviderHeaderMutationEditor existingNames={selectedView?.headerNames ?? []} readOnly={!editable} showTitle={false} />
      </details>
      <details className={styles.advancedDetails}>
        <summary>Provider 高级 JSON{hasAdvancedJson(draft.advancedJson) ? " · 已配置" : ""}</summary>
        <p>仅接受 compat 与 modelOverrides；apiKey 和 headers 必须走专用写入路径。</p>
        <TextArea
          aria-label="Provider 高级 JSON"
          className={styles.codeArea!}
          readOnly={!editable}
          spellCheck={false}
          value={draft.advancedJson ?? "{}"}
          onChange={(event) => update((current) => ({ ...current, advancedJson: event.target.value }))}
        />
      </details>
      {!editable ? <div className={styles.readOnlyNotice}>可通过“管理凭据”写入认证信息；模型和 Provider 定义保持只读。</div> : null}
    </section>
  );
}

function ConfigurationFiles({ snapshot }: { snapshot: PiProviderConfigurationSnapshot }) {
  const validCount = snapshot.files.filter((file) => file.valid).length;
  const [expanded, setExpanded] = useState(snapshot.syncState === "invalid" || snapshot.diagnostics.length > 0);
  return (
    <section className={styles.secondarySection}>
      <header className={styles.sectionIntro}><strong>文件与诊断</strong><small>Pi 文件是唯一真源；正常状态保持紧凑，发生错误时自动展开。</small></header>
      {snapshot.diagnostics.length ? <ul className={styles.diagnostics}>{snapshot.diagnostics.map((item, index) => <li key={`${item.file}-${index}`}><strong>{item.file}</strong>{item.message}</li>)}</ul> : null}
      <details className={styles.fileDetails} open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>
          <span><FileJson2 aria-hidden="true" size={15} /><strong>Pi 文件同步</strong></span>
          <em data-valid={validCount === snapshot.files.length}>{validCount}/{snapshot.files.length} 有效</em>
        </summary>
        <div className={styles.fileList}>{snapshot.files.map((file) => (
          <div key={file.kind}>
            <FileJson2 aria-hidden="true" size={15} />
            <span><strong>{file.kind}</strong><small title={file.path}>{file.path}</small></span>
            <em data-valid={file.valid}>{file.valid ? "有效" : "无效"}</em>
          </div>
        ))}</div>
      </details>
    </section>
  );
}

function ConfigurationStatusBar({ snapshot, busy, onReload }: { snapshot: PiProviderConfigurationSnapshot; busy: boolean; onReload: () => void }) {
  return <SettingsToolbar
    className={styles.statusBar!}
    status={<span className={styles.syncStatus} data-current={snapshot.syncState === "current"}>{snapshot.syncState === "current" ? <Check aria-hidden="true" size={14} /> : <AlertTriangle aria-hidden="true" size={14} />}<strong>{snapshot.syncState === "current" ? "已与 Pi 文件同步" : "Pi 文件需要处理"}</strong><small>revision {snapshot.revision.slice(0, 10)}</small></span>}
    actions={<Button className="secondary-button" isDisabled={busy} onPress={onReload}><RefreshCw aria-hidden="true" size={14} />重新加载</Button>}
  />;
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

function hasAdvancedJson(value: string | undefined): boolean {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== "{}");
}
