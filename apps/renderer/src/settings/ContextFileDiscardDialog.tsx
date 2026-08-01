import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import styles from "./RuleSettingsWorkspace.module.css";

export function ContextFileDiscardDialog({ open, busy, fileName, onCancel, onDiscard }: {
  open: boolean;
  busy: boolean;
  fileName: string | undefined;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!busy}
      isOpen={open}
      onOpenChange={(next) => { if (!next && !busy) onCancel(); }}
    >
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label="放弃未保存的修改" className={styles.dialog!}>
          <span className="dialog-eyebrow">规则与上下文</span>
          <Heading slot="title">放弃未保存的修改？</Heading>
          <p>{fileName ?? "当前文件"} 的修改尚未保存。离开后当前草稿会丢失。</p>
          <div className="dialog-actions">
            <Button autoFocus className="primary-button" isDisabled={busy} onPress={onCancel}>继续编辑</Button>
            <Button className={styles.discardButton!} isDisabled={busy} onPress={onDiscard}>
              放弃修改并离开
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
