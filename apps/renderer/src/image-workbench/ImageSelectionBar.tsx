import type { ImageSceneObject } from "@pi67/domain";
import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input, TextField } from "react-aria-components";
import { editImageProject } from "./image-project-controller.js";
import styles from "./ImageProjectPage.module.css";

/**
 * What the selected object allows in P2: text objects change their words
 * directly; locked objects (the photo) say so. A conflict keeps the draft.
 */
export function ImageSelectionBar({ object, count, busy }: { object: ImageSceneObject | undefined; count: number; busy: boolean }) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const objectText = object?.kind === "text" ? object.text : undefined;
  useEffect(() => { setDraft(objectText ?? ""); setNotice(undefined); }, [object?.id, objectText]);

  if (count > 1) return <p className={styles.selectionHint}>已选 {count} 个对象：一起拖动或用方向键移动，在属性里对齐。</p>;
  if (!object) return <p className={styles.selectionHint}>双击画布上的文字直接改字，拖动可以移动，按住 Shift 多选；照片层默认锁定。</p>;
  if (object.kind !== "text") {
    return (
      <p className={styles.selectionHint}>
        {object.locked ? <><Lock aria-hidden="true" size={12} /> {object.kind === "image" ? "照片" : "形状"}已锁定，保持原样</>
          : object.rotation ? "拖动或用方向键移动，拖圆形手柄或按 [ ] 旋转；旋转后的大小在属性里改"
          : "拖动或用方向键移动（Shift 每次 10px），拖角上的手柄调整大小，拖圆形手柄或按 [ ] 旋转"}
      </p>
    );
  }
  const changed = draft.trim().length > 0 && draft !== object.text;
  const submit = async () => {
    if (!changed || saving) return;
    setSaving(true);
    try {
      const result = await editImageProject("修改文字", [{ type: "update_object", id: object.id, patch: { text: draft } }]);
      setNotice(result.outcome === "conflict" ? "Agent 刚更新了项目，你的改动还在，再点一次「应用」即可应用到新修订。"
        : result.outcome === "refused" ? result.message : undefined);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className={styles.selectionBar} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <TextField aria-label="文字内容" className={styles.selectionField!} isDisabled={object.locked || busy} maxLength={2000} value={draft} onChange={setDraft}>
        <Input />
      </TextField>
      <Button className="secondary-button" isDisabled={!changed || saving || busy} type="submit">{saving ? "正在应用…" : "应用"}</Button>
      {notice ? <span className={styles.selectionNotice} role="status">{notice}</span> : null}
    </form>
  );
}
