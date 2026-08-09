import type { ProviderSummary } from "@pi67/domain";
import type { PiCredentialRevealResult, PiCredentialSummary } from "@pi67/protocol";
import { Eye, EyeOff, KeyRound, LockKeyhole, Search, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Heading, Input, Modal, ModalOverlay } from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSelectedModel } from "../session/session-projection-selectors.js";
import { useShellStore } from "../shell/shell-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  configureWorkspaceProviderKey,
  loadWorkspaceProviderCatalog
} from "./workspace-provider-controller.js";
import {
  loadProviderConfiguration,
  removePersistentCredential,
  revealPersistentCredential,
  storePersistentCredential
} from "./provider-configuration-controller.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import { SettingsDestructiveActionDialog } from "./SettingsActionDialogs.js";

export function CredentialDialog() {
  const open = useShellStore((state) => state.credentialDialogOpen);
  const targetProviderId = useShellStore((state) => state.credentialDialogProviderId);
  const selectedModel = useSessionProjectionStore(selectSelectedModel);
  const setOpen = useShellStore((state) => state.setCredentialDialogOpen);
  const workspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId ?? state.currentWorkspaceId);
  const configuration = useProviderConfigurationStore((state) => (
    state.workspaceId === workspaceId ? state.snapshot : undefined
  ));
  const configurationError = useProviderConfigurationStore((state) => (
    state.workspaceId === workspaceId ? state.error : undefined
  ));
  const [providers, setProviders] = useState<ProviderSummary[] | undefined>(undefined);
  const providerList = useMemo(() => providers ?? [], [providers]);
  const [providerId, setProviderId] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [loadRevision, setLoadRevision] = useState(0);
  const [removeTargetProviderId, setRemoveTargetProviderId] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setApiKey("");
    setProviderQuery("");
    setSubmitting(false);
    setLoadError(undefined);
    setRemoveTargetProviderId(undefined);
    if (!workspaceId) {
      setProviders([]);
      return;
    }
    setProviders(undefined);
    let current = true;
    void Promise.all([
      loadProviderConfiguration(workspaceId),
      loadWorkspaceProviderCatalog(workspaceId)
    ]).then(
      ([, nextProviders]) => {
        if (current) setProviders(nextProviders);
      },
      (error: unknown) => {
        if (!current) return;
        setProviders([]);
        setLoadError(error instanceof Error ? error.message : messages.credentials.loadFailed);
      }
    );
    return () => { current = false; };
  }, [loadRevision, open, workspaceId]);

  useEffect(() => {
    if (!open) return;
    setProviderId((current) => {
      if (providerList.some((provider) => provider.id === current)) return current;
      if (targetProviderId && providerList.some((provider) => provider.id === targetProviderId)) {
        return targetProviderId;
      }
      return providerList.some((provider) => provider.id === selectedModel?.provider)
        ? selectedModel?.provider ?? ""
        : providerList[0]?.id ?? "";
    });
  }, [open, providerList, selectedModel?.provider, targetProviderId]);

  const filteredProviderList = useMemo(() => {
    const query = providerQuery.trim().toLocaleLowerCase();
    if (query.length === 0) return providerList;
    return providerList.filter((provider) => (
      provider.label.toLocaleLowerCase().includes(query)
      || provider.id.toLocaleLowerCase().includes(query)
    ));
  }, [providerList, providerQuery]);

  useEffect(() => {
    if (providerQuery.trim().length === 0 || filteredProviderList.length === 0) return;
    if (!filteredProviderList.some((provider) => provider.id === providerId)) {
      setProviderId(filteredProviderList[0]?.id ?? "");
    }
  }, [filteredProviderList, providerId, providerQuery]);

  if (!open) return null;
  const selectedProvider = providerList.find((provider) => provider.id === providerId);
  const removalProvider = providerList.find((provider) => provider.id === removeTargetProviderId);
  const focusedProvider = targetProviderId !== undefined && selectedProvider?.id === targetProviderId;
  const dialogTitle = focusedProvider
    ? `配置 ${selectedProvider.label} API Key`
    : messages.credentials.title;
  const canSubmit = selectedProvider !== undefined && apiKey.trim().length >= 8 && !submitting;

  return (
    <>
    <ModalOverlay
      className="modal-overlay"
      isOpen
      isDismissable={!submitting && removeTargetProviderId === undefined}
      onOpenChange={(next) => { if (removeTargetProviderId === undefined) setOpen(next); }}
    >
      <Modal className="modal-surface credential-dialog" data-mode={focusedProvider ? "focused" : "catalog"}>
        <Dialog aria-label={dialogTitle}>
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit || !workspaceId) return;
            setSubmitting(true);
            void (async () => {
              try {
                const saved = await storePersistentCredential(workspaceId, providerId, apiKey);
                if (saved) {
                  setProviders(await loadWorkspaceProviderCatalog(workspaceId));
                  setApiKey("");
                }
              } catch (error) {
                setLoadError(error instanceof Error ? error.message : messages.credentials.loadFailed);
              } finally {
                setSubmitting(false);
              }
            })();
          }}>
            <span className="dialog-eyebrow">{focusedProvider ? "Pi 模型服务认证" : messages.credentials.eyebrow}</span>
            <Heading slot="title">{dialogTitle}</Heading>
            <div className="credential-notice">
              <LockKeyhole size={17} aria-hidden="true" />
              <p>
                <strong>{messages.credentials.privacyTitle}</strong>
                <span>{messages.credentials.privacyDetail}</span>
              </p>
            </div>
            {providers === undefined ? (
              <p className="credential-empty" role="status">{messages.credentials.loading}</p>
            ) : providerList.length > 0 ? (
              <div className={`provider-credential-layout${focusedProvider ? " is-focused" : ""}`}>
                {!focusedProvider ? <div className="provider-sidebar">
                  <div className="provider-search">
                    <Search aria-hidden="true" size={15} />
                    <Input
                      aria-label={messages.credentials.providerSearch}
                      autoComplete="off"
                      placeholder={messages.credentials.providerSearchPlaceholder}
                      value={providerQuery}
                      onChange={(event) => setProviderQuery(event.target.value)}
                    />
                    {providerQuery.length > 0 ? <Button
                      aria-label={messages.credentials.clearProviderSearch}
                      className="provider-search-clear"
                      onPress={() => setProviderQuery("")}
                      type="button"
                    >
                      <X aria-hidden="true" size={14} />
                    </Button> : null}
                  </div>
                  <div className="provider-list" aria-label={messages.credentials.providerList}>
                    {filteredProviderList.map((provider) => (
                      <button
                        aria-pressed={provider.id === providerId}
                        className={provider.id === providerId ? "is-selected" : ""}
                        key={provider.id}
                        onClick={() => setProviderId(provider.id)}
                        type="button"
                      >
                        <span>
                          <strong>{provider.label}</strong>
                          <small>{provider.id} · {messages.credentials.modelCount(provider.modelCount)}</small>
                        </span>
                        <em className={provider.configured ? "is-configured" : ""}>
                          {provider.configured
                            ? messages.credentials.configured
                            : messages.credentials.unconfigured}
                        </em>
                      </button>
                    ))}
                    {filteredProviderList.length === 0 ? (
                      <p className="provider-list-empty">{messages.credentials.noProviderMatches}</p>
                    ) : null}
                  </div>
                </div> : null}
                {selectedProvider ? (
                  <ProviderCredentialEditor
                    apiKey={apiKey}
                    focusInput={focusedProvider}
                    key={selectedProvider.id}
                    persistentCredential={configuration?.credentials.find((credential) => credential.provider === providerId)}
                    provider={selectedProvider}
                    submitting={submitting}
                    onApiKeyChange={setApiKey}
                    onRevealPersistentCredential={() => {
                      if (!workspaceId) throw new Error(messages.credentials.savedApiKeyRevealFailed);
                      return revealPersistentCredential(workspaceId, providerId);
                    }}
                  />
                ) : null}
              </div>
            ) : loadError ? (
              <div className="credential-empty credential-load-error" role="alert">
                <span>{messages.credentials.loadFailed}: {loadError}</span>
                <Button className="secondary-button" onPress={() => setLoadRevision((value) => value + 1)}>
                  {messages.credentials.retry}
                </Button>
              </div>
            ) : (
              <p className="credential-empty">
                {workspaceId ? messages.credentials.empty : messages.credentials.noWorkspace}
              </p>
            )}
            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => setOpen(false)} isDisabled={submitting}>{messages.common.close}</Button>
              {selectedProvider && workspaceId ? <Button
                className="secondary-button"
                isDisabled={!canSubmit}
                onPress={() => {
                  setSubmitting(true);
                  void configureWorkspaceProviderKey(workspaceId, providerId, apiKey).then((nextProviders) => {
                    if (nextProviders) {
                      setProviders(nextProviders);
                      setApiKey("");
                    }
                    setSubmitting(false);
                  });
                }}
              >仅本次使用</Button> : null}
              {selectedProvider && workspaceId && configuration?.credentials.some((credential) => credential.provider === providerId) ? <Button
                className="secondary-button"
                isDisabled={submitting}
                onPress={() => {
                  setLoadError(undefined);
                  setRemoveTargetProviderId(providerId);
                }}
              >移除持久凭据</Button> : null}
              <Button className="primary-button" type="submit" isDisabled={!canSubmit}>
                {submitting ? "保存中…" : "保存到 Pi"}
              </Button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
    <SettingsDestructiveActionDialog
      busy={submitting}
      confirmLabel="移除持久凭据"
      description={<>这会从 Pi <code>auth.json</code> 删除所选 Provider 的持久凭据。当前输入框中的密钥不会被发送或显示在确认信息中。</>}
      error={removeTargetProviderId ? (loadError ?? configurationError) : undefined}
      facts={[
        { label: "Provider", value: removalProvider?.label ?? removeTargetProviderId ?? "-" },
        { label: "配置文件", value: "Pi auth.json" },
        { label: "本次运行覆盖", value: "不受此操作影响" }
      ]}
      open={removeTargetProviderId !== undefined}
      pendingLabel="正在移除…"
      title="移除持久凭据？"
      onCancel={() => setRemoveTargetProviderId(undefined)}
      onConfirm={() => {
        if (!workspaceId || !removeTargetProviderId) return;
        const target = removeTargetProviderId;
        setSubmitting(true);
        setLoadError(undefined);
        void (async () => {
          try {
            const removed = await removePersistentCredential(workspaceId, target);
            if (!removed) return;
            setProviders(await loadWorkspaceProviderCatalog(workspaceId));
            setRemoveTargetProviderId(undefined);
          } catch (error) {
            setLoadError(error instanceof Error ? error.message : messages.credentials.loadFailed);
          } finally {
            setSubmitting(false);
          }
        })();
      }}
    />
    </>
  );
}

interface ProviderCredentialEditorProps {
  apiKey: string;
  focusInput: boolean;
  provider: ProviderSummary;
  persistentCredential: PiCredentialSummary | undefined;
  submitting: boolean;
  onApiKeyChange: (value: string) => void;
  onRevealPersistentCredential: () => Promise<PiCredentialRevealResult>;
}

function ProviderCredentialEditor({
  apiKey,
  focusInput,
  provider,
  persistentCredential,
  submitting,
  onApiKeyChange,
  onRevealPersistentCredential
}: ProviderCredentialEditorProps) {
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [savedApiKey, setSavedApiKey] = useState<string | undefined>(undefined);
  const [savedApiKeyVisible, setSavedApiKeyVisible] = useState(false);
  const [revealPending, setRevealPending] = useState(false);
  const [revealMessage, setRevealMessage] = useState<string | undefined>(undefined);
  const persistent = persistentCredential !== undefined;

  useEffect(() => {
    if (apiKey.length === 0) setApiKeyVisible(false);
  }, [apiKey]);

  useEffect(() => {
    if (!persistent) {
      setSavedApiKey(undefined);
      setSavedApiKeyVisible(false);
      setRevealMessage(undefined);
    }
  }, [persistent]);

  useEffect(() => {
    if (!savedApiKeyVisible) return;
    const timeout = window.setTimeout(() => {
      setSavedApiKeyVisible(false);
      setSavedApiKey(undefined);
    }, 15_000);
    return () => window.clearTimeout(timeout);
  }, [savedApiKeyVisible]);

  const revealable = persistentCredential?.type === "api_key";

  return (
    <section className="provider-credential-editor" aria-label={messages.credentials.editorLabel(provider.label)}>
      <div className="provider-detail-heading">
        <span>
          <strong>{provider.label}</strong>
          <small>{provider.id}</small>
        </span>
        {provider.configured
          ? <ShieldCheck size={17} aria-label={messages.credentials.configured} />
          : <KeyRound size={17} aria-label={messages.credentials.unconfigured} />}
      </div>
      <div className={`credential-current ${provider.configured ? "is-configured" : ""}`}>
        <div className="credential-current-heading">
          <span>{messages.credentials.currentAuthentication}</span>
          {revealable ? <Button
            aria-label={savedApiKeyVisible
              ? messages.credentials.hideSavedApiKey
              : messages.credentials.showSavedApiKey}
            aria-pressed={savedApiKeyVisible}
            className="credential-current-toggle"
            isDisabled={submitting || revealPending}
            onPress={() => {
              if (savedApiKeyVisible) {
                setSavedApiKeyVisible(false);
                setSavedApiKey(undefined);
                setRevealMessage(undefined);
                return;
              }
              setRevealPending(true);
              setRevealMessage(undefined);
              void onRevealPersistentCredential().then((result) => {
                if (result.status === "revealed") {
                  setSavedApiKey(result.apiKey);
                  setSavedApiKeyVisible(true);
                  return;
                }
                setRevealMessage(revealStatusMessage(result.status));
              }, () => {
                setRevealMessage(messages.credentials.savedApiKeyRevealFailed);
              }).finally(() => setRevealPending(false));
            }}
            type="button"
          >
            {savedApiKeyVisible
              ? <EyeOff aria-hidden="true" size={16} />
              : <Eye aria-hidden="true" size={16} />}
          </Button> : null}
        </div>
        <code className={savedApiKeyVisible ? "is-revealed" : ""}>
          {savedApiKeyVisible && savedApiKey !== undefined
            ? savedApiKey
            : provider.configured ? "••••••••••••" : messages.credentials.notConfigured}
        </code>
        <small>{credentialStatusLabel(provider, persistent)}</small>
        {revealPending ? <small role="status">{messages.credentials.revealingSavedApiKey}</small> : null}
        {revealMessage ? <small className="credential-reveal-message" role="status">{revealMessage}</small> : null}
      </div>
      <div className="dialog-field">
        <label htmlFor="provider-api-key-input">{provider.configured
          ? `输入新的 ${provider.label} API Key`
          : `输入 ${provider.label} API Key`}</label>
        <div className="credential-secret-input">
          <Input
            aria-label={messages.credentials.apiKeyLabel}
            autoComplete="new-password"
            autoFocus={focusInput}
            id="provider-api-key-input"
            type={apiKeyVisible ? "text" : "password"}
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            disabled={submitting}
            placeholder={messages.credentials.keyPlaceholder}
          />
          <Button
            aria-label={apiKeyVisible ? messages.credentials.hideApiKey : messages.credentials.showApiKey}
            aria-pressed={apiKeyVisible}
            className="credential-secret-toggle"
            isDisabled={submitting || apiKey.length === 0}
            onPress={() => setApiKeyVisible((visible) => !visible)}
            type="button"
          >
            {apiKeyVisible
              ? <EyeOff aria-hidden="true" size={16} />
              : <Eye aria-hidden="true" size={16} />}
          </Button>
        </div>
        <small>推荐“保存到 Pi”：写入 auth.json，完全退出或重启后仍可用。“仅本次使用”不会写文件，完全退出后失效。</small>
      </div>
    </section>
  );
}

function revealStatusMessage(status: Exclude<PiCredentialRevealResult["status"], "revealed">): string {
  if (status === "not-api-key") return messages.credentials.savedApiKeyNotApiKey;
  if (status === "indirect") return messages.credentials.savedApiKeyIndirect;
  return messages.credentials.savedApiKeyNotFound;
}

function credentialSourceLabel(provider: ProviderSummary): string {
  if (!provider.configured) return messages.credentials.temporaryOrPiConfiguration;
  const source = provider.credentialSource;
  if (source === "runtime") return messages.credentials.runtimeSource;
  if (source === "stored") return messages.credentials.storedSource;
  if (source === "environment") return messages.credentials.environmentSource(provider.credentialLabel);
  if (source === "models_json_key") return messages.credentials.modelsJsonKeySource;
  if (source === "models_json_command") return messages.credentials.modelsJsonCommandSource;
  if (source === "fallback") return messages.credentials.fallbackSource;
  return messages.credentials.providerSource;
}

function credentialStatusLabel(provider: ProviderSummary, persistent: boolean): string {
  if (persistent && provider.credentialSource === "runtime") {
    return "auth.json 中已有凭据；当前使用本次运行内存中的覆盖值（退出后失效）";
  }
  return persistent ? "已持久化到 Pi auth.json" : credentialSourceLabel(provider);
}
