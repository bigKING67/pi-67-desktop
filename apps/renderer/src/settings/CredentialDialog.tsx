import type { ProviderSummary } from "@pi67/domain";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Heading, Input, Modal, ModalOverlay } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";

export function CredentialDialog() {
  const open = useAppStore((state) => state.credentialDialogOpen);
  const snapshot = useAppStore((state) => state.snapshot);
  const setOpen = useAppStore((state) => state.setCredentialDialogOpen);
  const setRuntimeApiKey = useAppStore((state) => state.setRuntimeApiKey);
  const providers = useMemo(() => snapshot?.providers ?? [], [snapshot?.providers]);
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setApiKey("");
    setSubmitting(false);
    setProviderId((current) => {
      if (providers.some((provider) => provider.id === current)) return current;
      return snapshot?.selectedModel?.provider ?? providers[0]?.id ?? "";
    });
  }, [open, providers, snapshot?.selectedModel?.provider]);

  if (!open) return null;
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const canSubmit = selectedProvider !== undefined && apiKey.trim().length >= 8 && !submitting;

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={!submitting} onOpenChange={setOpen}>
      <Modal className="modal-surface credential-dialog">
        <Dialog aria-label="Provider 与凭据">
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            setSubmitting(true);
            void setRuntimeApiKey(providerId, apiKey).then((configured) => {
              if (configured) setApiKey("");
              setSubmitting(false);
            });
          }}>
            <span className="dialog-eyebrow">Pi provider status</span>
            <Heading slot="title">Provider 与凭据</Heading>
            <div className="credential-notice">
              <LockKeyhole size={17} aria-hidden="true" />
              <p>
                <strong>显示认证状态，不读取或回显完整密钥。</strong>
                <span>新增的 API key 仅保存在 Agent Host 内存中；退出应用或 Agent Host 重启后即清除。</span>
              </p>
            </div>
            {providers.length > 0 ? (
              <div className="provider-credential-layout">
                <div className="provider-list" aria-label="Pi Providers">
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
                        <small>{provider.id} · {provider.modelCount} 个模型</small>
                      </span>
                      <em className={provider.configured ? "is-configured" : ""}>
                        {provider.configured ? "已配置" : "未配置"}
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
              <p className="credential-empty">请先选择工作区并等待 Pi Provider 列表加载。</p>
            )}
            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => setOpen(false)} isDisabled={submitting}>关闭</Button>
              <Button className="primary-button" type="submit" isDisabled={!canSubmit}>
                {submitting ? "正在启用…" : selectedProvider?.configured ? "替换本次运行密钥" : "启用本次运行密钥"}
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
    <section className="provider-credential-editor" aria-label={`${provider.label} 凭据`}>
      <div className="provider-detail-heading">
        <span>
          <strong>{provider.label}</strong>
          <small>{provider.id}</small>
        </span>
        {provider.configured ? <ShieldCheck size={17} aria-label="已配置" /> : <KeyRound size={17} aria-label="未配置" />}
      </div>
      <div className={`credential-current ${provider.configured ? "is-configured" : ""}`}>
        <span>当前认证</span>
        <code>{provider.configured ? "••••••••••••" : "尚未配置"}</code>
        <small>{credentialSourceLabel(provider)}</small>
      </div>
      <label className="dialog-field">
        <span>{provider.configured ? "新增密钥以替换本次运行凭据" : "新增本次运行 API key"}</span>
        <Input
          aria-label="Provider API key"
          autoComplete="new-password"
          type="password"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          disabled={submitting}
          placeholder="输入后仅发送到 Agent Host"
        />
        <small>至少 8 个字符。输入值不会进入会话快照、诊断或日志，也不会在关闭后回填。</small>
      </label>
    </section>
  );
}

function credentialSourceLabel(provider: ProviderSummary): string {
  if (!provider.configured) return "可在此新增临时密钥，或通过 Pi 配置认证。";
  const source = provider.credentialSource;
  if (source === "runtime") return "来源：本次运行内存";
  if (source === "stored") return "来源：Pi AuthStorage";
  if (source === "environment") return `来源：环境配置${provider.credentialLabel ? ` · ${provider.credentialLabel}` : ""}`;
  if (source === "models_json_key") return "来源：Pi models.json 配置";
  if (source === "models_json_command") return "来源：Pi models.json 命令";
  if (source === "fallback") return "来源：Provider 默认认证";
  return "来源：Pi Provider 配置";
}
