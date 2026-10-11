import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useImageTextChecks } from "./image-project-export.js";
import styles from "./ImageWorkbench.module.css";

/**
 * Before an export ships text that the OCR could not read in full (covered, masked, clipped
 * or faded) or whose contrast is too low for its size, or a PNG that breaks the brand spec it
 * was exported for, the person sees which and decides: fix it first, or export anyway.
 */
export function ImageTextCheckDialog() {
  const pending = useImageTextChecks((state) => state.pending);
  if (!pending) return null;
  const sending = pending.purpose === "handoff";
  const { unread, issues } = pending;
  const heading = !unread.length ? `有 ${issues.length} 处不符合规格` : issues.length ? `有 ${issues.length + unread.length} 处需要确认` : `有 ${unread.length} 段文字可能看不清`;
  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) pending.decide(false); }}>
      <Modal className={`modal-surface ${styles.dialogModal}`}>
        <Dialog aria-label={sending ? "发送前核对" : "导出前核对"} className={styles.dialog!} role="alertdialog">
          <span className="dialog-eyebrow">{sending ? "发到团队" : "导出"}</span>
          <Heading slot="title">{heading}</Heading>
          <ul className={styles.unreadList}>
            {issues.map((issue) => <li key={issue}><strong>{issue}</strong><span>规格</span></li>)}
            {unread.map((item, index) => (
              <li key={index}>
                <strong>{item.text}</strong>
                <span>{item.label} · {[item.passed ? "" : `读到「${item.read || "无"}」`, item.contrast === undefined ? "" : `对比度 ${item.contrast}:1，太淡`].filter(Boolean).join("，")}</span>
              </li>
            ))}
          </ul>
          {unread.length ? <p className={styles.dialogHint}>读不全多半是被别的图层盖住、被蒙版遮住或超出画布；太淡是文字和身后的颜色太接近（大字至少 3:1，小字至少 4.5:1）。核对在本机离线完成，偶尔会误报。</p> : null}
          <div className="dialog-actions">
            <Button autoFocus className="secondary-button" onPress={() => pending.decide(false)}>取消</Button>
            <Button className="primary-button" onPress={() => pending.decide(true)}>{sending ? "仍然发送" : "仍然导出"}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
