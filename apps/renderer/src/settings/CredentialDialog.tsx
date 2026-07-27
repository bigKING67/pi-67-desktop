import type { ProviderSummary } from "@pi67/domain";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Heading, Input, Modal, ModalOverlay } from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import { configureRuntimeProviderKey } from "../session/session-control-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSelectedModel, selectSessionProviders } from "../session/session-projection-selectors.js";
import { useShellStore } from "../shell/shell-store.js";

export function CredentialDialog() {
  const open = useShellStore((state) => state.credentialDialogOpen);
  const providerProjection = useSessionProjectionStore(selectSessionProviders);
  const selectedModel = useSessionProjectionStore(selectSelectedModel);
  const setOpen = useShellStore((state) => state.setCredentialDialogOpen);
  const providers = useMemo(() => providerProjection ?? [], [providerProjection]);
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setApiKey("");
    setSubmitting(false);
    setProviderId((current) => {
      if (providers.some((provider) => provider.id === current)) return current;
      return selectedModel?.provider ?? providers[0]?.id ?? "";
    });
  }, [open, providers, selectedModel?.provider]);

  if (!open) return null;
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const canSubmit = selectedProvider !== undefined && apiKey.trim().length >= 8 && !submitting;

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={!submitting} onOpenChange={setOpen}>
      <Modal className="modal-surface credential-dialog">
        <Dialog aria-label={messages.credentials.title}>
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            setSubmitting(true);
            void configureRuntimeProviderKey(providerId, apiKey).then((configured) => {
              if (configured) setApiKey("");
              setSubmitting(false);
            });
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
            {providers.length > 0 ? (
              <div className="provider-credential-layout">
                <div className="provider-list" aria-label={messages.credentials.providerList}>
                  {providers.map((provider) => (
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
                    provider={selectedProvider}
                    submitting={submitting}
                    onApiKeyChange={setApiKey}
                  />
                ) : null}
              </div>
            ) : (
              <p className="credential-empty">{messages.credentials.empty}</p>
            )}
            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => setOpen(false)} isDisabled={submitting}>{messages.common.close}</Button>
              <Button className="primary-button" type="submit" isDisabled={!canSubmit}>
                {submitting
                  ? messages.credentials.enabling
                  : selectedProvider?.configured
                    ? messages.credentials.replaceRuntimeKey
                    : messages.credentials.enableRuntimeKey}
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
  submitting: boolean;
  onApiKeyChange: (value: string) => void;
}

function ProviderCredentialEditor({ apiKey, provider, submitting, onApiKeyChange }: ProviderCredentialEditorProps) {
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
        <small>{credentialSourceLabel(provider)}</small>
      </div>
      <label className="dialog-field">
        <span>{provider.configured
          ? messages.credentials.replaceKeyLabel
          : messages.credentials.addKeyLabel}</span>
        <Input
          aria-label={messages.credentials.apiKeyLabel}
          autoComplete="new-password"
          type="password"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          disabled={submitting}
          placeholder={messages.credentials.keyPlaceholder}
        />
        <small>{messages.credentials.keyPrivacyHelp}</small>
      </label>
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
