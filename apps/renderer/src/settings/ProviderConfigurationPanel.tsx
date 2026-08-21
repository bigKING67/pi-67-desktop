import type {
  PiProviderConfigurationInput,
  PiProviderConfigurationView
} from "@pi67/protocol";
import { KeyRound, Save, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input, TextArea } from "react-aria-components";
import { useShellStore } from "../shell/shell-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { ProviderDefaultModelEditor } from "./ProviderDefaultModelEditor.js";
import { ProjectProviderConfigurationPanel } from "./ProjectProviderConfigurationPanel.js";
import {
  ProviderConfigurationEmpty as PanelEmpty,
  ProviderConfigurationFiles as ConfigurationFiles,
  ProviderConfigurationStatusBar as ConfigurationStatusBar
} from "./ProviderConfigurationStatus.js";
import { BuiltInProviderConnection } from "./BuiltInProviderConnection.js";
import {
  defaultProviderCatalogView,
  ProviderCatalog,
  type ProviderCatalogView
} from "./ProviderCatalog.js";
import { ProviderHeaderMutationEditor } from "./ProviderHeaderMutationEditor.js";
import { ProviderModelWorkspace } from "./ProviderModelWorkspace.js";
import { SettingsDestructiveActionDialog } from "./SettingsActionDialogs.js";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";
import {
  SettingsBackAction,
  SettingsNotice
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
  const scope = useWorkbenchStore((state) => state.settingsScope);
  const workspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId);
  return scope === "project"
    ? <ProjectProviderConfigurationPanel workspaceId={workspaceId} />
    : <GlobalProviderConfigurationPanel />;
}

function GlobalProviderConfigurationPanel() {
  const workspaceId = "app";
  const snapshot = useProviderConfigurationStore((state) => state.snapshot);
  const draft = useProviderConfigurationStore((state) => state.draft);
  const selectedProviderId = useProviderConfigurationStore((state) => state.selectedProviderId);
  const dirty = useProviderConfigurationStore((state) => state.dirty);
  const externalConflict = useProviderConfigurationStore((state) => state.externalConflict);
  const phase = useProviderConfigurationStore((state) => state.phase);
  const error = useProviderConfigurationStore((state) => state.error);
  const storeWorkspaceId = useProviderConfigurationStore((state) => state.workspaceId);
  const setCredentialDialogOpen = useShellStore((state) => state.setCredentialDialogOpen);
  const initialEditorRequestRef = useRef(
    useProviderConfigurationStore.getState().providerEditorRequest?.workspaceId === workspaceId
      ? useProviderConfigurationStore.getState().providerEditorRequest?.section
      : undefined
  );
  const [providerQuery, setProviderQuery] = useState("");
  const [providerCatalogView, setProviderCatalogView] = useState<ProviderCatalogView>("configured");
  const [section, setSection] = useState<ProviderSection>(initialEditorRequestRef.current ?? "models");
  const [providerDetailOpen, setProviderDetailOpen] = useState(initialEditorRequestRef.current !== undefined);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>();
  const [removalTarget, setRemovalTarget] = useState<string>();
  const panelRef = useRef<HTMLDivElement>(null);
  const catalogScrollTopRef = useRef(0);
  const catalogViewWorkspaceRef = useRef<string | undefined>(undefined);
  const restoreCatalogScrollRef = useRef(false);

  useEffect(() => {
    const providerState = useProviderConfigurationStore.getState();
    const requestedSection = initialEditorRequestRef.current;
    providerState.consumeProviderEditorRequest(workspaceId);
    setProviderQuery("");
    setProviderCatalogView("configured");
    setPendingProviderId(undefined);
    catalogScrollTopRef.current = 0;
    catalogViewWorkspaceRef.current = undefined;
    restoreCatalogScrollRef.current = false;
    if (requestedSection === undefined || providerState.workspaceId !== workspaceId || !providerState.snapshot) {
      void loadProviderConfiguration(workspaceId);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!snapshot || storeWorkspaceId !== workspaceId) return;
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

  const draftSubject = snapshot?.providers.find((provider) => provider.id === selectedProviderId)?.name
    ?? selectedProviderId
    ?? "新建模型服务";
  useSettingsDraftRegistration({
    dirty,
    busy: phase === "saving",
    subject: draftSubject,
    discard: () => useProviderConfigurationStore.getState().discardDraft()
  });

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
    } else {
      const target = snapshot.providers.find((provider) => provider.id === providerId);
      if (providerId !== selectedProviderId) {
        useProviderConfigurationStore.getState().selectProvider(providerId);
        setSection(target?.origin === "builtin" && !target.configured ? "configuration" : "models");
      } else if (target?.origin === "builtin" && !target.configured) {
        setSection("configuration");
      }
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

  const removalView = snapshot.providers.find((provider) => provider.id === removalTarget);
  return (
    <>
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
        <div className={styles.catalogView}>
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
        </div>
      ) : (
        <main className={styles.editor} data-testid="provider-configuration-editor">
            {draft ? (
              <>
                <div className={styles.editorHeading}>
                  <SettingsBackAction label="返回模型服务列表" onPress={closeProvider}>模型服务</SettingsBackAction>
                  <span>
                    <strong>{selectedProviderId ? (selectedView?.name ?? selectedProviderId) : "新建模型服务"}</strong>
                    <small>{editable
                      ? "写入当前用户共享的 Pi models.json；Pi TUI 同步使用，API Key 单独保存"
                      : selectedView?.configured
                        ? "Pi 内置服务已连接；Endpoint 与协议由 Pi 管理"
                        : "先配置 API Key；Endpoint 与协议由 Pi 管理"}</small>
                  </span>
                  <div>
                    {selectedProviderId && (editable || section !== "configuration") ? (
                      <Button
                        className={selectedView?.configured ? "secondary-button" : "primary-button"}
                        onPress={() => setCredentialDialogOpen(true, selectedProviderId)}
                      >
                        <KeyRound aria-hidden="true" size={14} />
                        {selectedView?.configured ? "更新 API Key" : "配置 API Key"}
                      </Button>
                    ) : null}
                    {selectedProviderId && editable ? (
                      <Button className={styles.dangerButton!} onPress={() => setRemovalTarget(selectedProviderId)}>
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
                  builtIn={!editable}
                  modelCount={draft.models.length}
                  onChange={setSection}
                />
                <div className={styles.editorBody} data-section={section}>
                  {section === "configuration" ? (
                    editable ? (
                      <ProviderConfigurationEditor draft={draft} selectedView={selectedView} />
                    ) : selectedView ? (
                      <BuiltInProviderConnection
                        provider={selectedView}
                        onConfigureCredential={() => setCredentialDialogOpen(true, selectedView.id)}
                      />
                    ) : null
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
                  {section === "defaults" ? <ProviderDefaultModelEditor scope="global" snapshot={snapshot} workspaceId={workspaceId} /> : null}
                  {section === "diagnostics" ? <ConfigurationFiles snapshot={snapshot} /> : null}
                </div>
              </>
            ) : <PanelEmpty title="选择或新建模型服务" detail="常用字段使用表单，高级兼容项使用 JSON。" />}
        </main>
      )}
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
    </div>
    <SettingsDestructiveActionDialog
      busy={phase === "saving"}
      confirmLabel="移除模型服务"
      description={<>这会从 Desktop 与 Pi TUI 共用的 Pi <code>models.json</code> 移除模型服务定义。<code>auth.json</code> 中的持久凭据不会被删除。</>}
      error={removalTarget ? error : undefined}
      facts={[
        { label: "模型服务", value: removalView?.name ?? removalTarget ?? "-" },
        { label: "Pi TUI", value: "同步移除该定义" },
        { label: "未保存草稿", value: dirty ? "将一并丢弃" : "无" },
        { label: "持久凭据", value: "保留" }
      ]}
      open={removalTarget !== undefined}
      pendingLabel="正在移除…"
      title="移除模型服务定义？"
      onCancel={() => setRemovalTarget(undefined)}
      onConfirm={() => {
        if (!removalTarget) return;
        void removeProviderConfiguration(removalTarget, workspaceId).then((removed) => {
          if (!removed) return;
          setRemovalTarget(undefined);
          setProviderDetailOpen(false);
        });
      }}
    />
    </>
  );
}

function ProviderSectionTabs({
  activeSection,
  builtIn,
  modelCount,
  onChange
}: {
  activeSection: ProviderSection;
  builtIn: boolean;
  modelCount: number;
  onChange: (section: ProviderSection) => void;
}) {
  const items: Array<{ id: ProviderSection; label: string }> = [
    { id: "configuration", label: builtIn ? "连接" : "基本配置" },
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
      <header className={styles.sectionIntro}>
        <strong>基本配置</strong>
        <small>Provider ID、Endpoint 与协议直接写入 Desktop 与 Pi TUI 共用的 Pi models.json。新服务保存后再单独配置 API Key。</small>
      </header>
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
