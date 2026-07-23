import { KeyRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Heading, Input, Modal, ModalOverlay } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";

export function CredentialDialog() {
  const open = useAppStore((state) => state.credentialDialogOpen);
  const snapshot = useAppStore((state) => state.snapshot);
  const setOpen = useAppStore((state) => state.setCredentialDialogOpen);
  const setRuntimeApiKey = useAppStore((state) => state.setRuntimeApiKey);
  const providers = useMemo(
    () => [...new Set(snapshot?.models.map((model) => model.provider) ?? [])].sort((a, b) => a.localeCompare(b)),
    [snapshot?.models]
  );
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setApiKey("");
    setSubmitting(false);
    setProvider(snapshot?.selectedModel?.provider ?? providers[0] ?? "");
  }, [open, providers, snapshot?.selectedModel?.provider]);

  if (!open) return null;
  const canSubmit = provider.length > 0 && apiKey.trim().length >= 8 && !submitting;

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={!submitting} onOpenChange={setOpen}>
      <Modal className="modal-surface credential-dialog">
        <Dialog aria-label="配置本次运行的 Provider API key">
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            setSubmitting(true);
            void setRuntimeApiKey(provider, apiKey).then((configured) => {
              if (configured) setApiKey("");
              else setSubmitting(false);
            });
          }}>
            <span className="dialog-eyebrow">Ephemeral credential</span>
            <Heading slot="title">配置本次运行的 API key</Heading>
            <div className="credential-notice">
              <KeyRound size={17} aria-hidden="true" />
              <p><strong>仅保存在 Agent Host 内存中。</strong><span>不会写入 Pi AuthStorage、设置、诊断或日志；退出应用或 Agent Host 重启后即清除。</span></p>
            </div>
            {providers.length > 0 ? (
              <>
                <label className="dialog-field">
                  <span>Provider</span>
                  <select value={provider} onChange={(event) => setProvider(event.target.value)} disabled={submitting}>
                    {providers.map((item) => <option value={item} key={item}>{item}</option>)}
                  </select>
                </label>
                <label className="dialog-field">
                  <span>API key</span>
                  <Input
                    autoFocus
                    aria-label="Provider API key"
                    autoComplete="new-password"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    disabled={submitting}
                  />
                  <small>至少 8 个字符。关闭窗口后不会回填或显示该值。</small>
                </label>
              </>
            ) : (
              <p className="credential-empty">请先选择工作区并等待 Pi 模型列表加载，再配置运行时凭据。</p>
            )}
            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => setOpen(false)} isDisabled={submitting}>取消</Button>
              <Button className="primary-button" type="submit" isDisabled={!canSubmit}>
                {submitting ? "正在配置…" : "仅为本次运行启用"}
              </Button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
