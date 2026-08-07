import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Input, Label, Modal, ModalOverlay, TextField } from "react-aria-components";
import { renameRendererConversation } from "./conversation-organization-controller.js";
import { useConversationDialogStore } from "./conversation-dialog-store.js";
import styles from "./ConversationDialogs.module.css";

export function ConversationRenameDialog() {
  const target = useConversationDialogStore((state) => state.renameTarget);
  const close = useConversationDialogStore((state) => state.closeRename);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setName(target?.title ?? ""), [target]);
  if (!target) return null;

  const save = async () => {
    const next = name.trim();
    if (!next) return;
    setSaving(true);
    const saved = await renameRendererConversation(target.workspaceId, target, next);
    setSaving(false);
    if (saved) close();
  };
  const restoreAutomatic = async () => {
    setSaving(true);
    const saved = await renameRendererConversation(target.workspaceId, target, undefined);
    setSaving(false);
    if (saved) close();
  };

  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!saving}
      isOpen
      onOpenChange={(open) => { if (!open && !saving) close(); }}
    >
      <Modal className={`modal-surface ${styles.renameModal}`}>
        <Dialog aria-label="重命名对话" className={styles.dialog!}>
          <span className="dialog-eyebrow">对话</span>
          <Heading slot="title">重命名对话</Heading>
          <p>显式名称会保持不变，直到你再次重命名或恢复自动标题。</p>
          <TextField aria-label="对话名称" className={styles.field!} isRequired>
            <Label>名称</Label>
            <Input
              autoFocus
              maxLength={256}
              onChange={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void save();
                }
              }}
              value={name}
            />
          </TextField>
          <div className={styles.dialogActions}>
            {target.nameSource === "explicit" ? (
              <Button className={styles.textButton!} isDisabled={saving} onPress={() => void restoreAutomatic()}>
                恢复自动标题
              </Button>
            ) : <span />}
            <div>
              <Button className="secondary-button" isDisabled={saving} onPress={close}>取消</Button>
              <Button
                className="primary-button"
                isDisabled={saving || !name.trim()}
                onPress={() => void save()}
              >{saving ? "正在保存…" : "保存"}</Button>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
