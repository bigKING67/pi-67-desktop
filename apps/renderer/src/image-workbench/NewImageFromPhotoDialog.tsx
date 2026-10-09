import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Heading, Input, Label, Modal, ModalOverlay, TextField } from "react-aria-components";
import { createImageProjectFromPhoto } from "./image-workbench-controller.js";
import { useImageWorkbench } from "./image-workbench-store.js";
import styles from "./ImageWorkbench.module.css";

/** Names the project and its headline text before the photo is imported (flow A step 1). */
export function NewImageFromPhotoDialog({ photo, onDismiss }: { photo: File; onDismiss: () => void }) {
  const initial = photo.name.replace(/\.[^.]+$/u, "").slice(0, 60) || "新图像项目";
  const [title, setTitle] = useState(initial);
  const [headline, setHeadline] = useState(initial);
  const [creating, setCreating] = useState(false);
  const preview = useMemo(() => URL.createObjectURL(photo), [photo]);
  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);
  const canCreate = title.trim().length > 0 && headline.trim().length > 0 && !creating;

  const create = async () => {
    setCreating(true);
    try {
      const projectId = await createImageProjectFromPhoto(photo, title, headline);
      if (projectId) { onDismiss(); useImageWorkbench.getState().openProject(projectId); }
    } finally {
      setCreating(false);
    }
  };

  return (
    <ModalOverlay className="modal-overlay" isDismissable={!creating} isOpen onOpenChange={(open) => { if (!open && !creating) onDismiss(); }}>
      <Modal className={`modal-surface ${styles.dialogModal}`}>
        <Dialog aria-label="从图片新建图像项目" className={styles.dialog!}>
          <span className="dialog-eyebrow">图像</span>
          <Heading slot="title">从图片新建项目</Heading>
          <img alt="所选照片预览" className={styles.dialogPreview} src={preview} />
          <TextField className={styles.dialogField!} isRequired maxLength={200} value={title} onChange={setTitle}>
            <Label>项目名称</Label>
            <Input autoFocus />
          </TextField>
          <TextField className={styles.dialogField!} isRequired maxLength={200} value={headline} onChange={setHeadline}>
            <Label>标题文字</Label>
            <Input />
          </TextField>
          <p className={styles.dialogHint}>照片按原尺寸放在底层并锁定；标题是单独的文字层，之后可以直接改。</p>
          <div className="dialog-actions">
            <Button className="secondary-button" isDisabled={creating} onPress={onDismiss}>取消</Button>
            <Button className="primary-button" isDisabled={!canCreate} onPress={() => void create()}>{creating ? "正在创建…" : "创建项目"}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
