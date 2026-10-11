import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useImageTextChecks } from "./image-project-export.js";
import styles from "./ImageWorkbench.module.css";

/**
 * Before an export ships text that the OCR could not read in full (covered, masked, clipped
 * or faded), the person sees which and decides: fix it first, or export anyway.
 */
export function ImageTextCheckDialog() {
  const pending = useImageTextChecks((state) => state.pending);
  if (!pending) return null;
  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) pending.decide(false); }}>
      <Modal className={`modal-surface ${styles.dialogModal}`}>
        <Dialog aria-label="导出前核对文字" className={styles.dialog!} role="alertdialog">
          <span className="dialog-eyebrow">导出</span>
          <Heading slot="title">有 {pending.unread.length} 段文字读不全</Heading>
          <ul className={styles.unreadList}>
            {pending.unread.map((item, index) => (
              <li key={index}>
                <strong>{item.text}</strong>
                <span>{item.label} · 读到「{item.read || "无"}」</span>
              </li>
            ))}
          </ul>
          <p className={styles.dialogHint}>可能被别的图层盖住、被蒙版遮住、透明度太低或超出画布。核对在本机离线完成，偶尔会误报。</p>
          <div className="dialog-actions">
            <Button autoFocus className="secondary-button" onPress={() => pending.decide(false)}>取消</Button>
            <Button className="primary-button" onPress={() => pending.decide(true)}>仍然导出</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
