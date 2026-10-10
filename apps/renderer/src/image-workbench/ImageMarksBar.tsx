import { IMAGE_PROMPT_CONTEXT_LIMITS } from "@pi67/domain";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, Input, TextField } from "react-aria-components";
import { boundsOf, type Rect } from "./image-canvas-geometry.js";
import { useImageProject } from "./image-project-controller.js";
import { removeImageMark, setImageMarkInstruction } from "./image-project-marks.js";
import styles from "./ImageProjectPage.module.css";

/**
 * Mark mode's bar (product model §7 D): one row per region with its instruction.
 * Worded marks travel with the next message; `框选选中对象` is the keyboard way
 * to add one. `focus` is the region just added, whose field takes focus.
 */
export function ImageMarksBar({ focus, onAdd, onDone }: { focus: { id: string } | undefined; onAdd: (rect: Rect) => void; onDone: () => void }) {
  const marks = useImageProject((state) => state.marks);
  const document = useImageProject((state) => state.document);
  const selectedIds = useImageProject((state) => state.selectedObjectIds);
  const selected = document?.objects.filter((object) => selectedIds.includes(object.id)) ?? [];
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (focus) list.current?.querySelector<HTMLInputElement>(`[data-mark-id="${focus.id}"] input`)?.focus();
  }, [focus]);

  const full = marks.length >= IMAGE_PROMPT_CONTEXT_LIMITS.marks;
  return (
    <section aria-label="标记" className={styles.marksBar}>
      <div className={styles.marksHead}>
        <p className={styles.marksHint}>
          {full ? `最多 ${IMAGE_PROMPT_CONTEXT_LIMITS.marks} 个标记。` : "在画布上拖出要改的区域，每个区域写一句要怎么改。"}写了指令的标记随下一条消息发送。
        </p>
        <Button className="secondary-button" isDisabled={full || selected.length === 0}
          onPress={() => onAdd(boundsOf(selected))}>框选选中对象</Button>
        <Button className="secondary-button" onPress={onDone}>完成</Button>
      </div>
      <ul ref={list} className={styles.marksList}>
        {marks.map((mark) => (
          <li key={mark.id} className={styles.markRow} data-mark-id={mark.id}>
            <span aria-hidden="true" className={styles.markId}>{mark.id}</span>
            <TextField aria-label={`标记 ${mark.id} 的指令`} className={styles.selectionField!} maxLength={IMAGE_PROMPT_CONTEXT_LIMITS.instruction}
              value={mark.instruction} onChange={(value) => setImageMarkInstruction(mark.id, value)}>
              <Input placeholder="这里要怎么改，比如“换成木纹桌面”" />
            </TextField>
            <Button aria-label={`删除标记 ${mark.id}`} className={styles.iconAction!} onPress={() => removeImageMark(mark.id)}><X aria-hidden="true" size={14} /></Button>
          </li>
        ))}
        {marks.length ? null : <li className={styles.marksEmpty}>还没有标记。</li>}
      </ul>
    </section>
  );
}
