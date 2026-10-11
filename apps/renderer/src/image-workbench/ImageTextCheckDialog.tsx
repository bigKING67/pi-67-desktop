import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useImageTextChecks } from "./image-project-export.js";
import styles from "./ImageWorkbench.module.css";

/**
 * Before an export ships text that the OCR could not read in full (covered, masked, clipped
 * or faded) or whose contrast is too low for its size, the person sees which and decides:
 * fix it first, or export anyway.
 */
export function ImageTextCheckDialog() {
  const pending = useImageTextChecks((state) => state.pending);
  if (!pending) return null;
  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) pending.decide(false); }}>
      <Modal className={`modal-surface ${styles.dialogModal}`}>
        <Dialog aria-label="导出前核对文字" className={styles.dialog!} role="alertdialog">
          <span className="dialog-eyebrow">导出</span>
          <Heading slot="title">有 {pending.unread.length} 段文字可能看不清</Heading>
          <ul className={styles.unreadList}>
            {pending.unread.map((item, index) => (
              <li key={index}>
                <strong>{item.text}</strong>
                <span>{item.label} · {[item.passed ? "" : `读到「${item.read || "无"}」`, item.contrast === undefined ? "" : `对比度 ${item.contrast}:1，太淡`].filter(Boolean).join("，")}</span>
              </li>
            ))}
          </ul>
          <p className={styles.dialogHint}>读不全多半是被别的图层盖住、被蒙版遮住或超出画布；太淡是文字和身后的颜色太接近（大字至少 3:1，小字至少 4.5:1）。核对在本机离线完成，偶尔会误报。</p>
          <div className="dialog-actions">
            <Button autoFocus className="secondary-button" onPress={() => pending.decide(false)}>取消</Button>
            <Button className="primary-button" onPress={() => pending.decide(true)}>仍然导出</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
