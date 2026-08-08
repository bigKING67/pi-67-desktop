import { Keyboard, X } from "lucide-react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import {
  DESKTOP_ACTIONS,
  formatDesktopShortcut
} from "../app/desktop-action-registry.js";
import { useShellStore } from "../shell/shell-store.js";
import styles from "./KeyboardShortcutsDialog.module.css";

export function KeyboardShortcutsDialog() {
  const open = useShellStore((state) => state.keyboardShortcutsDialogOpen);
  const setOpen = useShellStore((state) => state.setKeyboardShortcutsDialogOpen);
  if (!open) return null;

  return (
    <ModalOverlay
      className={`modal-overlay ${styles.overlay}`}
      isDismissable
      isOpen
      onOpenChange={setOpen}
    >
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label="键盘快捷键" className={styles.dialog!}>
          <header className={styles.header}>
            <span className={styles.headingIcon}><Keyboard aria-hidden="true" size={18} /></span>
            <span>
              <Heading slot="title">键盘快捷键</Heading>
              <p>Windows 使用 Ctrl，macOS 使用 Command。</p>
            </span>
            <Button aria-label="关闭键盘快捷键" className={styles.close!} onPress={() => setOpen(false)}>
              <X aria-hidden="true" size={16} />
            </Button>
          </header>
          <div className={styles.list}>
            {DESKTOP_ACTIONS.map((action) => (
              <div className={styles.row} key={action.id}>
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.detail}</small>
                </span>
                <kbd>{formatDesktopShortcut(action)}</kbd>
              </div>
            ))}
          </div>
          <footer>正文查找与模型自动调用的 Web Search 是两种独立能力；这里没有搜索开关。</footer>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
