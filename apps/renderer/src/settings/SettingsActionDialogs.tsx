import type { ReactNode } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import styles from "./SettingsActionDialogs.module.css";

export function SettingsDiscardDialog({
  open,
  busy,
  subject,
  onCancel,
  onDiscard
}: {
  open: boolean;
  busy: boolean;
  subject: string;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  if (!open) return null;
  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!busy}
      isOpen
      onOpenChange={(next) => { if (!next && !busy) onCancel(); }}
    >
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label="放弃未保存的修改" className={styles.dialog!}>
          <span className="dialog-eyebrow">设置草稿</span>
          <Heading slot="title">放弃未保存的修改？</Heading>
          <p><strong>{subject}</strong> 尚未保存。离开后当前草稿会丢失。</p>
          <div className="dialog-actions">
            <Button autoFocus className="primary-button" isDisabled={busy} onPress={onCancel}>继续编辑</Button>
            <Button className={styles.dangerButton!} isDisabled={busy} onPress={onDiscard}>
              放弃修改并离开
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function SettingsDestructiveActionDialog({
  open,
  eyebrow = "设置",
  title,
  description,
  facts,
  confirmLabel,
  pendingLabel,
  busy,
  error,
  onCancel,
  onConfirm
}: {
  open: boolean;
  eyebrow?: string;
  title: string;
  description: ReactNode;
  facts?: ReadonlyArray<{ label: string; value: ReactNode }>;
  confirmLabel: string;
  pendingLabel: string;
  busy: boolean;
  error?: string | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!busy}
      isOpen
      onOpenChange={(next) => { if (!next && !busy) onCancel(); }}
    >
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label={title} className={styles.dialog!}>
          <span className="dialog-eyebrow">{eyebrow}</span>
          <Heading slot="title">{title}</Heading>
          <p>{description}</p>
          {facts?.length ? <dl className={styles.facts}>
            {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
          </dl> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <Button autoFocus className="secondary-button" isDisabled={busy} onPress={onCancel}>取消</Button>
            <Button className={styles.dangerButton!} isDisabled={busy} onPress={onConfirm}>
              {busy ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
