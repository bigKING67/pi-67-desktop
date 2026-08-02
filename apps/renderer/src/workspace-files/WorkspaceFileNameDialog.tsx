import { useState } from "react";
import { Button, Dialog, Heading, Input, Modal, ModalOverlay } from "react-aria-components";

export function WorkspaceFileNameDialog({
  title,
  detail,
  initialName = "",
  confirmLabel,
  busy = false,
  onConfirm,
  onDismiss
}: {
  title: string;
  detail: string;
  initialName?: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (name: string) => Promise<boolean> | boolean;
  onDismiss: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    const normalized = name.trim();
    if (!normalized || submitting) return;
    setSubmitting(true);
    try {
      if (await onConfirm(normalized)) onDismiss();
    } finally {
      setSubmitting(false);
    }
  };
  const pending = busy || submitting;
  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!pending}
      isOpen
      onOpenChange={(open) => { if (!open && !pending) onDismiss(); }}
    >
      <Modal className="modal-surface workspace-file-name-modal">
        <Dialog aria-label={title} className="workspace-file-name-dialog">
          <span className="dialog-eyebrow">工作区文件</span>
          <Heading slot="title">{title}</Heading>
          <p>{detail}</p>
          <Input
            aria-label="名称"
            autoFocus
            className="field-input"
            disabled={pending}
            maxLength={255}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="dialog-actions">
            <Button className="secondary-button" isDisabled={pending} onPress={onDismiss}>取消</Button>
            <Button className="primary-button" isDisabled={pending || !name.trim()} onPress={() => void submit()}>
              {pending ? "正在处理…" : confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
