import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { discardProvisionalDraft } from "./provisional-draft-discard-controller.js";
import { useConversationDialogStore } from "./conversation-dialog-store.js";
import styles from "./ConversationDialogs.module.css";

export function ConversationDraftDiscardDialog() {
  const target = useConversationDialogStore((state) => state.draftDiscardTarget);
  const close = useConversationDialogStore((state) => state.closeDraftDiscard);
  const [discarding, setDiscarding] = useState(false);
  if (!target) return null;

  const discard = async () => {
    setDiscarding(true);
    const discarded = await discardProvisionalDraft(target.taskId);
    setDiscarding(false);
    if (discarded) close();
  };

  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!discarding}
      isOpen
      onOpenChange={(open) => { if (!open && !discarding) close(); }}
    >
      <Modal className={`modal-surface ${styles.renameModal}`}>
        <Dialog aria-label={`丢弃草稿：${target.title}`} className={styles.dialog!}>
          <span className="dialog-eyebrow">新对话草稿</span>
          <Heading slot="title">丢弃“{target.title}”？</Heading>
          <p>未发送的文字、附件和暂存内容会被移除。这个草稿尚未创建 Pi Session 或 JSONL。</p>
          <div className="dialog-actions">
            <Button autoFocus className="secondary-button" isDisabled={discarding} onPress={close}>取消</Button>
            <Button
              className={styles.dangerButton!}
              isDisabled={discarding}
              onPress={() => void discard()}
            >{discarding ? "正在丢弃…" : "丢弃草稿"}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
