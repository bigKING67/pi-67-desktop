import { IMAGE_REFERENCE_ROLE_LABELS } from "@pi67/domain";
import { Paperclip, X } from "lucide-react";
import { Button } from "react-aria-components";
import { selectImageObject, useImageProject } from "./image-project-controller.js";
import { holdImageMarks, sendableImageMarks, setImageReference } from "./image-project-marks.js";
import styles from "./ImageProjectPage.module.css";

/**
 * What the next message carries besides the words (product model §9.2): worded
 * marks, the selection and references, each removable. Removing the marks only
 * detaches them (they stay on the canvas, `附带` brings them back). The revision always goes.
 */
export function ImagePromptAttachments() {
  const marks = useImageProject((state) => state.marks);
  const held = useImageProject((state) => state.marksHeld);
  const selected = useImageProject((state) => state.selectedObjectIds.length);
  const references = useImageProject((state) => state.references);
  const sendable = sendableImageMarks(marks).length;
  if (!sendable && !selected && !references.length) return null;
  return (
    <div aria-label="随消息附带" className={styles.attachments} role="group">
      <span className={styles.attachmentsLabel}>已附带</span>
      {sendable && !held ? <Attachment label={`${sendable} 个标记`} remove="不附带标记" onRemove={() => holdImageMarks(true)} /> : null}
      {selected ? <Attachment label={`${selected} 个选中图层`} remove="取消选择" onRemove={() => selectImageObject(undefined)} /> : null}
      {references.map((reference) => (
        <Attachment key={reference.objectId} label={`参考 ${reference.objectId} · ${IMAGE_REFERENCE_ROLE_LABELS[reference.role]}`}
          remove="移除参考" onRemove={() => setImageReference(reference.objectId, undefined)} />
      ))}
      {sendable && held ? (
        <Button className={styles.attachmentRestore!} onPress={() => holdImageMarks(false)}>
          <Paperclip aria-hidden="true" size={12} />附带 {sendable} 个标记
        </Button>
      ) : null}
    </div>
  );
}

function Attachment({ label, remove, onRemove }: { label: string; remove: string; onRemove: () => void }) {
  return (
    <span className={styles.attachment}>
      {label}
      <Button aria-label={`${remove}：${label}`} className={styles.attachmentRemove!} onPress={onRemove}><X aria-hidden="true" size={12} /></Button>
    </span>
  );
}
