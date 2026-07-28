import type { ProviderSummary } from "@pi67/domain";
import { Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
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
  storePersistentCredential
} from "./provider-configuration-controller.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";

export function CredentialDialog() {
  const open = useShellStore((state) => state.credentialDialogOpen);
  const selectedModel = useSessionProjectionStore(selectSelectedModel);
  const setOpen = useShellStore((state) => state.setCredentialDialogOpen);
  const workspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId ?? state.currentWorkspaceId);
  const configuration = useProviderConfigurationStore((state) => (
    state.workspaceId === workspaceId ? state.snapshot : undefined
  ));
  const [providers, setProviders] = useState<ProviderSummary[] | undefined>(undefined);
  const providerList = useMemo(() => providers ?? [], [providers]);
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    if (!open) return;
    setApiKey("");
    setSubmitting(false);
    setLoadError(undefined);
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
      return providerList.some((provider) => provider.id === selectedModel?.provider)
        ? selectedModel?.provider ?? ""
        : providerList[0]?.id ?? "";
    });
  }, [open, providerList, selectedModel?.provider]);

  if (!open) return null;
  const selectedProvider = providerList.find((provider) => provider.id === providerId);
  const canSubmit = selectedProvider !== undefined && apiKey.trim().length >= 8 && !submitting;

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={!submitting} onOpenChange={setOpen}>
      <Modal className="modal-surface credential-dialog">
        <Dialog aria-label={messages.credentials.title}>
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
            <span className="dialog-eyebrow">{messages.credentials.eyebrow}</span>
            <Heading slot="title">{messages.credentials.title}</Heading>
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
              <div className="provider-credential-layout">
                <div className="provider-list" aria-label={messages.credentials.providerList}>
                  {providerList.map((provider) => (
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
                </div>
                {selectedProvider ? (
                  <ProviderCredentialEditor
                    apiKey={apiKey}
                    key={selectedProvider.id}
                    persistent={configuration?.credentials.some((credential) => credential.provider === providerId) ?? false}
                    provider={selectedProvider}
                    submitting={submitting}
                    onApiKeyChange={setApiKey}
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
              >仅本次运行</Button> : null}
              {selectedProvider && workspaceId && configuration?.credentials.some((credential) => credential.provider === providerId) ? <Button
                className="secondary-button"
                isDisabled={submitting}
                onPress={() => {
                  setSubmitting(true);
                  void (async () => {
                    try {
                      const removed = await removePersistentCredential(workspaceId, providerId);
                      if (removed) setProviders(await loadWorkspaceProviderCatalog(workspaceId));
                    } catch (error) {
                      setLoadError(error instanceof Error ? error.message : messages.credentials.loadFailed);
                    } finally {
                      setSubmitting(false);
                    }
                  })();
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
  );
}

interface ProviderCredentialEditorProps {
  apiKey: string;
  provider: ProviderSummary;
  persistent: boolean;
  submitting: boolean;
  onApiKeyChange: (value: string) => void;
}

function ProviderCredentialEditor({ apiKey, provider, persistent, submitting, onApiKeyChange }: ProviderCredentialEditorProps) {
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  useEffect(() => {
    if (apiKey.length === 0) setApiKeyVisible(false);
  }, [apiKey]);

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
        <span>{messages.credentials.currentAuthentication}</span>
        <code>{provider.configured ? "••••••••••••" : messages.credentials.notConfigured}</code>
        <small>{credentialStatusLabel(provider, persistent)}</small>
      </div>
      <div className="dialog-field">
        <label htmlFor="provider-api-key-input">{provider.configured
          ? messages.credentials.replaceKeyLabel
          : messages.credentials.addKeyLabel}</label>
        <div className="credential-secret-input">
          <Input
            aria-label={messages.credentials.apiKeyLabel}
            autoComplete="new-password"
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
        <small>默认保存到 Pi auth.json；当前输入可临时显示，已保存值不会回填。也可选择“仅本次运行”。</small>
      </div>
    </section>
  );
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
    return "持久凭据已存在；当前运行使用临时覆盖";
  }
  return persistent ? "已持久化到 Pi auth.json" : credentialSourceLabel(provider);
}
